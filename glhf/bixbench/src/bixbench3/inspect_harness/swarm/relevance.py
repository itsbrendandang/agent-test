"""The relevance judge: is a registered falsification test about the claim it is registered for?

Popper (Huang et al., arXiv:2502.09858) needs its Assumption 1: if the hypothesis's null H0 is
true, the null h0 of each sub-test is true. A test whose null does not follow from the claim's
null can come out "significant" for reasons that have nothing to do with the claim, and that
significance would be counted as support. The paper enforces the assumption approximately with a
separate LLM "relevance checker" that scores each proposed test on a 0.1 to 1.0 rubric and
discards those under a threshold; removing it raised the Type-I error on its benchmarks (its
Table 3). The paper states no numeric threshold in its text; in its printed trajectories a
score of 0.6 is rejected and 0.8 passes. We use 0.8 (`ledger.RELEVANCE_THRESHOLD`).

What the judge is, here:
  - one model call per review round, with no tools and no sandbox. Its whole input is built by
    code in `request`: the claim, the claim's null, and for each registered test its name, its
    method, its own null and the script. It is never shown a result, a p-value, the ledger's
    events, the notebook or any other role's transcript;
  - it runs after registration (the script and its hash are already fixed) and before the
    harness runs the test (`Ledger.record_run` refuses a test that was not judged);
  - its answer is parsed by code (`parse`): one line per test. A test it does not score, or
    scores outside the rubric, has no usable judgement and cannot support (fail closed).
What it is not: a proof. It is a model reading a description and a script. The paper's own
checker agreed only moderately with human raters (Spearman 0.55) and scored more tests "strongly
relevant" than they did. A script can still compute something other than what its method says.
Text typed by the critic (method, comments in the script) reaches the judge, so a critic that
wanted to mislead it could try; the judge is told to rate the code, not the description.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from inspect_ai.model import (
    ChatMessageSystem,
    ChatMessageUser,
    GenerateConfig,
    Model,
)
from inspect_ai.util import LimitExceededError, apply_limits, time_limit

from .ledger import RELEVANCE_THRESHOLD, Ledger, Relevance

ROLE = "relevance"
SCRIPT_CHARS = 4000  # of each script shown to the judge
SCORES = (0.1, 0.2, 0.4, 0.6, 0.8, 1.0)  # the rubric's levels (the paper's listing 4)

# The rubric's levels and their names are the paper's (listing 4); the wording is ours, written
# for claims about an analysis and for the question Assumption 1 asks.
INSTRUCTIONS = f"""You are the RELEVANCE JUDGE of a team that reproduces a published analysis.

Another role proposed claims, each with a null hypothesis ("the claimed effect is absent"). A
critic then registered falsification tests for them. Each test is a script that will be run
later and will print one p-value. You are asked one question about each test, BEFORE it is run:

    If the claim's null hypothesis were true, would this test's own null hypothesis be true too?

Only then does a small p-value from the test count against the claim's null, and so for the
claim. A test can be well made and still be about something else: a positive control that comes
out significant whether or not the claim holds, a property of the data that the claim does not
predict, a different contrast, a different gene set, a file-format check.

You see the claim, its null, and each test's name, method, stated null and script. You do not
see any result, and you must not guess one. Rate what the SCRIPT computes; if the script does
not do what the method says, rate the script. If the script does not compute its p-value from
the data at all (it prints a fixed number), score 0.1.

Rubric:
1.0 Highly relevant: the test's null follows directly from the claim's null; the test is specific
    to the variables and the contrast of the claim.
0.8 Strongly relevant: the test addresses a major component of the claim; its null follows from
    the claim's null under ordinary, stated assumptions.
0.6 Moderately relevant: related evidence, but the test's null could hold or fail whether or not
    the claim's null holds (an association, a neighbouring quantity).
0.4 Slightly relevant: loosely associated variables; little would change for the claim.
0.2 Barely relevant: tangential; no clear link to the claim.
0.1 Irrelevant: the result would say nothing about the claim, or the script computes no test.

A test counts for its claim only from {RELEVANCE_THRESHOLD:g}. Do not be generous: a test that
does not count costs the team one test; a test that counts wrongly makes a false finding.

Answer with exactly one line per test, in the order given, and nothing else:
<test id> score=<one of 0.1 0.2 0.4 0.6 0.8 1.0> reason=<one sentence>
Example:
T1 score=0.8 reason=Permuting the condition labels tests the claimed difference directly.
"""

_LINE = re.compile(r"^\W*(T\d+)\W+score\s*[=:]\s*([0-9.]+)\W+reason\s*[=:]\s*(.*)$", re.IGNORECASE)


@dataclass(frozen=True)
class Item:
    """One registered test waiting for a judgement. `key` is its id in the request (T1, T2)."""

    key: str
    claim_id: str
    name: str


def waiting(ledger: Ledger) -> list[Item]:
    """Registered test scripts that have no relevance judgement yet, in ledger order."""
    found: list[Item] = []
    for claim in ledger.claims.values():
        for entry in claim.registered:
            if entry.script_sha256 and entry.relevance is None and entry.run is None:
                found.append(Item(f"T{len(found) + 1}", claim.id, entry.name))
    return found


def request(ledger: Ledger, items: list[Item], script_chars: int = SCRIPT_CHARS) -> str:
    """Everything the judge is shown. Built from the claim and the registration only: no test
    result, no p-value, no event, no issue and no transcript can be in it."""
    parts = []
    for item in items:
        claim = ledger.claims[item.claim_id]
        entry = claim.registration(item.name)
        assert entry is not None
        script = entry.script[:script_chars]
        cut = "" if len(entry.script) <= script_chars else "\n[script cut here]"
        parts.append(
            f"=== {item.key} ===\n"
            f"Claim: {claim.text}\n"
            f"Claim's null hypothesis: {claim.null_hypothesis}\n"
            f"Test name: {entry.name}\n"
            f"Test method (written by the critic): {entry.method}\n"
            f"Test's own null (written by the critic): {entry.test_null or '(not stated)'}\n"
            f"Script ({entry.script_path}):\n```\n{script}{cut}\n```"
        )
    return (
        f"{len(items)} registered test(s) to rate. None has been run.\n\n"
        + "\n\n".join(parts)
        + "\n\nOne line per test: <test id> score=<score> reason=<one sentence>"
    )


def parse(answer: str, items: list[Item]) -> dict[str, tuple[float | None, str]]:
    """key -> (score, reason) for every item. A test the answer does not rate with a rubric
    score gets (None, why): no usable judgement, which cannot support."""
    scored: dict[str, tuple[float | None, str]] = {}
    for line in answer.splitlines():
        found = _LINE.match(line.strip())
        if not found:
            continue
        key = found.group(1).upper()
        if key in scored:
            scored[key] = (None, "rated twice in one answer")
            continue
        try:
            score = float(found.group(2).rstrip("."))
        except ValueError:
            scored[key] = (None, f"score not a number: {found.group(2)[:20]!r}")
            continue
        if not any(abs(score - level) < 1e-9 for level in SCORES):
            scored[key] = (None, f"score {score:g} is not on the rubric")
            continue
        scored[key] = (score, found.group(3).strip()[:400])
    return {
        item.key: scored.get(item.key, (None, "the judge gave no line for this test"))
        for item in items
    }


def vendor(model: str) -> str:
    """The provider part of a model name: "anthropic/claude-..." -> "anthropic"."""
    return model.split("/", 1)[0].strip().lower() if "/" in model else model.strip().lower()


def judgement(score: float | None, reason: str, judge_model: str, proposer_model: str) -> Relevance:
    same = vendor(judge_model) == vendor(proposer_model) if judge_model and proposer_model else None
    return Relevance(
        score=score,
        relevant=score is not None and score >= RELEVANCE_THRESHOLD,
        reason=reason,
        threshold=RELEVANCE_THRESHOLD,
        judge=ROLE,
        judge_model=judge_model,
        proposer_model=proposer_model,
        same_vendor_as_proposer=same,
    )


async def ask(model: Model, text: str, max_tokens: int, seconds: int) -> tuple[str, str | None]:
    """One call to the judge: no tools, a bounded answer, a time limit. Returns its answer and
    why there is none ("time", "tool call", or the error), if so."""
    try:
        with apply_limits([time_limit(max(5, seconds))], catch_errors=True):
            output = await model.generate(
                [ChatMessageSystem(content=INSTRUCTIONS), ChatMessageUser(content=text)],
                tools=[],
                config=GenerateConfig(max_tokens=max(64, max_tokens)),
            )
            if output.message.tool_calls:
                return "", "tool call"  # it has no tools: an answer that asks for one is none
            return output.completion, None
    except LimitExceededError:
        raise  # a limit of the whole sample, not ours
    except Exception as error:  # a failed call leaves the tests unjudged, which cannot support
        return "", str(error)[:200]
    return "", "time"
