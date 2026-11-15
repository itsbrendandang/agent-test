"""The two solvers for BixBench v1.5: one agent, and the GLHF question-answering swarm.

Both get the same image, tools, working rules, model and time limit. Both record answers through
`submit_answer` into an `AnswerLedger` held by this process (outside the sandbox), and for both
the code here writes /outputs/answers.json, /outputs/METHODS.md and /outputs/glhf/{ledger.json,
FINDINGS.md} when the agents have stopped. No agent writes those.

Swarm: analyst -> critic (blind) -> reconciler (re-derives). Orchestration is code: phases,
budgets, who sees what, and the final-answer rule are fixed here and in answers.py.

Budget (`plan_budget`). Each role has a floor derived from the number of questions. The analyst
may spend everything that is not held back for the later floors; the critic gets what is left
minus the reconciler's floor; the reconciler gets the rest. Unused tokens roll forward. A run
whose total cannot cover the three floors is refused before anything starts. `swarm_budget`:
  equal     the swarm's total is the single agent's budget (a "same budget" result);
  extended  the analyst gets the single agent's whole budget and the total is larger
            (a "more budget" result). run.json records which.
A solver that stops with questions unanswered gets one forced final turn from a small reserve
inside its budget: a short prompt holding the tail of its own work log, no tools but
submit_answer. The single agent and each swarm derivation get the same turn from the same
reserve (`BudgetPolicy.final_reserve`). A submit_answer call made in the very model call that
crossed a limit is executed before the limit takes effect (`pending_submits`), for both.

Blindness (`_BLIND`, `blind_check`). The critic's prompt is built without access to the ledger:
the capsule's questions and its own instructions, nothing else. Before it starts, root kills
every process of the analyst's user (by uid, so a renamed process cannot hide), moves every
file that user owns outside its home into a root-only folder, takes over the analyst's home,
empties /outputs, empties /dev/mqueue (its own mount), removes every System V shared-memory
segment, message queue and semaphore, and gives the critic a new empty working directory; then
a check run as the critic's user must find none of these, or the critic does not run.

Reconciler. It sees both answers, each side's one-line method and the commands and outputs that
produced each answer (taken from the transcripts by code, not the roles' prose). It records
nothing by assertion: `rederive` runs the reconciler's own script and takes the value that
script prints. On a disagreement, code then decides which side that value supports. On an
agreement it is a spot check; when both sides used the same method (`same_method`) the
agreement is flagged as weaker and the reconciler's differing derivation may replace it.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from bixbench3.inspect_harness.swarm.solver import Clock, PhaseResult
from bixbench3.inspect_harness.swarm.tools import background_processes
from inspect_ai.agent import Agent, AgentState, react, run
from inspect_ai.event import ModelEvent
from inspect_ai.log import transcript
from inspect_ai.model import (
    ChatMessage,
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageTool,
    ChatMessageUser,
    CompactionAuto,
    execute_tools,
    get_model,
)
from inspect_ai.solver import Generate, Solver, TaskState, solver
from inspect_ai.tool import Tool, ToolError, bash_session, python, text_editor, tool
from inspect_ai.util import Limit, message_limit, sample_limits, sandbox, time_limit, token_limit

from . import roles
from .answers import AnswerLedger, Keep, compare
from .dataset import PublicQuestion
from .text import normalise, parse_number

USER_A = "deriv_a"
USER_B = "deriv_b"
QUARANTINE = "/root/quarantine"
Phase = Literal["analyst", "critic", "reconciler"]
SwarmBudget = Literal["equal", "extended"]
SWARM_BUDGETS: tuple[SwarmBudget, ...] = ("equal", "extended")
SWARM_BUDGET_ENV = "BIXBENCH_V1_SWARM_BUDGET"
# Shares of the run's TIME. Tokens are planned by `plan_budget`, not by shares.
DERIVATION_SHARE = 0.42
RECONCILE_RESERVE = 0.16
MIN_PHASE_SECONDS = 10
FORCED_TURN_SECONDS = 120
REDERIVE_TIMEOUT_SECONDS = 600
# Kept so the command line's --critic-hints still parses. "route" is no longer honoured: the
# critic is never shown anything of the analyst's.
CRITIC_HINTS = ("route", "none")
CLOCK_MARGIN = 0.97  # the solver stops itself just before the task's hard time limit
# Every model call is charged its whole context, so both solvers compact at a fixed size rather
# than at a share of a context window Inspect may not know for a new model.
COMPACTION_THRESHOLD_TOKENS = 100_000
SAME_METHOD_THRESHOLD = 0.5  # token overlap (Jaccard) of two method lines
EXEC_TOOLS = ("bash_session", "python", "text_editor")
TOKEN_SEMANTICS = {
    "single": "one agent may spend max_tokens: all but the final-turn reserve while working, "
    "and the reserve for a forced final turn if it stops with questions unanswered (the same "
    "reserve a swarm derivation has). Limits are checked after each model call, so a run can "
    "end slightly over; answers submitted in the call that crossed the limit are recorded.",
    "glhf": "each role has a floor derived from the number of questions; the analyst may spend "
    "the total minus the critic's and reconciler's floors (extended: the single agent's whole "
    "budget), the critic what is left minus the reconciler's floor, the reconciler the rest; "
    "unused tokens roll forward; a derivation that ends with questions unanswered gets a forced "
    "final turn from a reserve inside its allowance. Limits are checked after each model call; "
    "answers submitted in the call that crossed a limit are recorded.",
}


# Budget -------------------------------------------------------------------------------------
class BudgetError(ValueError):
    """The run's token budget cannot cover the swarm's role floors. Raised before any role runs."""


@dataclass(frozen=True)
class BudgetPolicy:
    """Token floors per role, from the number of questions. A derivation loads and reads the
    data once (base) and then works per question; the reconciler reads two derivations and
    writes one short script per question it re-derives."""

    derivation_base: int = 50_000
    derivation_per_question: int = 35_000
    reconciler_base: int = 30_000
    reconciler_per_question: int = 10_000
    final_reserve: int = 15_000  # inside a derivation's allowance, for the forced final turn
    extended_multiplier: float = 2.25  # extended total = this times the single agent's budget

    def floors(self, questions: int) -> dict[str, int]:
        derivation = self.derivation_base + self.derivation_per_question * questions
        reconciler = self.reconciler_base + self.reconciler_per_question * questions
        return {"analyst": derivation, "critic": derivation, "reconciler": reconciler}


@dataclass(frozen=True)
class BudgetPlan:
    mode: SwarmBudget
    single_budget: int  # what the single agent gets for the same run
    total: int  # what the swarm may spend in all
    floors: dict[str, int]
    final_reserve: int

    @property
    def reading(self) -> str:
        return "same budget" if self.total <= self.single_budget else "more budget"

    def allowance(self, phase: Phase, used: int) -> int:
        """Tokens a phase may spend given what earlier phases really used. Whatever they left
        rolls forward; a phase never gets less than its floor (an earlier phase can only eat
        into it by the one model call that took it over its own limit)."""
        left = self.total - used
        if phase == "analyst":
            share = self.total - self.floors["critic"] - self.floors["reconciler"]
            return max(self.floors["analyst"], min(share, self.single_budget, left))
        if phase == "critic":
            return max(self.floors["critic"], left - self.floors["reconciler"])
        return max(self.floors["reconciler"], left)

    def describe(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "reading": self.reading,
            "single_budget_tokens": self.single_budget,
            "swarm_total_tokens": self.total,
            "floors": dict(self.floors),
            "final_reserve": self.final_reserve,
            "analyst_allowance": self.allowance("analyst", 0),
        }


def single_reserve(max_tokens: int, policy: BudgetPolicy | None = None) -> int:
    """The single agent's reserve for its forced final turn: the swarm derivations' reserve,
    or half its budget if the budget is smaller than two reserves (toy budgets in tests)."""
    return min((policy or BudgetPolicy()).final_reserve, max_tokens // 2)


def swarm_budget_mode(value: str | None = None) -> SwarmBudget:
    """The budget mode: the argument, else $BIXBENCH_V1_SWARM_BUDGET, else "equal"."""
    chosen = value or os.environ.get(SWARM_BUDGET_ENV) or "equal"
    if chosen not in SWARM_BUDGETS:
        raise ValueError(f"swarm budget must be one of {SWARM_BUDGETS}; got {chosen!r}")
    return chosen


def plan_budget(
    max_tokens: int,
    questions: int,
    mode: SwarmBudget = "equal",
    policy: BudgetPolicy | None = None,
) -> BudgetPlan:
    """The swarm's token plan for a run whose single-agent budget is `max_tokens`.
    Raises BudgetError if the total cannot hold the three floors."""
    policy = policy or BudgetPolicy()
    floors = policy.floors(questions)
    total = max_tokens if mode == "equal" else int(max_tokens * policy.extended_multiplier)
    need = sum(floors.values())
    if total < need:
        raise BudgetError(
            f"swarm budget of {total:,} tokens ({mode}) cannot cover the role floors for "
            f"{questions} question(s): analyst {floors['analyst']:,} + critic {floors['critic']:,} "
            f"+ reconciler {floors['reconciler']:,} = {need:,}. Raise the run's token budget to at "
            f"least {need if mode == 'equal' else int(need / policy.extended_multiplier) + 1:,}"
            + (" or use the extended swarm budget." if mode == "equal" else ".")
        )
    return BudgetPlan(mode, max_tokens, total, floors, policy.final_reserve)


def allowance(phase: Phase, total: float, used: float) -> float:
    """SECONDS a swarm phase may spend, given the run's total and what is spent. (Tokens are
    planned by `BudgetPlan.allowance`.)"""
    left = total - used
    if phase == "analyst":
        return min(left, total * DERIVATION_SHARE)
    if phase == "critic":
        return min(total * DERIVATION_SHARE, left - total * RECONCILE_RESERVE)
    return left


# Sandbox scripts ------------------------------------------------------------------------------
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

_SEARCH_ROOTS = "/ /tmp /var/tmp /dev/shm /run"
_PRUNE = "\\( -path /proc -o -path /sys -o -path /data -o -path /root \\) -prune"
# Before the critic starts, as root. Everything the analyst's user owns outside its home is
# moved (not just made unreadable: a file name can carry an answer) into a root-only folder;
# the analyst's home goes to root, so the analyst's own chmod cannot reopen it; /outputs is a
# bind mount where ownership may not be enforced, so all of it is moved; the critic gets new,
# empty work and tmp directories.
# Remove every System V shared-memory segment, message queue and semaphore the calling user
# may remove. Run as root AND as the analyst's user: a container's root has no CAP_IPC_OWNER
# or CAP_SYS_ADMIN by default, so it cannot remove another user's object; its creator can.
_IPC_REMOVE = """
command -v ipcrm >/dev/null 2>&1 && ipcrm -a 2>/dev/null
for kind in shm:m msg:q sem:s; do
  [ -r /proc/sysvipc/${kind%%:*} ] || continue
  tail -n +2 /proc/sysvipc/${kind%%:*} | while read -r _key id _rest; do
    ipcrm -${kind##*:} "$id" 2>/dev/null
  done
done
true
"""
_BLIND = f"""
mkdir -p {QUARANTINE}/outputs && chmod 700 /root {QUARANTINE}
find /dev/mqueue -mindepth 1 -delete 2>/dev/null
chown root:root /home/{USER_A} && chmod 700 /home/{USER_A}
i=0
find {_SEARCH_ROOTS} -xdev {_PRUNE} -o -path /home/{USER_A} -prune -o -user {USER_A} -prune -print0 \
    2>/dev/null | while IFS= read -r -d '' f; do
  i=$((i+1)); mkdir -p {QUARANTINE}/$i; mv -- "$f" {QUARANTINE}/$i/ 2>/dev/null || rm -rf -- "$f"
done
find /outputs -mindepth 1 -maxdepth 1 -exec mv -t {QUARANTINE}/outputs -- {{}} + 2>/dev/null
find /outputs -mindepth 1 -maxdepth 1 -exec rm -rf -- {{}} + 2>/dev/null
rm -rf /home/{USER_B}/work /home/{USER_B}/tmp
mkdir -p /home/{USER_B}/work /home/{USER_B}/tmp
chown -R {USER_B}:{USER_B} /home/{USER_B} && chmod 700 /home/{USER_B}
true
"""

# Run as the critic's user. Any line of output is something of the analyst's the critic could
# see: a path its user owns, a readable analyst home or quarantine, anything in /outputs, a
# working directory that is not empty, a POSIX message queue, or a System V IPC object (the
# last two are checked whoever owns them: nothing has run since the analyst but root's seal).
_BLIND_CHECK = f"""
find /dev/mqueue -mindepth 1 2>/dev/null | head -n 20 | sed 's/^/message queue: /'
for kind in shm msg sem; do
  [ -r /proc/sysvipc/$kind ] || continue
  tail -n +2 /proc/sysvipc/$kind | head -n 20 | while read -r _key id _rest; do
    echo "sysv ipc: $kind id $id"
  done
done
find {_SEARCH_ROOTS} -xdev \\( -path /proc -o -path /sys -o -path /data \\) -prune \
    -o -user {USER_A} -print 2>/dev/null | head -n 20
for d in /home/{USER_A} {QUARANTINE} /root; do
  [ -r "$d" ] && echo "readable: $d"
  ls "$d" >/dev/null 2>&1 && echo "listable: $d"
done
find /outputs -mindepth 1 2>/dev/null | head -n 20
find "$HOME/work" "$HOME/tmp" -mindepth 1 2>/dev/null | head -n 20
true
"""

# Runs inside the sandbox. "kill" (root) kills every process whose real, effective, saved or
# filesystem uid is one of the named users, until none is left; "list" only looks. Selection is
# by uid from /proc/<pid>/status, never by command line: `exec -a inspect-sandbox-tools ...`
# renames a process but cannot change whose it is. Prints what is still there as JSON; a zombie
# counts, since its name stays readable.
_USER_PROCESSES = r"""
import json, os, pwd, signal, sys, time
uids = set()
for name in sys.argv[2:]:
    try: uids.add(pwd.getpwnam(name).pw_uid)
    except KeyError: pass
def owned():
    found = []
    for name in os.listdir("/proc"):
        if not name.isdigit(): continue
        try:
            with open(f"/proc/{name}/status") as fh: lines = fh.read().splitlines()
        except OSError: continue
        fields = dict(line.split(":", 1) for line in lines if ":" in line)
        try: ids = {int(i) for i in fields.get("Uid", "").split()}
        except ValueError: continue
        if ids & uids: found.append({"pid": int(name), "name": fields.get("Name", "").strip()})
    return found
if sys.argv[1] == "kill":
    for _ in range(20):
        left = owned()
        if not left: break
        for process in left:
            try: os.kill(process["pid"], signal.SIGKILL)
            except OSError: pass
        time.sleep(0.25)
print(json.dumps(owned()))
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


# The cross-check record -----------------------------------------------------------------------
@dataclass
class Execution:
    """One command a role ran and what it printed, taken from the transcript by code."""

    id: str
    tool: str
    code: str
    output: str


@dataclass
class Check:
    """The reconciler's own derivation for one question, as its script printed it."""

    question_id: str
    script: str
    printed: str
    answer: str
    action: Literal["rederived", "confirmed", "overturned", "differs_kept"]
    cause: str
    same_method_by_reconciler: bool | None = None


_STOP = frozenset(
    "the a an of on in to for and or by with from as at is are was be per each all any no not "
    "same above data subset procedure tool method using used use via then than that this it its "
    "into over only where which when after before between".split()
)


def method_tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9_]+", text.lower()) if len(t) > 1 and t not in _STOP}


def method_similarity(a: str, b: str) -> float | None:
    """Token overlap (Jaccard) of two one-line method statements; None if one is missing."""
    x, y = method_tokens(a), method_tokens(b)
    if not x or not y:
        return None
    return len(x & y) / len(x | y)


@dataclass
class CrossCheck:
    """What the ledger does not hold: each side's method line, which answers were forced at a
    budget limit, the commands behind each answer, and the reconciler's own derivations."""

    methods: dict[tuple[str, str], str] = field(default_factory=dict)  # (role, question)
    forced: set[tuple[str, str]] = field(default_factory=set)
    evidence: dict[tuple[str, str], list[Execution]] = field(default_factory=dict)
    checks: dict[str, Check] = field(default_factory=dict)
    blind: dict[str, Any] = field(default_factory=dict)

    def similarity(self, ledger: AnswerLedger, question_id: str) -> float | None:
        if ledger.checker is None:
            return None
        return method_similarity(
            self.methods.get((ledger.primary, question_id), ""),
            self.methods.get((ledger.checker, question_id), ""),
        )

    def same_method_by_code(self, ledger: AnswerLedger, question_id: str) -> bool | None:
        similarity = self.similarity(ledger, question_id)
        return None if similarity is None else similarity >= SAME_METHOD_THRESHOLD

    def same_method(self, ledger: AnswerLedger, question_id: str) -> bool | None:
        """Same method if the method lines overlap or the reconciler, having read both sides'
        commands, says so. Errs towards "same": that only weakens an agreement."""
        by_code = self.same_method_by_code(ledger, question_id)
        check = self.checks.get(question_id)
        by_reconciler = check.same_method_by_reconciler if check else None
        if by_code is None and by_reconciler is None:
            return None
        return bool(by_code) or bool(by_reconciler)

    def any_forced(self, ledger: AnswerLedger, question_id: str) -> bool:
        return any((role, question_id) in self.forced for role in (ledger.primary, ledger.checker))

    def weak_agreement(self, ledger: AnswerLedger, question_id: str) -> bool:
        """An agreement that is weak evidence: same method, a forced guess, or a side whose own
        alternative result differs (the answer hangs on a choice both happened to make)."""
        return ledger.comparison(question_id) == "agree" and (
            bool(self.same_method_by_code(ledger, question_id))
            or self.any_forced(ledger, question_id)
            or bool(ledger.sensitive(question_id))
        )


def _clip(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    half = limit // 2
    return f"{text[:half]}\n[... {len(text) - 2 * half} characters cut ...]\n{text[-half:]}"


def executions(messages: list[ChatMessage], prefix: str) -> tuple[list[Execution], dict[str, int]]:
    """Every command in a role's transcript with its output, and for each question the number of
    commands that had run when its (last) answer was submitted."""
    outputs = {m.tool_call_id: m.text for m in messages if isinstance(m, ChatMessageTool)}
    found: list[Execution] = []
    submitted: dict[str, int] = {}
    for message in messages:
        if not isinstance(message, ChatMessageAssistant):
            continue
        for call in message.tool_calls or []:
            if call.function in EXEC_TOOLS:
                arguments = call.arguments
                code = str(
                    arguments.get("code")
                    or arguments.get("input")
                    or json.dumps(arguments, ensure_ascii=False)
                )
                found.append(
                    Execution(
                        f"{prefix}{len(found) + 1}", call.function, code, outputs.get(call.id, "")
                    )
                )
            elif call.function == "submit_answer":
                submitted[str(call.arguments.get("question_id", ""))] = len(found)
    return found, submitted


def evidence_for(done: list[Execution], answer: str, keep: int = 2) -> list[Execution]:
    """The commands most likely to have produced an answer: the last `keep` before it was
    submitted, and the latest earlier one whose output shows the value."""
    chosen = done[-keep:]
    needle = answer.strip().rstrip("%").strip()
    if needle.replace(".", "").replace("-", "").isdigit() and "." in needle:
        needle = needle.rstrip("0").rstrip(".")
    if len(needle) >= 2:
        for execution in reversed(done[:-keep] if keep else done):
            if needle in execution.output:
                chosen = [execution, *chosen]
                break
    return chosen


def review_text(ledger: AnswerLedger, cross: CrossCheck) -> str:
    """What the reconciler is shown: per question both answers, each side's method line and the
    ids of the commands behind it; then each command once with its output. No route or
    evidence prose written by the roles."""
    assert ledger.checker is not None
    sides = (("A", ledger.primary), ("B", ledger.checker))
    blocks: dict[str, list[str]] = {"disagree": [], "weak": [], "agree": []}
    used: dict[str, Execution] = {}
    for question_id in ledger.questions:
        first, second = ledger.pair(question_id)
        if first is None or second is None:
            continue
        comparison = ledger.comparison(question_id)
        if comparison != "agree":
            kind, title = (
                "disagree",
                (
                    "A and B DISAGREE"
                    if comparison == "differ"
                    else "A and B are worded differently; code could not compare them"
                ),
            )
        elif cross.weak_agreement(ledger, question_id):
            kind, title = "weak", "A and B agree, but NOT independently (see below)"
        else:
            kind, title = "agree", "A and B agree, by different methods"
        lines = [f"### {question_id}: {title}"]
        for (label, role), derivation in zip(sides, (first, second), strict=True):
            forced = " [forced estimate at its budget limit, not a finished derivation]" * (
                (role, question_id) in cross.forced
            )
            ran = cross.evidence.get((role, question_id), [])
            used.update({e.id: e for e in ran})
            lines += [
                f"{label} answered: {derivation.answer}{forced}",
                f"  {label} method: {cross.methods.get((role, question_id)) or '(not stated)'}",
                f"  {label} ran: {', '.join(e.id for e in ran) or '(no command recorded)'}",
            ]
        if kind == "weak" and cross.same_method_by_code(ledger, question_id):
            lines.append("  Code finds the two method lines to be the SAME method.")
        for alternative in ledger.sensitive(question_id):
            lines.append(f"  A side's own alternative result differs: {alternative}")
        blocks[kind].append("\n".join(lines))
    parts: list[str] = []
    for kind, heading in (
        ("disagree", "## 1. Disagreements: re-derive every one"),
        ("weak", "## 2. Agreements that are not independent: spot-check every one"),
        ("agree", "## 3. Agreements by different methods: spot-check if budget is left"),
    ):
        if blocks[kind]:
            parts += [heading, *blocks[kind]]
    parts.append("## Commands the two sides ran (A1.. are A's, B1.. are B's)")
    for execution in used.values():
        parts.append(
            f"#### {execution.id} ({execution.tool})\n```\n{_clip(execution.code, 1500)}\n```\n"
            f"output:\n```\n{_clip(execution.output, 1000)}\n```"
        )
    return "\n\n".join(parts)


def review_lists(ledger: AnswerLedger, cross: CrossCheck) -> tuple[list[str], list[str], list[str]]:
    """(open disagreements, weak agreements not yet checked, other agreements not yet checked)."""
    weak: list[str] = []
    other: list[str] = []
    for question_id in ledger.questions:
        if ledger.comparison(question_id) != "agree" or question_id in cross.checks:
            continue
        (weak if cross.weak_agreement(ledger, question_id) else other).append(question_id)
    return ledger.disputes(), weak, other


def final_answers(ledger: AnswerLedger, cross: CrossCheck | None) -> dict[str, Any]:
    """answers.json: the ledger's answers, with the one thing the ledger cannot express applied
    by rule: a same-method (or forced) agreement that the reconciler's own derivation overturned
    reports the reconciler's value as `reconciled`. Other spot-check outcomes go in the note."""
    out = ledger.answers()
    if cross is None:
        return out
    for question_id in ledger.questions:
        if ledger.comparison(question_id) != "agree":
            continue
        entry = out["answers"][question_id]
        check = cross.checks.get(question_id)
        same = cross.same_method(ledger, question_id)
        notes: list[str] = []
        if check is not None and check.action == "overturned":
            entry["answer"], entry["status"] = check.answer, "reconciled"
            notes.append(
                "the two derivations agreed by the same method; the reconciler's own derivation "
                f"differs and replaces them: {check.cause}"
            )
        elif check is not None and check.action == "confirmed":
            notes.append("agreement confirmed by the reconciler's own derivation")
        elif check is not None:
            notes.append(
                f"the reconciler's own derivation gave {check.answer!r}; the agreed answer is kept"
            )
        if same and (check is None or check.action != "overturned"):
            notes.append(
                "same-method agreement: weaker evidence"
                + ("" if check is not None else ", not independently checked")
            )
        if cross.any_forced(ledger, question_id):
            notes.append("one side is a forced estimate made at its budget limit")
        entry["note"] = "; ".join(n for n in [entry.get("note", ""), *notes] if n)
    return out


def question_records(ledger: AnswerLedger, cross: CrossCheck) -> list[dict[str, Any]]:
    """One row per question: both answers, whether they agreed, whether by the same method,
    what the reconciler derived and whether that changed the reported answer."""
    final = final_answers(ledger, cross)["answers"]
    rows: list[dict[str, Any]] = []
    for question_id in ledger.questions:
        first, second = ledger.pair(question_id)
        comparison = ledger.comparison(question_id)
        check = cross.checks.get(question_id)
        before = first or second  # what would be reported with no reconciler
        reported = final[question_id]["answer"]
        changed = bool(
            check is not None
            and before is not None
            and normalise(reported) != normalise(before.answer)
            and compare(reported, before.answer) != "agree"
        )
        checker = ledger.checker or ""
        rows.append(
            {
                "question_id": question_id,
                "analyst_answer": first.answer if first else None,
                "critic_answer": second.answer if second else None,
                "analyst_method": cross.methods.get((ledger.primary, question_id)),
                "critic_method": cross.methods.get((checker, question_id)),
                "analyst_forced": (ledger.primary, question_id) in cross.forced,
                "critic_forced": (checker, question_id) in cross.forced,
                "comparison": comparison,
                "agreed": None if comparison is None else comparison == "agree",
                "method_similarity": (
                    None
                    if cross.similarity(ledger, question_id) is None
                    else round(float(cross.similarity(ledger, question_id) or 0.0), 3)
                ),
                "same_method_by_code": cross.same_method_by_code(ledger, question_id),
                "same_method_by_reconciler": check.same_method_by_reconciler if check else None,
                "same_method": cross.same_method(ledger, question_id),
                "reconciler_answer": check.answer if check else None,
                "reconciler_script": check.script if check else None,
                "reconciler_printed": check.printed if check else None,
                "reconciler_action": check.action if check else None,
                "reconciler_cause": check.cause if check else None,
                "reconciler_changed": changed,
                "final_answer": reported,
                "status": final[question_id]["status"],
                "note": final[question_id]["note"],
            }
        )
    return rows


def records_markdown(rows: list[dict[str, Any]]) -> str:
    def cell(value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, bool):
            return "yes" if value else "no"
        return str(value).replace("|", "/").replace("\n", " ")

    lines = [
        "## Cross-check record",
        "",
        "| Question | Analyst | Critic | Agreed | Same method | Reconciler | Reconciler changed it | Reported |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r['question_id']} | {cell(r['analyst_answer'])}{' (forced)' * r['analyst_forced']} | "
            f"{cell(r['critic_answer'])}{' (forced)' * r['critic_forced']} | {cell(r['agreed'])} | "
            f"{cell(r['same_method'])} | {cell(r['reconciler_answer'])} | "
            f"{cell(r['reconciler_changed'])} | {cell(r['final_answer'])} |"
        )
    return "\n".join(lines) + "\n"


# Blindness ------------------------------------------------------------------------------------
def critic_prompt(brief: str, note: str) -> str:
    """Everything the critic is told besides its role instructions: the capsule's questions and
    its own budget. This function is given nothing the analyst produced, on purpose."""
    return f"{brief}\n---\n\nAnswer every question from the data in /data.{note}"


def analyst_strings(ledger: AnswerLedger, cross: CrossCheck) -> list[str]:
    """Text the analyst produced that must never reach the critic."""
    found = [roles.HOME_A, QUARANTINE]
    for derivation in ledger.derivations:
        if derivation.by != ledger.primary:
            continue
        found += [derivation.route, derivation.evidence]
        found.append(cross.methods.get((ledger.primary, derivation.question_id), ""))
        if len(derivation.answer) >= 6:
            found.append(derivation.answer)
    return [s for s in found if len(s.strip()) >= 6]


def assert_blind_prompt(prompt: str, ledger: AnswerLedger, cross: CrossCheck, brief: str) -> None:
    """Refuse a critic prompt that carries anything of the analyst's (a string that is also in
    the questions themselves does not count)."""
    for text in analyst_strings(ledger, cross):
        if text in prompt and text not in brief:
            raise RuntimeError("the critic's prompt contains text the analyst produced")


async def user_processes(users: list[str], kill: bool, user: str = "root") -> list[dict[str, Any]]:
    """Processes owned by `users` (by uid). `kill=True`, as root, kills them first and returns
    what survived. Raises if the look itself fails: an unknown is not "none"."""
    result = await sandbox().exec(
        ["python3", "-c", _USER_PROCESSES, "kill" if kill else "list", *users],
        user=user,
        timeout=60,
    )
    if not result.success:
        raise RuntimeError(f"process check failed: {(result.stderr or '')[-200:]}")
    found: list[dict[str, Any]] = json.loads(result.stdout or "[]")
    return found


async def blind_check() -> list[str]:
    """Seal the analyst's traces, then look for them as the critic's user. Returns what the
    critic could still see (empty = blind): files, a process of the analyst's user (it could
    serve data on loopback), a POSIX message queue, a System V IPC object."""
    lines: list[str] = []
    try:
        await user_processes([USER_A], kill=True)
    except Exception as error:
        lines.append(f"process kill failed: {error}"[:200])
    for owner in (USER_A, "root"):  # after the kill: nothing of the analyst's is attached
        await sandbox().exec(["bash", "-c", _IPC_REMOVE], user=owner, timeout=60)
    await sandbox().exec(["bash", "-c", _BLIND], user="root", timeout=180)
    seen = await sandbox().exec(["bash", "-c", _BLIND_CHECK], user=USER_B, timeout=120)
    lines += [line for line in (seen.stdout or "").splitlines() if line.strip()]
    if not seen.success:
        lines.append(f"check failed: {(seen.stderr or '')[-200:]}")
    try:
        alive = await user_processes([USER_A], kill=False, user=USER_B)
        lines += [f"process of {USER_A}: pid {p['pid']} ({p['name']})" for p in alive]
    except Exception as error:
        lines.append(f"process check failed: {error}"[:200])
    return lines


# Tools ----------------------------------------------------------------------------------------
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


def _check_letter(options: dict[str, int] | None, question_id: str, answer: str) -> str:
    if options is not None and question_id in options:
        letters = [chr(65 + i) for i in range(options[question_id])]
        if answer.strip().upper() not in letters:
            raise ToolError(f"answer must be one letter of {', '.join(letters)}")
        return answer.strip().upper()
    return answer


def _recorded(ledger: AnswerLedger, role: str, derivation_id: str, question_id: str) -> str:
    missing = ledger.unanswered(role)
    return f"Recorded {derivation_id} for {question_id}. " + (
        f"Not yet answered: {', '.join(missing)}." if missing else "Every question has an answer."
    )


FORCED_ROUTE = "FORCED final answer at the budget limit (best estimate from the work so far)."


@tool
def submit_answer(
    ledger: AnswerLedger, role: str, options: dict[str, int] | None = None, forced: bool = False
) -> Tool:
    """The single agent's tool. `forced=True` is the one used in its forced final turn."""

    async def execute(
        question_id: str,
        answer: str,
        route: str,
        evidence: str = "",
        alternatives: list[str] | None = None,
    ) -> str:
        """Record your answer to one question. Call it again for the same question to replace it.

        Args:
            question_id: The question's id, as given in the task (e.g. "bix-1-q2").
            answer: The answer, exactly as it should be reported, and nothing else.
            route: How you derived it, in one or two lines (inputs, tool, parameters), without
                the resulting value.
            evidence: The script path and the output line that shows the value.
            alternatives: Optional. Results you computed under other defensible readings of
                the question, each as "value | what was different".
        """
        answer = _check_letter(options, question_id, answer)
        if forced:
            route = f"{FORCED_ROUTE} {route}"
        try:
            derivation = ledger.submit(
                question_id, answer, route, evidence, role, alternatives, forced=forced
            )
        except ValueError as error:
            raise ToolError(str(error)) from error
        if forced:
            ledger.log("answer.forced", question=question_id, by=role, derivation=derivation.id)
        return _recorded(ledger, role, derivation.id, question_id)

    return execute


@tool(name="submit_answer")
def submit_answer_with_method(
    ledger: AnswerLedger,
    cross: CrossCheck,
    role: str,
    options: dict[str, int] | None = None,
    forced: bool = False,
) -> Tool:
    """The swarm derivations' tool: the same record plus a one-line method statement."""

    async def execute(
        question_id: str,
        answer: str,
        method: str,
        route: str = "",
        evidence: str = "",
        alternatives: list[str] | None = None,
    ) -> str:
        """Record your answer to one question. Call it again for the same question to replace it.

        Args:
            question_id: The question's id, as given in the task (e.g. "bix-1-q2").
            answer: The answer, exactly as it should be reported, and nothing else.
            method: ONE line that stands on its own (never "same as above"), in this form:
                data=<files and columns used>; subset=<rows or samples included>;
                procedure=<test, model or formula, with its settings>; tool=<package.function>.
                Do not put the resulting value in it.
            route: Anything else about how you derived it, in one or two lines.
            evidence: The script path and the output line that shows the value.
            alternatives: Optional. Results you computed under other defensible readings of
                the question, each as "value | what was different".
        """
        answer = _check_letter(options, question_id, answer)
        method = " ".join(method.split())
        if len(method_tokens(method)) < 3:
            raise ToolError(
                "method is required: one self-contained line, data=...; subset=...; "
                "procedure=...; tool=..."
            )
        if forced:
            route = f"{FORCED_ROUTE} {route}"
        try:
            derivation = ledger.submit(
                question_id, answer, route or method, evidence, role, alternatives, forced=forced
            )
        except ValueError as error:
            raise ToolError(str(error)) from error
        cross.methods[(role, question_id)] = method
        if forced:
            cross.forced.add((role, question_id))
            ledger.log("answer.forced", question=question_id, by=role, derivation=derivation.id)
        else:
            cross.forced.discard((role, question_id))
        # No derivation id here: its number would tell the critic how many answers exist.
        return _recorded(ledger, role, "your answer", question_id)

    return execute


def _last_line(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[-1] if lines else ""


def printed_matches(answer: str, printed: str) -> bool:
    """Is `answer` the value the reconciler's script printed (allowing the question's rounding)?"""
    if not answer.strip() or not printed.strip():
        return False
    if compare(answer, printed) == "agree":
        return True
    if parse_number(answer) is not None:
        return False
    return normalise(answer) in normalise(printed)


def _supports(answer: str, other: str, said: bool) -> bool:
    """Does the re-derived answer support a side's answer? Code decides when it can; for text it
    cannot compare, the reconciler's reading (`said`) is used."""
    comparison = compare(answer, other)
    return comparison == "agree" or (comparison == "unclear" and said)


_INTERPRETERS = {".py": "python3", ".r": "Rscript", ".sh": "bash"}


@tool
def rederive(
    ledger: AnswerLedger, cross: CrossCheck, clock: Clock, role: str = "reconciler"
) -> Tool:
    async def execute(
        question_id: str,
        script: str,
        answer: str,
        cause: str,
        same_method: bool,
        text_matches: Literal["A", "B", "both", "neither"] = "neither",
        overturn: bool = False,
    ) -> str:
        """Record YOUR OWN derivation of one answer. The harness runs your script itself and
        takes the value from its output, so nothing is recorded on your say-so.

        Args:
            question_id: The question's id.
            script: Path of a script you wrote under /root/reconcile (.py, .R or .sh) that
                computes the answer from the files in /data and prints the value as the LAST
                line of its output. It must not read the two analysts' directories.
            answer: The answer to report, in the format the question asks for. It must be the
                value your script prints (rounded as the question asks).
            cause: For a disagreement: the specific difference between A's and B's commands
                that explains it. For an agreement your value differs from: where their method
                departs from the question's wording.
            same_method: Whether A and B used the same method (same data, subset, procedure),
                judged from the commands they ran.
            text_matches: Only for answers that are text: which side's answer means the same
                as yours ("A", "B", "both", "neither"). Ignored for numbers; code compares those.
            overturn: Only for a question where A and B agree and your value differs: true if
                their shared method does not follow the question and yours does.
        """
        first, second = ledger.pair(question_id)
        if question_id not in ledger.questions or first is None or second is None:
            raise ToolError(f"{question_id} is not a question with two answers to review")
        if not cause.strip():
            raise ToolError("cause is required")
        path = script.strip()
        suffix = os.path.splitext(path)[1].lower()
        if not path.startswith(roles.RECONCILE_DIR + "/") or ".." in path:
            raise ToolError(f"script must be a file under {roles.RECONCILE_DIR}")
        if suffix not in _INTERPRETERS:
            raise ToolError("script must end in .py, .R or .sh")
        try:
            source = await sandbox().read_file(path)
        except Exception as error:
            raise ToolError(f"cannot read {path}: write the script first") from error
        if "/data" not in source:
            raise ToolError("the script must compute the value from the files in /data")
        if "/home/deriv_" in source or QUARANTINE in source:
            raise ToolError(
                "the script must not read the analysts' directories: derive the value yourself"
            )
        seconds = int(max(30.0, min(float(REDERIVE_TIMEOUT_SECONDS), clock.left() - 20.0)))
        command = (
            f". /etc/profile.d/glhf-image-path.sh 2>/dev/null; cd {roles.RECONCILE_DIR} && "
            f"{_INTERPRETERS[suffix]} {shlex.quote(path)}"
        )
        try:
            result = await sandbox().exec(["bash", "-c", command], user="root", timeout=seconds)
        except TimeoutError as error:
            raise ToolError(f"the script did not finish in {seconds} s") from error
        if not result.success:
            raise ToolError(f"the script failed: {(result.stderr or result.stdout)[-800:]}")
        printed = _last_line(result.stdout)
        if not printed_matches(answer, printed):
            raise ToolError(
                f"the last line your script printed is {printed[:200]!r}; the answer {answer!r} "
                "is not that value. Print the value as the last line, or correct the answer."
            )
        answer = answer.strip()
        with_a = _supports(answer, first.answer, text_matches in ("A", "both"))
        with_b = _supports(answer, second.answer, text_matches in ("B", "both"))
        evidence = f"{path} printed {printed[:200]!r} when run by the harness"
        if ledger.comparison(question_id) != "agree":
            # Which side the re-derived value supports is decided here, not by the reconciler.
            keep: Keep = (
                "both" if with_a and with_b else "A" if with_a else "B" if with_b else "neither"
            )
            try:
                ledger.resolve(question_id, keep, answer, cause, evidence, role)
            except ValueError as error:
                raise ToolError(str(error)) from error
            action: Literal["rederived", "confirmed", "overturned", "differs_kept"] = "rederived"
            outcome = f"re-derived {answer!r}; this supports {keep}"
        elif with_a or with_b:
            action, outcome = "confirmed", f"your derivation confirms the agreed {first.answer!r}"
        elif overturn and cross.weak_agreement(ledger, question_id):
            action = "overturned"
            outcome = f"your {answer!r} replaces the agreed {first.answer!r} (not independent)"
        else:
            action = "differs_kept"
            outcome = (
                f"your {answer!r} differs from the agreed {first.answer!r}; the agreed answer is "
                "kept and flagged"
                + (
                    " (two derivations by different methods outweigh one)"
                    if not cross.weak_agreement(ledger, question_id)
                    else " (set overturn=true if their shared method does not follow the question)"
                )
            )
        cross.checks[question_id] = Check(
            question_id, path, printed[:300], answer, action, cause.strip(), bool(same_method)
        )
        ledger.log(
            "reconciler.rederived",
            question=question_id,
            action=action,
            script=path,
            printed=printed[:300],
            same_method_by_reconciler=bool(same_method),
        )
        open_disputes, weak, other = review_lists(ledger, cross)
        todo = [
            f"still to re-derive: {', '.join(open_disputes)}" if open_disputes else "",
            f"non-independent agreements not yet checked: {', '.join(weak)}" if weak else "",
            f"optional: {', '.join(other)}" if other and not (open_disputes or weak) else "",
        ]
        return f"{question_id}: {outcome}. " + ("; ".join(t for t in todo if t) or "Nothing left.")

    return execute


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


# The forced final turn --------------------------------------------------------------------------
def work_log(messages: list[ChatMessage], limit: int = 24_000) -> str:
    """The tail of a role's own transcript, clipped: what it ran last and what came back."""
    parts: list[str] = []
    size = 0
    for message in reversed(messages):
        if isinstance(message, ChatMessageSystem):
            continue
        if isinstance(message, ChatMessageAssistant):
            calls = [
                f"[ran {c.function}] "
                + _clip(
                    str(c.arguments.get("code") or c.arguments.get("input") or c.arguments), 1500
                )
                for c in message.tool_calls or []
            ]
            text = "\n".join([_clip(message.text, 1500), *calls]).strip()
        elif isinstance(message, ChatMessageTool):
            text = "[output] " + _clip(message.text, 2500)
        else:
            continue  # the task itself is repeated in the forced prompt
        if not text:
            continue
        parts.append(text)
        size += len(text)
        if size >= limit:
            break
    return "\n\n".join(reversed(parts))


async def pending_submits(
    role: str,
    ledger: AnswerLedger,
    messages: list[ChatMessage],
    submit: Tool,
    events_before: int,
) -> list[ChatMessage]:
    """Execute submit_answer calls the model issued in the call that crossed a limit.

    Inspect checks the token limit when a model call returns, before the agent loop runs the
    tool calls in that reply; the reply is then in the transcript but not in the agent's
    messages, and an answer submitted in it would be lost. The limit is the role's; the answer
    was produced inside it. Only submit_answer is executed: nothing else may run past a limit.
    Returns the messages to append (the reply, cut down to those calls, and the tool results)."""
    events = transcript().events[events_before:]
    last = next((e for e in reversed(events) if isinstance(e, ModelEvent)), None)
    if last is None or last.pending or not last.output.choices:
        return []
    reply = last.output.message
    if reply.id is not None and any(m.id == reply.id for m in messages):
        return []  # the agent loop already handled this reply
    calls = [c for c in reply.tool_calls or [] if c.function == "submit_answer"]
    if not calls:
        return []
    pending = reply.model_copy(update={"tool_calls": calls})
    try:
        ran = (await execute_tools([*messages, pending], [submit])).messages
    except Exception as error:  # never lose the phase over this
        ledger.log("pending_submits.failed", phase=role, error=f"{type(error).__name__}"[:100])
        return []
    ledger.log(
        "pending_submits.executed",
        phase=role,
        questions=[str(c.arguments.get("question_id", "")) for c in calls],
    )
    return [pending, *ran]


async def forced_final(
    role: str,
    model: str | None,
    questions: list[PublicQuestion],
    ledger: AnswerLedger,
    submit: Tool,
    instructions: str,
    messages: list[ChatMessage],
    reserve_tokens: int | None,
    sink: list[ChatMessage] | None = None,
) -> list[str]:
    """A solver stopped with questions unanswered: one last short exchange, charged to its
    reserve, in which it records its best answer for each from its own work log. The prompt is
    a few thousand tokens, not the role's whole context. `submit` is that solver's forced
    submit_answer tool and `instructions` its forced-turn text (`roles.forced_final`); the
    single agent and the swarm derivations differ in nothing else. Returns the questions
    answered."""
    todo = ledger.unanswered(role)
    if not todo:
        return []
    start = sample_limits().token.usage
    conversation: list[ChatMessage] = [
        ChatMessageSystem(content=instructions),
        ChatMessageUser(
            content=roles.brief([q for q in questions if q.question_id in todo])
            + "\n---\n\nYour work log so far (most recent last):\n\n"
            + (work_log(messages) or "(nothing was run)")
            + f"\n\n---\n\nRecord an answer for: {', '.join(todo)}."
        ),
    ]
    ledger.log("forced_final.started", phase=role, unanswered=todo, reserve=reserve_tokens)
    answered: list[str] = []
    try:
        with time_limit(FORCED_TURN_SECONDS):
            for _ in range(len(todo) + 1):
                output = await get_model(model).generate(
                    conversation, tools=[submit], tool_choice="any"
                )
                conversation.append(output.message)
                if not output.message.tool_calls:
                    break
                conversation.extend((await execute_tools(conversation, [submit])).messages)
                spent = sample_limits().token.usage - start
                if not ledger.unanswered(role) or (reserve_tokens and spent >= reserve_tokens):
                    break
    except Exception as error:  # a limit or a provider error must not lose the phase
        ledger.log(
            "forced_final.stopped", phase=role, error=f"{type(error).__name__}: {error}"[:200]
        )
    if sink is not None:  # into the transcript, so the log shows exactly what it was given
        sink.append(ChatMessageUser(content=f"=== GLHF forced final turn: {role} ==="))
        sink.extend(m for m in conversation if not isinstance(m, ChatMessageSystem))
    answered = [q for q in todo if q not in ledger.unanswered(role)]
    ledger.log(
        "forced_final.finished",
        phase=role,
        answered=answered,
        still_unanswered=ledger.unanswered(role),
        tokens=int(sample_limits().token.usage - start),
    )
    return answered


async def stop_processes(ledger: AnswerLedger, users: list[str]) -> None:
    """Kill everything the role users left running (by uid), then root's own stray jobs."""
    try:
        left = await user_processes(users, kill=True)
        if left:
            ledger.log("background.survived", processes=left[:20])
    except Exception as error:
        ledger.log("background.kill_failed", error=str(error)[:200])
    try:
        killed = await background_processes(kill=True)
        if killed:
            ledger.log("background.killed", processes=killed[:20])
    except Exception as error:  # never block what follows
        ledger.log("background.kill_failed", error=str(error)[:200])


async def _write_outputs(
    ledger: AnswerLedger, settings: dict[str, Any], cross: CrossCheck | None = None
) -> None:
    """Final writes, as root, after every agent has stopped. Overwrites anything an agent may
    have put at these paths."""
    await stop_processes(ledger, [USER_A, USER_B])
    await sandbox().exec(["bash", "-c", "mkdir -p /outputs/glhf"], user="root")
    findings = ledger.findings_markdown()
    if cross is not None:
        rows = question_records(ledger, cross)
        findings += "\n" + records_markdown(rows)
        await sandbox().write_file(
            "/outputs/glhf/questions.json",
            json.dumps({"questions": rows, "blind_check": cross.blind}, indent=2),
        )
        await sandbox().write_file(
            "/outputs/glhf/evidence.json",
            json.dumps(
                {
                    f"{role}:{q}": [asdict(e) for e in ran]
                    for (role, q), ran in cross.evidence.items()
                },
                indent=2,
            ),
        )
    await sandbox().write_file(
        "/outputs/answers.json", json.dumps(final_answers(ledger, cross), indent=2)
    )
    await sandbox().write_file("/outputs/METHODS.md", ledger.methods_markdown(settings))
    await sandbox().write_file("/outputs/glhf/FINDINGS.md", findings)
    await sandbox().write_file("/outputs/glhf/ledger.json", ledger.to_json())
    await sandbox().exec(["bash", "-c", _COLLECT], user="root", timeout=120)


@solver
def single_agent(
    budget_seconds: int,
    max_tokens: int | None = None,
    max_messages: int | None = None,
    budget_policy: dict[str, Any] | None = None,
) -> Solver:
    """The baseline: one agent, one context, the whole budget. Like a swarm derivation it
    works up to its budget minus the final-turn reserve and, if it stops with questions
    unanswered, gets the same forced final turn from that reserve."""
    policy = BudgetPolicy(**(budget_policy or {}))

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        del generate
        questions = _questions(state)
        options = _option_counts(questions)
        ledger = AnswerLedger(
            {q.question_id: q.question for q in questions}, "single", primary="single", checker=None
        )
        reserve = single_reserve(max_tokens, policy) if max_tokens else None
        working = max_tokens - (reserve or 0) if max_tokens else None
        settings = {
            "budget_seconds": int(budget_seconds * CLOCK_MARGIN),
            "max_tokens": max_tokens,
            "tokens_working": working,
            "final_reserve": reserve,
            "max_messages": max_messages,
            "token_semantics": TOKEN_SEMANTICS["single"] if max_tokens else None,
            "compaction_threshold_tokens": COMPACTION_THRESHOLD_TOKENS,
        }
        ledger.log("settings", **settings)
        await _setup()
        start_tokens = sample_limits().token.usage
        seconds = int(budget_seconds * CLOCK_MARGIN)
        submit = submit_answer(ledger, "single", options)
        agent = _agent(
            "single",
            roles.rules(f"/home/{USER_A}/work", options is not None) + "\n\n" + roles.SINGLE,
            USER_A,
            None,
            [submit],
        )
        limits: list[Limit] = [time_limit(seconds)]
        if working:
            limits.append(token_limit(working))
        if max_messages:
            limits.append(message_limit(max_messages))
        prompt = state.input_text + _budget_note(seconds, working, max_messages)
        try:
            ledger.log(
                "phase.started",
                phase="single",
                seconds=seconds,
                tokens_allowed=max_tokens,
                tokens_working=working,
            )
            events_before = len(transcript().events)
            result = await run(agent, prompt, limits=limits)
            agent_state, limit_error = result if isinstance(result, tuple) else (result, None)
            assert isinstance(agent_state, AgentState)
            state.messages = agent_state.messages
            if limit_error is not None:
                state.messages.extend(
                    await pending_submits("single", ledger, state.messages, submit, events_before)
                )
            forced = await forced_final(
                "single",
                None,
                questions,
                ledger,
                submit_answer(ledger, "single", options, forced=True),
                roles.FORCED_FINAL_SINGLE,
                list(state.messages),
                reserve,
                state.messages,
            )
            ledger.log(
                "phase.finished",
                phase="single",
                limit=str(getattr(limit_error, "type", "limit")) if limit_error else None,
                tokens=int(sample_limits().token.usage - start_tokens),
                forced_answers=forced,
                unanswered=ledger.unanswered("single"),
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
    critic_hints: str = "none",
    swarm_budget: str = "equal",
    budget_policy: dict[str, Any] | None = None,
) -> Solver:
    """analyst -> critic (blind) -> reconciler (re-derives). See the module doc.

    `max_tokens` is the single agent's budget for the same run; `swarm_budget` says whether the
    swarm's total equals it or extends it. `critic_hints` is accepted for the command line and
    ignored: the critic never sees anything of the analyst's."""
    if critic_hints not in CRITIC_HINTS:
        raise ValueError(f"critic_hints must be one of {CRITIC_HINTS}")
    mode = swarm_budget_mode(swarm_budget)
    policy = BudgetPolicy(**(budget_policy or {}))

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        del generate
        questions = _questions(state)
        options = _option_counts(questions)
        ledger = AnswerLedger({q.question_id: q.question for q in questions}, "glhf")
        cross = CrossCheck()
        # Up front: a total that cannot hold the floors stops here, before any role or model call.
        plan = plan_budget(max_tokens, len(questions), mode, policy) if max_tokens else None
        clock = Clock(float(budget_seconds) * CLOCK_MARGIN, time.monotonic())
        settings = {
            "budget_seconds": int(clock.budget),
            "max_tokens": max_tokens,
            "max_messages_per_role": max_messages_per_role,
            "token_semantics": TOKEN_SEMANTICS["glhf"] if max_tokens else None,
            "compaction_threshold_tokens": COMPACTION_THRESHOLD_TOKENS,
            "swarm_budget": plan.describe() if plan else {"mode": mode},
            "critic_hints": "none",
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
        multiple_choice = options is not None

        def tokens_used() -> int:
            return int(sample_limits().token.usage - start_tokens)

        async def phase(title: Phase, who: Agent, model: str | None, prompt: str) -> PhaseResult:
            derivation = title != "reconciler"
            seconds = int(allowance(title, clock.budget, clock.budget - clock.left()))
            if seconds < MIN_PHASE_SECONDS:
                ledger.log("phase.skipped", phase=title, reason="time", seconds=seconds)
                return PhaseResult(ran=False)
            limits: list[Limit] = [time_limit(seconds)]
            allowed: int | None = None
            working: int | None = None
            before = tokens_used()
            if plan is not None:
                allowed = plan.allowance(title, before)
                # A derivation works up to its allowance minus the reserve for its final turn.
                working = allowed - (plan.final_reserve if derivation else 0)
                limits.append(token_limit(working))
            if max_messages_per_role:
                limits.append(message_limit(max_messages_per_role))
            ledger.log(
                "phase.started",
                phase=title,
                seconds=seconds,
                tokens_allowed=allowed,
                tokens_working=working,
                tokens_used_before=before,
            )
            state.messages.append(
                ChatMessageUser(content=f"=== GLHF phase: {title} (budget {seconds}s) ===")
            )
            prompt += _budget_note(seconds, working, max_messages_per_role)
            if title == "critic":
                assert_blind_prompt(prompt, ledger, cross, state.input_text)
            events_before = len(transcript().events)
            result = await run(who, prompt, limits=limits)
            agent_state, limit_error = result if isinstance(result, tuple) else (result, None)
            assert isinstance(agent_state, AgentState)
            if limit_error is not None and derivation:
                agent_state.messages.extend(
                    await pending_submits(
                        title,
                        ledger,
                        agent_state.messages,
                        submit_answer_with_method(ledger, cross, title, options),
                        events_before,
                    )
                )
            state.messages.extend(m for m in agent_state.messages if m.role != "system")
            limit = str(getattr(limit_error, "type", "limit")) if limit_error is not None else None
            forced: list[str] = []
            if derivation:
                forced = await forced_final(
                    title,
                    model,
                    questions,
                    ledger,
                    submit_answer_with_method(ledger, cross, title, options, forced=True),
                    roles.FORCED_FINAL,
                    agent_state.messages,
                    plan.final_reserve if plan else None,
                    state.messages,
                )
                ran, submitted = executions(
                    agent_state.messages, "A" if title == "analyst" else "B"
                )
                for question_id, count in submitted.items():
                    current = ledger.current(question_id, title)
                    if current is not None and (title, question_id) not in cross.forced:
                        cross.evidence[(title, question_id)] = evidence_for(
                            ran[:count], current.answer
                        )
                for question_id in forced:  # a forced answer: the last things it ran
                    cross.evidence[(title, question_id)] = ran[-2:]
            ledger.log(
                "phase.finished",
                phase=title,
                limit=limit,
                left=int(clock.left()),
                tokens=tokens_used(),
                phase_tokens=tokens_used() - before,
                forced_answers=forced,
                unanswered=ledger.unanswered(title) if derivation else [],
            )
            # A role that was cut off may have left jobs running; its user's processes all go.
            await stop_processes(ledger, [USER_B] if title == "critic" else [USER_A])
            await sandbox().exec(
                ["bash", "-c", _SEAL.format(users=f"{USER_A} {USER_B}")], user="root", timeout=120
            )
            return PhaseResult(ran=True, limit=limit)

        derivation_rules = "\n\n" + roles.METHOD_LINE
        analyst = _agent(
            "analyst",
            roles.rules(f"/home/{USER_A}/work", multiple_choice)
            + derivation_rules
            + "\n\n"
            + roles.ANALYST,
            USER_A,
            analyst_model,
            [submit_answer_with_method(ledger, cross, "analyst", options)],
        )
        critic = _agent(
            "critic",
            roles.rules(f"/home/{USER_B}/work", multiple_choice)
            + derivation_rules
            + "\n\n"
            + roles.CRITIC,
            USER_B,
            critic_model,
            [submit_answer_with_method(ledger, cross, "critic", options)],
        )
        reconciler = _agent(
            "reconciler",
            roles.rules(roles.RECONCILE_DIR, multiple_choice, answering=False)
            + "\n\n"
            + roles.RECONCILER,
            "root",
            reconciler_model,
            [rederive(ledger, cross, clock)],
        )
        try:
            await phase(
                "analyst",
                analyst,
                analyst_model,
                f"{state.input_text}\n---\n\nAnswer every question.",
            )
            # The critic's prompt is built from the questions alone; the sandbox is sealed and
            # then checked as the critic's own user. If anything of the analyst's is visible,
            # the critic does not run: a second derivation that is not blind is worth nothing.
            visible = await blind_check()
            cross.blind = {"checked": True, "visible_to_critic": visible[:20]}
            ledger.log("critic.blind_check", visible=visible[:20])
            if visible:
                ledger.log(
                    "phase.skipped", phase="critic", reason="not blind", visible=visible[:20]
                )
            else:
                await phase("critic", critic, critic_model, critic_prompt(state.input_text, ""))
            for question_id in ledger.questions:
                ledger.log(
                    "answers.compared",
                    question=question_id,
                    result=ledger.comparison(question_id),
                    method_similarity=cross.similarity(ledger, question_id),
                    same_method=cross.same_method_by_code(ledger, question_id),
                )
            if any(ledger.comparison(q) is not None for q in ledger.questions):
                await phase(
                    "reconciler",
                    reconciler,
                    reconciler_model,
                    f"{state.input_text}\n---\n\n{review_text(ledger, cross)}",
                )
                if ledger.disputes():
                    ledger.log("disputes.unresolved", questions=ledger.disputes())
            else:
                ledger.log("reconcile.not_needed", reason="no question has two answers")
        finally:
            ledger.log("finished", tokens=tokens_used())
            await _write_outputs(ledger, settings, cross)
            state.output.completion = ledger.findings_markdown()
        return state

    return solve
