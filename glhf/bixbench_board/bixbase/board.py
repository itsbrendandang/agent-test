"""Board solver: the 5 strong board members from agent-test on a BixBench study.

Same interface as bixbase.agent.solve, so run.py, the sandbox, the Budget, the
logger and the grader stay shared with the single-agent baseline. ONE Budget is
shared by every member, so the board gets the same caps as the baseline.

Members (prompts read at run time from the repository's board/agents/, or from
BOARD_AGENTS_DIR; their sha256 is logged in run_start):
  proposer         plans one claim (an answer) per question. No tools.
  experimenter     Full mode: runs the analysis (Python or R) and records draft
                   answers. Revise mode: fixes what the reviewers flagged.
  methods-auditor  checks the methods. No tools.
  critic           tries to break each draft answer. No tools. Runs in
                   parallel with the auditor and does not see its report.
  reporter         writes the final answers via submit_answer. No tools.

The lead scientist is this code: it runs the fixed order above and splits the
budget. Edits to the prompts, all made here in code (the .md files are not changed):
  - lines about "the lead gives you no task" are dropped (every turn has a task);
  - the experimenter's "You cannot run code on this board yet" line is replaced,
    because in this benchmark it can run code;
  - the critic's "different model vendor" line is dropped: every member uses
    the solver model so the comparison with the baseline is model-fair;
  - a shared BENCHMARK header explains claims = answers and the shared budget.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .agent import SolveResult, _content_blocks, _execute_tool, _task_prompt
from .budget import Budget, BudgetExhausted
from .llm import LLMClient
from .loader import Study
from .logger import RunLogger
from .sandbox import Sandbox

AGENTS_DIR = Path(
    os.environ.get("BOARD_AGENTS_DIR")
    or Path(__file__).resolve().parents[3] / "board" / "agents"
)
MEMBERS = ["proposer", "experimenter", "methods-auditor", "critic", "reporter"]

# share of each cap the experimenter may use before the next phase starts
FULL_PHASE_SHARE = 0.60
REVIEW_START_LIMIT = 0.80  # skip review/revise when this much is gone
REVISE_PHASE_SHARE = 0.90
LOG_CHARS = 30_000

_DROP_PATTERNS = [
    re.compile(r"lead gives you no task", re.I),
    re.compile(r"different model vendor", re.I),
]
_NO_CODE = re.compile(r"You cannot run code on this board yet\.[^\n]*")
_CAN_CODE = (
    "In this benchmark you can run code: use run_code (Python or R). Do not "
    "report a number you did not compute."
)

BENCHMARK_HEADER = """BENCHMARK MODE. The board is answering a BixBench data-analysis study.
- The study data is read-only in DATA_DIR. Only the Experimenter can run code (Python or R).
- Each question is one claim. The claim is the answer to that question id.
- Final answers are graded against hidden reference answers. Short, exact answers (a number,
  a gene name, a short phrase) score best. A refusal scores as wrong.
- One budget is shared by the whole board: {caps}. Be brief."""

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
            "language": {"type": "string", "enum": ["python", "r"],
                         "default": "python"},
        },
        "required": ["code"],
    },
}
ANSWERS_PROP = {
    "type": "object",
    "description": "{question_id: answer_string}",
    "additionalProperties": {"type": "string"},
}
RECORD_DRAFT_SCHEMA = {
    "name": "record_draft",
    "description": (
        "Hand your results to the reviewers. answers maps each question id "
        "to your concise answer; evidence maps each question id to one or "
        "two lines on how you computed it."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "answers": ANSWERS_PROP,
            "evidence": {"type": "object",
                         "additionalProperties": {"type": "string"}},
        },
        "required": ["answers"],
    },
}
SUBMIT_SCHEMA = {
    "name": "submit_answer",
    "description": (
        "Submit the board's final answers. answers maps each question id to "
        "the final concise answer. Call exactly once."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"answers": ANSWERS_PROP},
        "required": ["answers"],
    },
}


def _strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4:].lstrip()
    return text


def load_member_prompt(name: str, agents_dir: Path = AGENTS_DIR) -> str:
    body = _strip_frontmatter((agents_dir / f"{name}.md").read_text())
    body = _NO_CODE.sub(_CAN_CODE, body)
    lines = [ln for ln in body.splitlines()
             if not any(p.search(ln) for p in _DROP_PATTERNS)]
    return "\n".join(lines).strip()


def prompt_hashes(agents_dir: Path = AGENTS_DIR) -> dict[str, str]:
    return {m: hashlib.sha256((agents_dir / f"{m}.md").read_bytes()).hexdigest()[:16]
            for m in MEMBERS}


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


def _parse_answers(raw) -> dict[str, str] | None:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, dict):
        return None
    return {str(k): str(v) for k, v in raw.items()}


class _Board:
    def __init__(self, study, budget, llm, sandbox, logger):
        self.study = study
        self.budget = budget
        self.llm = llm
        self.sandbox = sandbox
        self.logger = logger
        self.lock = threading.Lock()
        self.header = BENCHMARK_HEADER.format(caps=_caps_text(budget))
        self.prompts = {m: load_member_prompt(m) + "\n\n" + self.header
                        for m in MEMBERS}
        self.task = _task_prompt(study)
        self.work_log: list[str] = []
        self.forced = False
        self.exhausted_reason: str | None = None

    def log(self, event: str, **kw):
        with self.lock:
            self.logger.log(event, **kw)

    def ask(self, member: str, content: str, *, tools=None,
            enforce_budget=True):
        """One turn for a member with an empty context."""
        msgs = [{"role": "user", "content": content}]
        self.log("member_input", member=member, content=content)
        resp = self.llm.chat(msgs, system=self.prompts[member], tools=tools,
                             budget=self.budget, enforce_budget=enforce_budget)
        self.log("member_output", member=member,
                 content=_content_blocks(resp.text, resp.tool_calls),
                 budget=self.budget.snapshot())
        return resp

    # -- experimenter tool loop ----------------------------------------------

    def experimenter_loop(self, messages, *, stop_share, final_tool):
        """Run tools until final_tool is called or stop_share of the budget is
        used. Returns (answers or None, evidence)."""
        tools = [RUN_CODE_SCHEMA] + [
            t for t in _BASE_TOOLS if t["name"] in ("list_dir", "read_file")
        ] + [final_tool]
        while True:
            if _used_share(self.budget) >= stop_share:
                return None, {}
            try:
                resp = self.llm.chat(messages, system=self.prompts["experimenter"],
                                     tools=tools, budget=self.budget)
            except BudgetExhausted as e:
                self.exhausted_reason = e.reason
                return None, {}
            blocks = _content_blocks(resp.text, resp.tool_calls)
            messages.append({"role": "assistant", "content": blocks})
            self.log("member_output", member="experimenter", content=blocks,
                     budget=self.budget.snapshot())
            if not resp.tool_calls:
                messages.append({"role": "user", "content": (
                    f"Continue: use a tool, or call {final_tool['name']}.")})
                continue
            results, done = [], None
            for tc in resp.tool_calls:
                self.budget.record_tool_call()
                self.logger.log_tool_call(tc.name, tc.id, tc.input)
                text, found = self._run_tool(tc)
                if found is not None:
                    done = found
                self.logger.log_tool_result(tc.id, tc.name, text)
                results.append({"type": "tool_result", "tool_use_id": tc.id,
                                "content": text})
            messages.append({"role": "user", "content": results})
            if done is not None:
                return done

    def _run_tool(self, tc):
        name, inp = tc.name, tc.input or {}
        try:
            if name == "run_code":
                code = inp.get("code", "")
                lang = "r" if str(inp.get("language", "python")).lower() in (
                    "r", "rscript") else "python"
                if not code.strip():
                    return "ERROR: empty code", None
                res = self.sandbox.run_code(code, language=lang)
                self.logger.log_code_cell(
                    code if lang == "python" else _r_as_comment(code), res)
                text = res.tool_result_text()
                self.work_log.append(
                    f"[{lang}]\n{code[:1200]}\n--> {text[:1500]}")
                return text, None
            if name in ("record_draft", "submit_answer"):
                answers = _parse_answers(inp.get("answers"))
                if answers is None:
                    return ("ERROR: answers must be an object "
                            "{question_id: answer}."), None
                evidence = inp.get("evidence") or {}
                if not isinstance(evidence, dict):
                    evidence = {}
                return "recorded", (answers, {str(k): str(v)
                                              for k, v in evidence.items()})
            text, _ = _execute_tool(name, inp, self.sandbox, self.logger)
            return text, None
        except (PermissionError, OSError, RuntimeError) as e:
            return f"ERROR: {e}", None

    def force_draft(self, messages):
        """One call that only allows record_draft (on exhaustion: unenforced)."""
        messages.append({"role": "user", "content": (
            "Stop analysing now. Call record_draft with your best answer for "
            "every question from the work you have done.")})
        exhausted = self.budget.exhausted
        try:
            resp = self.llm.chat(messages, system=self.prompts["experimenter"],
                                 tools=[RECORD_DRAFT_SCHEMA], budget=self.budget,
                                 enforce_budget=not exhausted)
        except BudgetExhausted as e:
            self.exhausted_reason = e.reason
            return None, {}
        self.log("member_output", member="experimenter",
                 content=_content_blocks(resp.text, resp.tool_calls),
                 budget=self.budget.snapshot())
        for tc in resp.tool_calls:
            if tc.name == "record_draft":
                self.budget.record_tool_call()
                _, found = self._run_tool(tc)
                if found is not None:
                    return found
        return None, {}

    def work_log_text(self) -> str:
        out, size = [], 0
        for entry in reversed(self.work_log):
            if size + len(entry) > LOG_CHARS:
                out.append("[earlier cells omitted]")
                break
            out.append(entry)
            size += len(entry)
        return "\n\n".join(reversed(out)) or "(no code was run)"


_BASE_TOOLS = __import__("bixbase.agent", fromlist=["TOOL_SCHEMAS"]).TOOL_SCHEMAS


def _r_as_comment(code: str) -> str:
    return "# [R cell]\n" + "\n".join("# " + ln for ln in code.splitlines())


def _fmt_answers(answers: dict, evidence: dict | None = None) -> str:
    if not answers:
        return "(none)"
    rows = []
    for k, v in answers.items():
        ev = (evidence or {}).get(k)
        rows.append(f"- [{k}] {v}" + (f"\n  evidence: {ev}" if ev else ""))
    return "\n".join(rows)


def solve(
    study: Study,
    budget: Budget,
    *,
    llm: LLMClient,
    run_dir: Path,
    sandbox: Sandbox | None = None,
) -> SolveResult:
    """Run the 5-member board on one study under one shared Budget."""
    run_dir = Path(run_dir)
    sandbox = sandbox or Sandbox(study.data_dir, run_dir / "work")
    logger = RunLogger(run_dir)
    b = _Board(study, budget, llm, sandbox, logger)
    qids = [q.question_id for q in study.questions]
    logger.log_run_start(study_id=study.study_id, model=llm.model,
                         provider=llm.provider, seed=llm.seed, questions=qids,
                         solver="board", members=MEMBERS,
                         agents_dir=str(AGENTS_DIR), prompt_sha256=prompt_hashes())
    phases: list[str] = []
    answers: dict[str, str] = {}
    draft: dict[str, str] = {}
    evidence: dict[str, str] = {}
    submitted = False
    error = None
    stop_reason = "running"

    try:
        # 1. proposer
        plan = "(no plan)"
        overview = _data_overview(sandbox)
        try:
            resp = b.ask("proposer", (
                f"{b.task}\n\n{overview}\n\nPlan one claim per question id: "
                "what to compute, from which files, which method, and a "
                "falsification test. Keep it under 400 words."))
            plan = resp.text or plan
            phases.append("proposer")
        except BudgetExhausted as e:
            b.exhausted_reason = e.reason

        # 2. experimenter, Full mode
        exp_msgs = [{"role": "user", "content": (
            f"Mode: Full\n\n{b.task}\n\n{overview}\n\nProposer's plan:\n{plan}"
            "\n\nRun the analysis. When every question has an answer, call "
            "record_draft.")}]
        b.log("member_input", member="experimenter",
              content=exp_msgs[0]["content"])
        if b.exhausted_reason is None:
            phases.append("experimenter:full")
            found = b.experimenter_loop(exp_msgs, stop_share=FULL_PHASE_SHARE,
                                        final_tool=RECORD_DRAFT_SCHEMA)
            draft, evidence = found if found[0] is not None else (None, {})
            if draft is None:
                draft, evidence = b.force_draft(exp_msgs)
            draft = draft or {}

        # 3. methods-auditor and critic, in parallel, blind to each other
        reviews: dict[str, str] = {}
        if (b.exhausted_reason is None and draft
                and _used_share(budget) < REVIEW_START_LIMIT):
            review_input = (
                f"{b.task}\n\nProposer's plan:\n{plan}\n\nExperimenter's draft "
                f"answers:\n{_fmt_answers(draft, evidence)}\n\nExperimenter's "
                f"code and outputs:\n{b.work_log_text()}\n\nReview each "
                "question id. For each one write OK, or FLAG with the exact "
                "fix needed. End with a line 'FLAGGED: <ids>' or "
                "'FLAGGED: none'. Under 300 words.")

            def _review(member):
                try:
                    return member, b.ask(member, review_input).text
                except BudgetExhausted as e:
                    b.exhausted_reason = e.reason
                    return member, None

            with ThreadPoolExecutor(max_workers=2) as pool:
                for member, text in pool.map(
                        _review, ["methods-auditor", "critic"]):
                    if text:
                        reviews[member] = text
                        phases.append(member)

        # 4. experimenter, Revise mode (same conversation as Full)
        flagged = any(not re.search(r"FLAGGED:\s*none", t, re.I)
                      for t in reviews.values())
        if (reviews and flagged and b.exhausted_reason is None
                and _used_share(budget) < REVISE_PHASE_SHARE):
            phases.append("experimenter:revise")
            exp_msgs.append({"role": "user", "content": (
                "Mode: Revise\n\n" + "\n\n".join(
                    f"{m} report:\n{t}" for m, t in reviews.items())
                + "\n\nFix what is flagged (run code if needed). Then call "
                "record_draft with the full, updated answer set.")})
            found = b.experimenter_loop(exp_msgs, stop_share=REVISE_PHASE_SHARE,
                                        final_tool=RECORD_DRAFT_SCHEMA)
            if found[0] is not None:
                draft, evidence = found

        # 5. reporter writes the final answers
        exhausted = budget.exhausted
        if exhausted:
            b.forced = True
            b.exhausted_reason = b.exhausted_reason or budget.exhaustion_reason()
        rep_input = (
            f"{b.task}\n\nExperimenter's answers (latest):\n"
            f"{_fmt_answers(draft, evidence)}\n\n"
            + ("".join(f"{m} report:\n{t}\n\n" for m, t in reviews.items()))
            + ("" if draft else
               f"The experimenter recorded no answers. Its work log:\n"
               f"{b.work_log_text()}\n\n")
            + "Write the final answer for every question id and call "
            "submit_answer. Keep each answer short and exact. Keep the "
            "experimenter's answer unless a review shows it is wrong and "
            "gives the fix. Never leave an id empty: give the best estimate.")
        phases.append("reporter")
        resp = b.ask("reporter", rep_input, tools=[SUBMIT_SCHEMA],
                     enforce_budget=not exhausted)
        for tc in resp.tool_calls:
            if tc.name == "submit_answer":
                budget.record_tool_call()
                parsed = _parse_answers((tc.input or {}).get("answers"))
                if parsed:
                    answers = parsed
                    submitted = True
        stop_reason = "submitted" if submitted else "reporter_no_submit"
    except BudgetExhausted as e:
        b.forced = True
        stop_reason = f"budget_exhausted:{e.reason}"
    except Exception as e:  # noqa: BLE001 - record and fall back
        error = f"{type(e).__name__}: {e}"
        stop_reason = f"error:{error}"

    # fill ids the reporter skipped with the experimenter's answers
    for q in qids:
        if not answers.get(q, "").strip() and draft.get(q, "").strip():
            answers[q] = draft[q]
    if not submitted and answers:
        b.forced = True
    if b.exhausted_reason and not stop_reason.startswith("budget"):
        stop_reason += f"|budget_exhausted:{b.exhausted_reason}"
    if not answers:
        answers = {q: "<no_answer>" for q in qids}
        stop_reason += "|no_answer_submitted"

    logger.log_final_answer(answers, forced=b.forced, reason=stop_reason)
    logger.log_run_end(stop_reason=stop_reason, submitted=submitted,
                       forced=b.forced, error=error, phases=phases,
                       budget=budget.snapshot())
    logger.close()
    return SolveResult(
        study_id=study.study_id, answers=answers, submitted=submitted,
        forced=b.forced, stop_reason=stop_reason, budget=budget.snapshot(),
        run_dir=run_dir, transcript=run_dir / "transcript.jsonl",
        final_script=run_dir / "final_script.py", error=error)
