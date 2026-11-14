"""The two solvers for BixBench v1.5: one agent, and the GLHF question-answering swarm.

Both get the same image, tools, working rules, model, time limit and token budget. Both record
answers through `submit_answer` into an `AnswerLedger` held by this process (outside the
sandbox), and for both the code here writes /outputs/answers.json, /outputs/METHODS.md and
/outputs/glhf/{ledger.json, FINDINGS.md} when the agents have stopped. No agent writes those.

Swarm: analyst -> critic (blind re-derivation) -> reconciler (only if code finds answers that
do not agree). Orchestration is code: phases, budgets and the final-answer rule are fixed here
and in answers.py.

Blindness is enforced by the operating system, not by the prompt. The analyst works as Unix
user deriv_a and the critic as deriv_b, each in a home directory with mode 700 on the
container's own filesystem; the ledger never enters the sandbox before the run ends. The critic
is shown the analyst's route only, and not even that when the route contains the answer.

Swarm-only extras of the BixBench3 swarm (documentation search, lessons memory) are not wired
into this solver at all, so there is nothing to switch off for a comparison.
"""

from __future__ import annotations

import math
import re
import time
from typing import Any, Literal

from bixbench3.inspect_harness.swarm.solver import Clock, PhaseResult
from bixbench3.inspect_harness.swarm.tools import background_processes
from inspect_ai.agent import Agent, AgentState, react, run
from inspect_ai.model import ChatMessageUser, CompactionAuto, get_model
from inspect_ai.solver import Generate, Solver, TaskState, solver
from inspect_ai.tool import Tool, ToolError, bash_session, python, text_editor, tool
from inspect_ai.util import Limit, message_limit, sample_limits, sandbox, time_limit, token_limit

from . import roles
from .answers import AnswerLedger, Keep
from .dataset import PublicQuestion
from .text import normalise, parse_number

USER_A = "deriv_a"
USER_B = "deriv_b"
# Shares of the run's time and token budgets. The two derivations get the same cap; what the
# analyst leaves unused does not go to the critic, it stays for reconciliation.
DERIVATION_SHARE = 0.42
RECONCILE_RESERVE = 0.16
MIN_PHASE_SECONDS = 10
CRITIC_HINTS = ("route", "none")
CLOCK_MARGIN = 0.97  # the solver stops itself just before the task's hard time limit
# Every model call is charged its whole context, so both solvers compact at a fixed size rather
# than at a share of a context window Inspect may not know for a new model.
COMPACTION_THRESHOLD_TOKENS = 100_000
TOKEN_SEMANTICS = {
    "single": "one agent may spend all of max_tokens. Limits are checked after each model call, "
    "so a run can end slightly over.",
    "glhf": f"analyst and critic may each spend up to {DERIVATION_SHARE:.0%} of max_tokens; the "
    f"critic never cuts into the {RECONCILE_RESERVE:.0%} kept for reconciliation; the reconciler "
    "may spend whatever is left. Limits are checked after each model call.",
}

# Run as root when the sandbox starts. Login shells on Debian reset PATH, which would hide the
# image's tools (conda) from the non-root users, so the image's PATH is restored for every shell.
_SETUP = f"""
set -e
cat > /etc/profile.d/glhf-image-path.sh <<EOS
export PATH="$PATH"
if [ -f /opt/conda/etc/profile.d/conda.sh ]; then
  . /opt/conda/etc/profile.d/conda.sh && conda activate base 2>/dev/null || true
fi
export TMPDIR="\\$HOME/tmp"
EOS
grep -q glhf-image-path /etc/bash.bashrc 2>/dev/null \
  || echo '. /etc/profile.d/glhf-image-path.sh' >> /etc/bash.bashrc
for u in {USER_A} {USER_B}; do
  id "$u" >/dev/null 2>&1 || useradd -m -s /bin/bash "$u"
  mkdir -p /home/$u/work /home/$u/tmp
  chown -R $u:$u /home/$u
  chmod 700 /home/$u
done
mkdir -p {roles.RECONCILE_DIR} /root/tmp
chmod 700 /root
find /outputs -mindepth 1 -maxdepth 1 -exec rm -rf -- {{}} +
"""

# After a derivation: whatever its user left in shared scratch directories becomes unreadable
# to the other user (root, the reconciler, can still read it).
_SEAL = """
for u in {users}; do
  find /tmp /var/tmp /dev/shm -xdev -user "$u" -exec chmod go-rwx {{}} + 2>/dev/null
done
true
"""

# Scripts and notes only: small text files, so /outputs stays small and holds no data copies.
_COLLECT = f"""
for u in {USER_A} {USER_B} root; do
  if [ "$u" = root ]; then src={roles.RECONCILE_DIR}; else src=/home/$u/work; fi
  [ -d "$src" ] || continue
  mkdir -p /outputs/glhf/work/$u
  (cd "$src" && find . -type f -size -200k \\( -name '*.py' -o -name '*.R' -o -name '*.r' \\
      -o -name '*.sh' -o -name '*.md' -o -name '*.log' \\) | head -n 200 \\
      | while read -r f; do mkdir -p "/outputs/glhf/work/$u/$(dirname "$f")"; \\
        cp "$f" "/outputs/glhf/work/$u/$f"; done)
done
true
"""


def allowance(
    phase: Literal["analyst", "critic", "reconciler"], total: float, used: float
) -> float:
    """Tokens (or seconds) a swarm phase may spend, given the run's total and what is spent."""
    left = total - used
    if phase == "analyst":
        return min(left, total * DERIVATION_SHARE)
    if phase == "critic":
        return min(total * DERIVATION_SHARE, left - total * RECONCILE_RESERVE)
    return left


def route_reveals(route: str, answer: str) -> bool:
    """True if a route description gives away the answer it led to (then the critic is not
    shown it). Errs towards withholding: any number in the route equal to a numeric answer."""
    tokens = re.findall(r"[A-Za-z0-9_.+\-%]+", route)
    target = parse_number(answer)
    if target is not None:
        for token in tokens:
            value = parse_number(token.strip(".,;:()"))
            if value is not None and math.isclose(value, target, rel_tol=1e-9, abs_tol=1e-12):
                return True
        return False
    wanted = normalise(answer)
    if not wanted:
        return False
    if len(wanted) <= 2:  # a letter or a two-character symbol: whole tokens only
        return any(normalise(token) == wanted for token in tokens)
    return wanted in normalise(route)


def route_hints(ledger: AnswerLedger) -> str:
    """What the critic is told about the first derivation: a route per question, never a result."""
    lines = []
    for question_id in ledger.questions:
        first = ledger.current(question_id, ledger.primary)
        if first is None:
            hint = "(no first derivation recorded)"
        elif not first.route or route_reveals(first.route, first.answer):
            hint = "(withheld)"
        else:
            hint = " ".join(first.route.split())[:400]
        lines.append(f"- {question_id}: {hint}")
    return "\n".join(lines)


def dispute_text(ledger: AnswerLedger) -> str:
    blocks = []
    for question_id in ledger.disputes():
        first, second = ledger.pair(question_id)
        assert first is not None and second is not None
        kind = (
            "different answers"
            if ledger.comparison(question_id) == "differ"
            else "worded differently; code could not compare them"
        )
        blocks.append(
            f"### {question_id} ({kind})\n"
            f"A answered: {first.answer}\n  route: {first.route}\n  evidence: {first.evidence}\n"
            f"B answered: {second.answer}\n  route: {second.route}\n  evidence: {second.evidence}"
        )
    return "\n\n".join(blocks)


def _budget_note(seconds: int, tokens: int | None, messages: int | None) -> str:
    parts = [f"about {max(1, seconds // 60)} minutes ({seconds} s)"]
    if tokens:
        parts.append(f"{tokens:,} tokens (every model call counts its whole context)")
    if messages:
        parts.append(f"{messages} messages")
    return (
        "\n\nYour budget: "
        + ", ".join(parts)
        + ". You are cut off without warning when it ends, and only answers already recorded "
        "with submit_answer count. Submit each answer as soon as you have it."
    )


@tool
def submit_answer(ledger: AnswerLedger, role: str, options: dict[str, int] | None = None) -> Tool:
    async def execute(question_id: str, answer: str, route: str, evidence: str) -> str:
        """Record your answer to one question. Call it again for the same question to replace it.

        Args:
            question_id: The question's id, as given in the task (e.g. "bix-1-q2").
            answer: The answer, exactly as it should be reported, and nothing else.
            route: How you derived it, in one or two lines (inputs, tool, parameters), without
                the resulting value.
            evidence: The script path and the output line that shows the value.
        """
        if options is not None and question_id in options:
            letters = [chr(65 + i) for i in range(options[question_id])]
            if answer.strip().upper() not in letters:
                raise ToolError(f"answer must be one letter of {', '.join(letters)}")
            answer = answer.strip().upper()
        try:
            derivation = ledger.submit(question_id, answer, route, evidence, role)
        except ValueError as error:
            raise ToolError(str(error)) from error
        missing = ledger.unanswered(role)
        return f"Recorded {derivation.id} for {question_id}. " + (
            f"Not yet answered: {', '.join(missing)}."
            if missing
            else "Every question has an answer."
        )

    return execute


@tool
def resolve_dispute(ledger: AnswerLedger, role: str) -> Tool:
    async def execute(
        question_id: str,
        keep: Literal["A", "B", "both", "neither"],
        final_answer: str,
        cause: str,
        evidence: str,
    ) -> str:
        """Record the outcome of examining two derivations that do not agree.

        Args:
            question_id: The question's id.
            keep: "A" or "B" for the derivation that is right; "both" if they are the same
                finding; "neither" if both are wrong and you derived the answer yourself.
            final_answer: The answer to report, in the format the question asks for.
            cause: The specific difference between the derivations that explains the mismatch.
            evidence: The script path and output that shows which is right.
        """
        try:
            ledger.resolve(question_id, _keep(keep), final_answer, cause, evidence, role)
        except ValueError as error:
            raise ToolError(str(error)) from error
        left = ledger.disputes()
        return f"{question_id} resolved. " + (
            f"Still open: {', '.join(left)}." if left else "No open disputes."
        )

    return execute


def _keep(value: str) -> Keep:
    if value not in ("A", "B", "both", "neither"):
        raise ValueError("keep must be A, B, both or neither")
    return value  # type: ignore[return-value]


def _questions(state: TaskState) -> list[PublicQuestion]:
    return [PublicQuestion.model_validate(q) for q in state.metadata["questions"]]


def _option_counts(questions: list[PublicQuestion]) -> dict[str, int] | None:
    counts = {q.question_id: len(q.options) for q in questions if q.options is not None}
    return counts or None


def _agent(name: str, prompt: str, user: str | None, model: str | None, extra: list[Tool]) -> Agent:
    return react(
        name=name,
        prompt=prompt,
        model=get_model(model) if model else None,
        tools=[
            bash_session(timeout=600, instance=name, user=user),
            python(timeout=600, user=user),
            text_editor(timeout=120, user=user),
            *extra,
        ],
        compaction=CompactionAuto(threshold=COMPACTION_THRESHOLD_TOKENS),
    )


async def _setup() -> None:
    result = await sandbox().exec(["bash", "-c", _SETUP], user="root")
    if not result.success:
        raise RuntimeError(f"sandbox setup failed: {result.stderr[-500:]}")


async def _write_outputs(ledger: AnswerLedger, settings: dict[str, Any]) -> None:
    """Final writes, as root, after every agent has stopped. Overwrites anything an agent may
    have put at these paths."""
    import json

    try:
        killed = await background_processes(kill=True)
        if killed:
            ledger.log("background.killed", processes=killed[:20])
    except Exception as error:  # never block the final writes
        ledger.log("background.kill_failed", error=str(error)[:200])
    await sandbox().exec(["bash", "-c", "mkdir -p /outputs/glhf"], user="root")
    await sandbox().write_file("/outputs/answers.json", json.dumps(ledger.answers(), indent=2))
    await sandbox().write_file("/outputs/METHODS.md", ledger.methods_markdown(settings))
    await sandbox().write_file("/outputs/glhf/FINDINGS.md", ledger.findings_markdown())
    await sandbox().write_file("/outputs/glhf/ledger.json", ledger.to_json())
    await sandbox().exec(["bash", "-c", _COLLECT], user="root", timeout=120)


@solver
def single_agent(
    budget_seconds: int, max_tokens: int | None = None, max_messages: int | None = None
) -> Solver:
    """The baseline: one agent, one context, the whole budget."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        del generate
        questions = _questions(state)
        ledger = AnswerLedger(
            {q.question_id: q.question for q in questions}, "single", primary="single", checker=None
        )
        settings = {
            "budget_seconds": int(budget_seconds * CLOCK_MARGIN),
            "max_tokens": max_tokens,
            "max_messages": max_messages,
            "token_semantics": TOKEN_SEMANTICS["single"] if max_tokens else None,
            "compaction_threshold_tokens": COMPACTION_THRESHOLD_TOKENS,
        }
        ledger.log("settings", **settings)
        await _setup()
        start_tokens = sample_limits().token.usage
        seconds = int(budget_seconds * CLOCK_MARGIN)
        agent = _agent(
            "single",
            roles.rules(f"/home/{USER_A}/work", _option_counts(questions) is not None)
            + "\n\n"
            + roles.SINGLE,
            USER_A,
            None,
            [submit_answer(ledger, "single", _option_counts(questions))],
        )
        limits: list[Limit] = [time_limit(seconds)]
        if max_tokens:
            limits.append(token_limit(max_tokens))
        if max_messages:
            limits.append(message_limit(max_messages))
        prompt = state.input_text + _budget_note(seconds, max_tokens, max_messages)
        try:
            ledger.log("phase.started", phase="single", seconds=seconds, tokens_allowed=max_tokens)
            result = await run(agent, prompt, limits=limits)
            agent_state, limit_error = result if isinstance(result, tuple) else (result, None)
            assert isinstance(agent_state, AgentState)
            state.messages = agent_state.messages
            ledger.log(
                "phase.finished",
                phase="single",
                limit=str(getattr(limit_error, "type", "limit")) if limit_error else None,
                tokens=int(sample_limits().token.usage - start_tokens),
            )
        finally:
            ledger.log("finished", tokens=int(sample_limits().token.usage - start_tokens))
            await _write_outputs(ledger, settings)
            state.output.completion = ledger.findings_markdown()
        return state

    return solve


@solver
def glhf_qa_swarm(
    budget_seconds: int,
    max_tokens: int | None = None,
    max_messages_per_role: int | None = None,
    analyst_model: str | None = None,
    critic_model: str | None = None,
    reconciler_model: str | None = None,
    critic_hints: str = "route",
) -> Solver:
    """analyst -> critic (blind) -> reconciler (if code finds a mismatch). See the module doc.

    `critic_hints="route"` shows the critic the analyst's one-line route (never the result) so
    it can pick a different one; "none" shows it nothing, which removes the risk that the route
    anchors the critic on the analyst's reading of the question."""
    if critic_hints not in CRITIC_HINTS:
        raise ValueError(f"critic_hints must be one of {CRITIC_HINTS}")

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        del generate
        questions = _questions(state)
        options = _option_counts(questions)
        ledger = AnswerLedger({q.question_id: q.question for q in questions}, "glhf")
        clock = Clock(float(budget_seconds) * CLOCK_MARGIN, time.monotonic())
        settings = {
            "budget_seconds": int(clock.budget),
            "max_tokens": max_tokens,
            "max_messages_per_role": max_messages_per_role,
            "token_semantics": TOKEN_SEMANTICS["glhf"] if max_tokens else None,
            "compaction_threshold_tokens": COMPACTION_THRESHOLD_TOKENS,
            "derivation_share": DERIVATION_SHARE,
            "reconcile_reserve": RECONCILE_RESERVE,
            "critic_hints": critic_hints,
            "role_models": {
                "analyst": analyst_model,
                "critic": critic_model,
                "reconciler": reconciler_model,
            },
            "documentation_search": False,
            "lessons_memory": False,
        }
        ledger.log("settings", **settings)
        await _setup()
        start_tokens = sample_limits().token.usage

        def tokens_used() -> int:
            return int(sample_limits().token.usage - start_tokens)

        async def phase(
            title: Literal["analyst", "critic", "reconciler"], who: Agent, task: str
        ) -> PhaseResult:
            seconds = int(allowance(title, clock.budget, clock.budget - clock.left()))
            if seconds < MIN_PHASE_SECONDS:
                ledger.log("phase.skipped", phase=title, reason="time", seconds=seconds)
                return PhaseResult(ran=False)
            limits: list[Limit] = [time_limit(seconds)]
            tokens: int | None = None
            if max_tokens:
                tokens = int(allowance(title, max_tokens, tokens_used()))
                if tokens <= 0:
                    ledger.log("phase.skipped", phase=title, reason="tokens", used=tokens_used())
                    return PhaseResult(ran=False)
                limits.append(token_limit(tokens))
            if max_messages_per_role:
                limits.append(message_limit(max_messages_per_role))
            ledger.log("phase.started", phase=title, seconds=seconds, tokens_allowed=tokens)
            state.messages.append(
                ChatMessageUser(content=f"=== GLHF phase: {title} (budget {seconds}s) ===")
            )
            prompt = f"{state.input_text}\n---\n\n{task}"
            prompt += _budget_note(seconds, tokens, max_messages_per_role)
            result = await run(who, prompt, limits=limits)
            agent_state, limit_error = result if isinstance(result, tuple) else (result, None)
            assert isinstance(agent_state, AgentState)
            state.messages.extend(m for m in agent_state.messages if m.role != "system")
            limit = str(getattr(limit_error, "type", "limit")) if limit_error is not None else None
            ledger.log(
                "phase.finished",
                phase=title,
                limit=limit,
                left=int(clock.left()),
                tokens=tokens_used(),
            )
            try:  # a role that was cut off may have left jobs running
                await background_processes(kill=True)
            except Exception as error:
                ledger.log("background.kill_failed", error=str(error)[:200])
            await sandbox().exec(
                ["bash", "-c", _SEAL.format(users=f"{USER_A} {USER_B}")], user="root", timeout=120
            )
            return PhaseResult(ran=True, limit=limit)

        multiple_choice = options is not None
        analyst = _agent(
            "analyst",
            roles.rules(f"/home/{USER_A}/work", multiple_choice) + "\n\n" + roles.ANALYST,
            USER_A,
            analyst_model,
            [submit_answer(ledger, "analyst", options)],
        )
        critic = _agent(
            "critic",
            roles.rules(f"/home/{USER_B}/work", multiple_choice) + "\n\n" + roles.CRITIC,
            USER_B,
            critic_model,
            [submit_answer(ledger, "critic", options)],
        )
        reconciler = _agent(
            "reconciler",
            roles.rules(roles.RECONCILE_DIR, multiple_choice, answering=False)
            + "\n\n"
            + roles.RECONCILER,
            "root",
            reconciler_model,
            [resolve_dispute(ledger, "reconciler")],
        )
        try:
            await phase("analyst", analyst, "Answer every question.")
            critic_task = "Derive every answer independently."
            if critic_hints == "route":
                critic_task += (
                    f"\n\nRoute of the first derivation, per question:\n{route_hints(ledger)}"
                )
            await phase("critic", critic, critic_task)
            for question_id in ledger.questions:
                ledger.log(
                    "answers.compared", question=question_id, result=ledger.comparison(question_id)
                )
            if ledger.disputes():
                await phase(
                    "reconciler",
                    reconciler,
                    f"Resolve these mismatches.\n\n{dispute_text(ledger)}",
                )
                if ledger.disputes():
                    ledger.log("disputes.unresolved", questions=ledger.disputes())
            else:
                ledger.log("reconcile.not_needed")
        finally:
            ledger.log("finished", tokens=tokens_used())
            await _write_outputs(ledger, settings)
            state.output.completion = ledger.findings_markdown()
        return state

    return solve
