"""Board solver: the app's board (board/config.yaml) on a BixBench study.

Same interface as bixbase.agent.solve, so run.py, the sandbox, the Budget, the logger and the
grader stay shared with the single-agent baseline. ONE Budget is shared by every member.

The board is the app's (engine/src/board/board.ts), read at run time:
  - the members are the `board:` list of board/config.yaml, in its order, plus the Lead
    Scientist; each member's prompt, title, deliverable, model tier and modes come from its file
    in board/agents/ (their sha256 is logged in run_start);
  - each member's model is its tier in the `models:` of board/config.yaml (lead, strong, cheap,
    rival), as in the app;
  - the Lead Scientist runs the review. It frames the question, then calls `converse`: every
    member gets the message and replies; the members that inspect the data (the scout) reply
    first, and the others then reply in parallel. Round 1 is blind; from round 2, every member
    sees the others' last replies. The lead names the experimenter's mode (pilot, full, revise).
    At most meeting.max_rounds rounds and meeting.lead_turns lead calls; past a limit, only one
    round with final=true may run;
  - each member keeps its own conversation across rounds.

What the benchmark changes, and why. The prompt files are not edited; a BENCHMARK section is
added to each prompt, and it says that it overrides the file where they differ:
  - the scout cannot search (AGENTS.md: no open search for benchmark agents; the answers are in
    published papers). It inspects the study's data with list_dir and read_file;
  - the experimenter can run code (run_code, Python or R) and read the data. In the app it cannot
    run code; on BixBench the answers come from the data. It is the only member that runs code;
  - there are no claim checkers: in the app they check claims against web and literature
    sources, which the benchmark forbids. So there are no verdicts in the digest;
  - the lead ends with submit_answer (an answer per question id), not with write_memo.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .agent import TOOL_SCHEMAS, SolveResult, _content_blocks, _execute_tool, _task_prompt
from .budget import Budget, BudgetExhausted
from .llm import LLMClient
from .loader import Study
from .logger import RunLogger
from .sandbox import Sandbox, settings_of

REPO = Path(__file__).resolve().parents[3]
AGENTS_DIR = Path(os.environ.get("BOARD_AGENTS_DIR") or REPO / "board" / "agents")
CONFIG_FILE = Path(os.environ.get("BOARD_CONFIG") or REPO / "board" / "config.yaml")
LEAD = "lead-scientist"
DATA_READERS = ("scout",)  # members that inspect the data; they reply first in every round
CODE_RUNNERS = ("experimenter",)  # the only members with run_code
WRAP_UP_SHARE = 0.85  # past this share of any budget cap, only a final round may run
MEMBER_TOOL_TURNS = 40  # model calls one member may make in one round (the budget is the real cap)
DIGEST_CHARS = 6_000  # of each member's reply, in the next round's digest

RUN_CODE_SCHEMA = {
    "name": "run_code",
    "description": (
        "Execute a code cell in the working directory. language='python' "
        "(pandas, numpy, scipy, statsmodels, pydeseq2) or language='r' "
        "(Rscript with DESeq2, edgeR, limma, clusterProfiler, tidyverse). "
        "The data is read-only at the DATA_DIR environment variable "
        "(Sys.getenv('DATA_DIR') in R). Files you write persist."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "code": {"type": "string"},
            "language": {"type": "string", "enum": ["python", "r"], "default": "python"},
        },
        "required": ["code"],
    },
}
READ_TOOLS = [t for t in TOOL_SCHEMAS if t["name"] in ("list_dir", "read_file")]
ANSWERS_PROP = {
    "type": "object",
    "description": "{question_id: answer_string}",
    "additionalProperties": {"type": "string"},
}
CONVERSE_SCHEMA = {
    "name": "converse",
    "description": (
        "Address the whole board. Every member replies (the scout first, then the others in "
        "parallel); you get their replies. Give each member its task by name. Use modes to name "
        "the role a member with modes plays this round, e.g. {\"experimenter\": \"pilot\"}."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "message": {"type": "string"},
            "final": {"type": "boolean", "description": "true to ask for final positions"},
            "modes": {"type": "object", "additionalProperties": {"type": "string"}},
        },
        "required": ["message"],
    },
}
SUBMIT_SCHEMA = {
    "name": "submit_answer",
    "description": (
        "Submit the board's final answers: answers maps each question id to a short, exact "
        "answer. Call exactly once, after final positions."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"answers": ANSWERS_PROP},
        "required": ["answers"],
    },
}

_NO_CODE = re.compile(r"You cannot run code on this board yet\.[^\n]*")
_CAN_CODE = (
    "In this benchmark you can run code: use run_code (Python or R). Do not report a number you "
    "did not compute."
)

MEMBER_BENCHMARK = """# BENCHMARK MODE (this section overrides the file above where they differ)
The board is answering a BixBench data-analysis study, not a drug brief.
- The study data is read-only in DATA_DIR. Only the Experimenter can run code (Python or R).
- Nobody can search the web, the literature or a database. There are no checkers and no verdicts.
- Each question is one claim: the claim is the answer to that question id. Final answers are
  graded against hidden reference answers; short, exact answers score best.
- One budget is shared by the whole board: {caps}. Be brief.
{role}"""

ROLE_NOTES = {
    "scout": (
        "- You cannot search. Your job here is the first half of your purpose: inspect the data. "
        "Use list_dir and read_file on DATA_DIR and report the files, their columns, the samples "
        "in each group, and anything missing or corrupted."
    ),
    "experimenter": (
        "- You run the analysis with run_code, and can read files with list_dir and read_file. "
        "Report each question id with the value you computed."
    ),
}

LEAD_BENCHMARK = """# BENCHMARK MODE (this section overrides the file above where they differ)
The board is answering a BixBench data-analysis study: the questions are below, not a brief.
- The Scout cannot search. It inspects the study data and reports what is there. It replies
  first in every round.
- The Experimenter can run code (Python or R) and is the only member that can. A number it did
  not compute is not a result.
- There are no checkers and no verdicts. Judge each answer by the computed results and the
  reviews.
- Each question is one claim: the claim is the answer to that question id.
- You have at most {max_rounds} rounds (converse calls). One budget is shared by the whole
  board: {caps}.
- Instead of write_memo, end with submit_answer: an answer for every question id, short and
  exact (a number, a gene name, a short phrase). Never leave an id empty: give the best estimate.

# Your board
{board}"""


# --- The board's definition, read from board/config.yaml and board/agents/ ----------------------


@dataclass
class AgentDef:
    name: str
    title: str
    tier: str
    tools: list[str]
    deliverable: str
    prompt: str
    sha256: str
    modes: dict[str, str] = field(default_factory=dict)


@dataclass
class BoardDef:
    lead: AgentDef
    roster: list[AgentDef]  # the members, in the order of board/config.yaml
    models: dict[str, str]  # tier -> "provider/model"
    max_rounds: int
    lead_turns: int

    @property
    def members(self) -> list[str]:
        return [self.lead.name, *(a.name for a in self.roster)]


def load_agent(name: str, agents_dir: Path = AGENTS_DIR) -> AgentDef:
    raw = (agents_dir / f"{name}.md").read_bytes()
    text = raw.decode()
    match = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if not match:
        raise ValueError(f"agent {name} has no frontmatter")
    front = yaml.safe_load(match.group(1)) or {}
    return AgentDef(
        name=str(front.get("name", name)),
        title=str(front.get("title", name)),
        tier=str(front.get("model", "strong")),
        tools=[str(t) for t in front.get("tools") or []],
        deliverable=str(front.get("deliverable", "")),
        prompt=match.group(2).strip(),
        sha256=hashlib.sha256(raw).hexdigest()[:16],
        modes={str(k): str(v) for k, v in (front.get("modes") or {}).items()},
    )


def load_board(config_file: Path = CONFIG_FILE, agents_dir: Path = AGENTS_DIR) -> BoardDef:
    config = yaml.safe_load(config_file.read_text()) or {}
    names = [str(n) for n in config.get("board") or []]
    if not names:
        raise ValueError(f"{config_file} has no board: list")
    meeting = config.get("meeting") or {}
    return BoardDef(
        lead=load_agent(LEAD, agents_dir),
        roster=[load_agent(n, agents_dir) for n in names],
        models={str(k): str(v) for k, v in (config.get("models") or {}).items()},
        max_rounds=int(meeting.get("max_rounds", 4)),
        lead_turns=int(meeting.get("lead_turns", 20)),
    )


def prompt_hashes(board: BoardDef | None = None) -> dict[str, str]:
    board = board or load_board()
    return {a.name: a.sha256 for a in (board.lead, *board.roster)}


def model_of(board: BoardDef, member: str) -> str:
    """The "provider/model" of a member: its tier in board/config.yaml, as in the app."""
    agent = board.lead if member == board.lead.name else next(a for a in board.roster if a.name == member)
    return board.models.get(agent.tier) or board.models.get("strong", "")


def app_clients(board: BoardDef, seed: int | None = None) -> Callable[[str], LLMClient]:
    """One client per model (members on the same tier share it), made when first needed."""
    made: dict[str, LLMClient] = {}
    lock = threading.Lock()

    def client_for(member: str) -> LLMClient:
        provider, _, model = model_of(board, member).partition("/")
        with lock:
            if model_of(board, member) not in made:
                made[model_of(board, member)] = LLMClient(model=model, provider=provider, seed=seed)
            return made[model_of(board, member)]

    return client_for


# --- Helpers ---------------------------------------------------------------------------------------


def _caps_text(budget: Budget) -> str:
    c = budget.caps
    parts = []
    if c.max_total_tokens:
        parts.append(f"{c.max_total_tokens:,} tokens")
    if c.max_tool_calls:
        parts.append(f"{c.max_tool_calls} tool calls")
    if c.max_seconds:
        parts.append(f"{int(c.max_seconds)} seconds")
    return ", ".join(parts) or "uncapped"


def _used_share(budget: Budget) -> float:
    """Largest fraction used of any cap (0..1+)."""
    c = budget.caps
    shares = [0.0]
    if c.max_total_tokens:
        shares.append(budget.total_tokens / c.max_total_tokens)
    if c.max_tool_calls:
        shares.append(budget.tool_calls / c.max_tool_calls)
    if c.max_seconds:
        shares.append(budget.elapsed / c.max_seconds)
    return max(shares)


def _data_overview(sandbox: Sandbox, max_lines: int = 60) -> str:
    root = sandbox.data_dir
    rows = []
    for p in sorted(root.rglob("*")):
        if len(rows) >= max_lines:
            rows.append("...")
            break
        rel = p.relative_to(root)
        if len(rel.parts) > 3:
            continue
        rows.append(f"{'dir ' if p.is_dir() else 'file'} {rel}"
                    + ("" if p.is_dir() else f" ({p.stat().st_size} bytes)"))
    return "DATA_DIR contents:\n" + ("\n".join(rows) or "(empty)")


def _parse_answers(raw: Any) -> dict[str, str] | None:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, dict):
        return None
    return {str(k): str(v) for k, v in raw.items()}


def _r_as_comment(code: str) -> str:
    return "# [R cell]\n" + "\n".join("# " + ln for ln in code.splitlines())


def check_modes(roster: list[AgentDef], modes: dict[str, str] | None) -> str:
    """The app's checkModes: "" when the lead's modes are valid, else the refusal."""
    problems = []
    for member, mode in (modes or {}).items():
        agent = next((a for a in roster if a.name == member), None)
        if agent is None:
            problems.append(f"{member} is not on the board")
        elif not agent.modes:
            problems.append(f"{member} has no modes")
        elif mode not in agent.modes:
            problems.append(f"{member} has no mode {mode!r} (it has: {', '.join(agent.modes)})")
    if problems:
        return f"Round not run, and not counted: {'; '.join(problems)}. Call converse again with valid modes."
    return ""


def member_input(*, round_: int, message: str, digest: str, final: bool, pool: str, mode: str | None) -> str:
    """The app's memberInput, without the evidence pool's sources (there is no search)."""
    parts = [
        f"Round {round_}. Lead Scientist to the board:",
        f"Mode: {mode}. Work in this role this round." if mode else "",
        message,
        "Work independently: you have not seen the other members' views, on purpose." if round_ == 1 else digest,
        pool,
        "Give your final position in two sentences." if final else "Reply with your deliverable.",
    ]
    return "\n\n".join(p for p in parts if p)


# --- The board at work -----------------------------------------------------------------------------


class _Board:
    def __init__(self, study: Study, budget: Budget, llm_for: Callable[[str], Any],
                 sandbox: Sandbox, logger: RunLogger, board: BoardDef) -> None:  # fmt: skip
        self.study, self.budget, self.llm_for = study, budget, llm_for
        self.sandbox, self.logger, self.board = sandbox, logger, board
        caps = _caps_text(budget)
        roster_text = "\n".join(f"- {a.title} ({a.name}): {a.deliverable}" for a in board.roster)
        self.prompts = {
            board.lead.name: board.lead.prompt + "\n\n"
            + LEAD_BENCHMARK.format(max_rounds=board.max_rounds, caps=caps, board=roster_text)
        }
        for a in board.roster:
            body = _NO_CODE.sub(_CAN_CODE, a.prompt)
            self.prompts[a.name] = (
                f"{body}\n\n# Your deliverable\n{a.deliverable}\n\n"
                + MEMBER_BENCHMARK.format(caps=caps, role=ROLE_NOTES.get(a.name, ""))
            )
        self.conversations: dict[str, list[dict]] = {a.name: [] for a in board.roster}
        self.rounds = 0
        self.final_round: int | None = None
        self.last_round: list[tuple[str, str]] = []  # (title and mode, reply)
        self.exhausted_reason: str | None = None

    def tools_of(self, member: str) -> list[dict]:
        if member in CODE_RUNNERS:
            return [RUN_CODE_SCHEMA, *READ_TOOLS]
        if member in DATA_READERS:
            return list(READ_TOOLS)
        return []

    # One member's turn in a round: its own conversation, its own tools.
    def member_turn(self, agent: AgentDef, text: str, round_: int, mode: str | None) -> str:
        name, msgs = agent.name, self.conversations[agent.name]
        msgs.append({"role": "user", "content": text})
        self.logger.log("member_input", member=name, round=round_, content=text,
                        **({"mode": mode} if mode else {}))  # fmt: skip
        tools, reply = self.tools_of(name), ""
        try:
            for _ in range(MEMBER_TOOL_TURNS):
                resp = self.llm_for(name).chat(msgs, system=self.prompts[name], tools=tools or None,
                                               budget=self.budget)  # fmt: skip
                blocks = _content_blocks(resp.text, resp.tool_calls)
                msgs.append({"role": "assistant", "content": blocks})
                self.logger.log("member_output", member=name, round=round_, content=blocks,
                                budget=self.budget.snapshot())  # fmt: skip
                reply = resp.text or reply
                if not resp.tool_calls:
                    break
                results = []
                for tc in resp.tool_calls:
                    self.budget.record_tool_call()
                    self.logger.log_tool_call(tc.name, tc.id, tc.input, member=name)
                    out = self.run_tool(name, tc)
                    self.logger.log_tool_result(tc.id, tc.name, out, member=name)
                    results.append({"type": "tool_result", "tool_use_id": tc.id, "content": out})
                msgs.append({"role": "user", "content": results})
        except BudgetExhausted as e:
            self.exhausted_reason = e.reason
            reply = reply or f"(no reply: the budget ran out: {e.reason})"
        reply = reply or "(no reply)"
        self.logger.log("member_reply", member=name, round=round_, text=reply,
                        **({"mode": mode} if mode else {}))  # fmt: skip
        return reply

    def run_tool(self, member: str, tc: Any) -> str:
        allowed = {t["name"] for t in self.tools_of(member)}
        if tc.name not in allowed:
            return f"ERROR: {member} has no tool {tc.name}"
        inp = tc.input or {}
        try:
            if tc.name == "run_code":
                code = inp.get("code", "")
                lang = "r" if str(inp.get("language", "python")).lower() in ("r", "rscript") else "python"
                if not code.strip():
                    return "ERROR: empty code"
                res = self.sandbox.run_code(code, language=lang)
                self.logger.log_code_cell(code if lang == "python" else _r_as_comment(code), res)
                self.logger.log_cell(member, tc.id, res, lang,
                                     settings_of(self.sandbox).get("sandbox", "unknown"))  # fmt: skip
                return res.tool_result_text()
            text, _ = _execute_tool(tc.name, inp, self.sandbox, self.logger, tc.id)
            return text
        except (PermissionError, OSError, RuntimeError) as e:
            return f"ERROR: {e}"

    def digest(self) -> str:
        return "What the board said last round:\n\n" + "\n\n".join(
            f"### {who}\n{reply[:DIGEST_CHARS]}" for who, reply in self.last_round
        )

    def gate(self, final: bool) -> str:
        """The app's gateRound: "" when the round may run, else the refusal for the lead."""
        if self.final_round is not None:
            return f"Final positions are in (round {self.final_round}). No further rounds: call submit_answer now."
        limit = ""
        if self.rounds >= self.board.max_rounds:
            limit = f"{self.rounds} of {self.board.max_rounds} rounds used"
        elif _used_share(self.budget) >= WRAP_UP_SHARE:
            limit = f"{_used_share(self.budget):.0%} of the budget used"
        if limit and not final:
            return f"WRAP UP: {limit}. Call converse once with final=true to ask for final positions, then submit_answer."
        return ""

    def converse(self, args: dict[str, Any]) -> str:
        modes = args.get("modes") if isinstance(args.get("modes"), dict) else None
        refusal = check_modes(self.board.roster, modes) or self.gate(bool(args.get("final")))
        if refusal:
            return refusal
        self.rounds += 1
        round_, final = self.rounds, bool(args.get("final"))
        if final:
            self.final_round = round_
        message = str(args.get("message", ""))
        self.logger.log("round_start", round=round_, final=final, modes=modes or {}, message=message)
        digest = "" if round_ == 1 else self.digest()

        def mode_line(agent: AgentDef) -> str | None:
            mode = (modes or {}).get(agent.name)
            return f"{agent.modes[mode]} ({mode})" if mode else None

        def turn(agent: AgentDef, pool: str) -> tuple[AgentDef, str]:
            text = member_input(round_=round_, message=message, digest=digest, final=final,
                                pool=pool, mode=mode_line(agent))  # fmt: skip
            return agent, self.member_turn(agent, text, round_, (modes or {}).get(agent.name))

        readers = [a for a in self.board.roster if a.name in DATA_READERS]
        others = [a for a in self.board.roster if a.name not in DATA_READERS]
        replies: dict[str, str] = {}
        for agent in readers:  # the data readers first, as the app's searchers reply first
            replies[agent.name] = turn(agent, "")[1]
        pool = "\n\n".join(f"{a.title}'s data report this round:\n{replies[a.name][:DIGEST_CHARS]}"
                           for a in readers)  # fmt: skip
        with ThreadPoolExecutor(max_workers=max(1, len(others))) as pool_exec:
            for agent, reply in pool_exec.map(lambda a: turn(a, pool), others):
                replies[agent.name] = reply
        self.last_round = []
        for agent in self.board.roster:  # in the board's order
            mode = (modes or {}).get(agent.name)
            who = f"{agent.title}, as {agent.modes[mode]}" if mode else agent.title
            self.last_round.append((who, replies[agent.name]))
        self.logger.log("round_end", round=round_, budget=self.budget.snapshot())
        status = ""
        if final:
            status = "\n\nFinal positions are in. Call submit_answer now."
        elif self.gate(False):
            status = "\n\n" + self.gate(False)
        return self.digest() + status


def solve(
    study: Study,
    budget: Budget,
    *,
    llm: Any = None,
    run_dir: Path,
    sandbox: Sandbox | None = None,
    run_id: str | None = None,
    llm_for: Callable[[str], Any] | None = None,
    board: BoardDef | None = None,
) -> SolveResult:
    """Run the app's board on one study under one shared Budget. `llm_for(member)` gives each
    member its client (run.py: app_clients, the app's model tiers); `llm` alone serves every
    member (the scripted model in the self-tests). `run_id` (e.g. "bix-1/rep0") names the run."""
    run_dir = Path(run_dir)
    board = board or load_board()
    if llm_for is None:
        if llm is None:
            raise ValueError("board.solve needs llm_for (one client per member) or llm")
        llm_for = lambda member: llm  # noqa: E731
    sandbox = sandbox or Sandbox(study.data_dir, run_dir / "work")
    logger = RunLogger(run_dir)
    b = _Board(study, budget, llm_for, sandbox, logger, board)
    qids = [q.question_id for q in study.questions]
    logger.log_run_start(
        study_id=study.study_id, questions=qids, solver="board", members=board.members,
        member_models={m: model_of(board, m) for m in board.members},
        model=getattr(llm_for(board.lead.name), "model", None), provider=getattr(llm_for(board.lead.name), "provider", None),
        seed=getattr(llm_for(board.lead.name), "seed", None), max_rounds=board.max_rounds,
        lead_turns=board.lead_turns, agents_dir=str(AGENTS_DIR), config=str(CONFIG_FILE),
        prompt_sha256=prompt_hashes(board), run=run_id or study.study_id, sandbox=settings_of(sandbox),
    )  # fmt: skip
    lead = board.lead.name
    lead_msgs: list[dict] = [{"role": "user", "content": (
        f"{_task_prompt(study)}\n\n{_data_overview(sandbox)}\n\n"
        "Frame the question, then run the review with converse. End with submit_answer."
    )}]  # fmt: skip
    answers: dict[str, str] = {}
    submitted, forced, error, stop_reason = False, False, None, "running"

    def lead_call(tools: list[dict], enforce: bool) -> Any:
        logger.log("member_input", member=lead, round=b.rounds, content=lead_msgs[-1]["content"]
                   if isinstance(lead_msgs[-1]["content"], str) else "(tool results)")  # fmt: skip
        resp = llm_for(lead).chat(lead_msgs, system=b.prompts[lead], tools=tools,
                                  budget=budget, enforce_budget=enforce)  # fmt: skip
        blocks = _content_blocks(resp.text, resp.tool_calls)
        lead_msgs.append({"role": "assistant", "content": blocks})
        logger.log("member_output", member=lead, round=b.rounds, content=blocks, budget=budget.snapshot())
        logger.log("member_reply", member=lead, round=b.rounds, text=resp.text or "")
        return resp

    try:
        for _ in range(board.lead_turns):
            if b.exhausted_reason or budget.exhausted:
                break
            resp = lead_call([CONVERSE_SCHEMA, SUBMIT_SCHEMA], True)
            if not resp.tool_calls:
                lead_msgs.append({"role": "user", "content": "Use converse to run the next round, or submit_answer to finish."})
                continue
            results = []
            for tc in resp.tool_calls:
                budget.record_tool_call()
                logger.log_tool_call(tc.name, tc.id, tc.input, member=lead)
                if tc.name == "converse":
                    out = b.converse(tc.input or {})
                elif tc.name == "submit_answer":
                    parsed = _parse_answers((tc.input or {}).get("answers"))
                    if parsed:
                        answers, submitted = parsed, True
                    out = "Answers saved." if parsed else "ERROR: answers must be an object {question_id: answer}."
                else:
                    out = f"ERROR: unknown tool {tc.name}"
                logger.log_tool_result(tc.id, tc.name, out, member=lead)
                results.append({"type": "tool_result", "tool_use_id": tc.id, "content": out})
            lead_msgs.append({"role": "user", "content": results})
            if submitted:
                break
        if submitted:
            stop_reason = "submitted"
        elif b.exhausted_reason or budget.exhausted:
            b.exhausted_reason = b.exhausted_reason or budget.exhaustion_reason()
            stop_reason = f"budget_exhausted:{b.exhausted_reason}"
        else:
            stop_reason = "lead_turns_used"
    except BudgetExhausted as e:
        b.exhausted_reason = e.reason
        stop_reason = f"budget_exhausted:{e.reason}"
    except Exception as e:  # noqa: BLE001 - record, then still ask for answers
        error = f"{type(e).__name__}: {e}"
        stop_reason = f"error:{error}"

    if not submitted:
        # One last lead call that may only submit (unenforced once the budget is gone), as the
        # baseline's forced final answer.
        forced = True
        lead_msgs.append({"role": "user", "content": (
            "Stop now. Call submit_answer with the board's best answer for every question id, "
            "from the work so far. Never leave an id empty.")})  # fmt: skip
        try:
            resp = lead_call([SUBMIT_SCHEMA], not budget.exhausted)
            for tc in resp.tool_calls:
                if tc.name == "submit_answer":
                    budget.record_tool_call()
                    parsed = _parse_answers((tc.input or {}).get("answers"))
                    if parsed:
                        answers = parsed
        except Exception as e:  # noqa: BLE001
            error = error or f"{type(e).__name__}: {e}"
    if b.exhausted_reason and not stop_reason.startswith("budget"):
        stop_reason += f"|budget_exhausted:{b.exhausted_reason}"
    for q in qids:
        if not str(answers.get(q, "")).strip():
            answers[q] = "<no_answer>"
    if all(v == "<no_answer>" for v in answers.values()):
        stop_reason += "|no_answer_submitted"

    phases = [f"round {i}" + (" (final)" if i == b.final_round else "") for i in range(1, b.rounds + 1)]
    logger.log_final_answer(answers, forced=forced, reason=stop_reason)
    logger.log_run_end(stop_reason=stop_reason, submitted=submitted, forced=forced, error=error,
                       phases=phases, rounds=b.rounds, budget=budget.snapshot())  # fmt: skip
    logger.close()
    return SolveResult(
        study_id=study.study_id, answers=answers, submitted=submitted, forced=forced,
        stop_reason=stop_reason, budget=budget.snapshot(), run_dir=run_dir,
        transcript=run_dir / "transcript.jsonl", final_script=run_dir / "final_script.py", error=error,
    )  # fmt: skip
