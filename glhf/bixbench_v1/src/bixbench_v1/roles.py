"""Instructions for the solvers. The single agent and the swarm's analyst get the same working
rules (`RULES`), so a difference in score comes from the swarm's structure, not from a better
brief. Three swarm roles, each a separate agent with a fresh context:

  analyst      derives every answer (the single agent's job, on a share of the budget)
  critic       derives every answer again, blind: it is not shown the analyst's answers and its
               Unix user cannot read the analyst's files
  reconciler   only when code finds answers that do not agree: finds the cause, records which
               derivation to keep and why

The BixBench3 swarm has nine roles because a task there is hours of pipeline work on raw reads
with a strict output contract. A v1.5 capsule is a few small tables and a handful of questions
that take minutes each, so: scout, proposer, pilot and experimenter are one role (a separate
plan or subsample run would cost more tokens than the analysis); the methods auditor is the
critic's own reading of the question; the finisher is replaced by a code rule (a question the
analyst missed takes the critic's answer); and the reporter is code (`AnswerLedger`).
"""

from __future__ import annotations

from .dataset import PublicQuestion

HOME_A = "/home/deriv_a"
HOME_B = "/home/deriv_b"
RECONCILE_DIR = "/root/reconcile"

RULES = """
You answer questions about a bioinformatics dataset by analysing the data yourself.

Rules:
- The data is under /data (read-only). Work in {work} (scripts, intermediate files).
- There is no network. Nothing can be downloaded or installed; use what the image has (Python
  and R with bioinformatics packages, command-line tools). Check what is installed before you
  plan around a package. If a question needs a resource that is not in /data or the image, use
  the closest valid offline route and say so.
- Answer from the data only, by running code. Never answer from memory of a paper or from what
  seems plausible.
- Follow every method detail the question states (tool, test, thresholds, filters, the direction
  of a comparison, rounding). Read each file's structure before using it: column meanings,
  identifier types, sample groups, missing values.
""".strip()

ANSWERING = """
- Record each answer with submit_answer as soon as you have it; a later call for the same
  question replaces the earlier one. An answer you never submit does not exist.
  - answer: exactly what the question asks for and nothing else. A number is digits only, rounded
    as the question asks, with no units or words (a percent sign only if the question asks for a
    percentage); a gene, pathway or group by its name as written in the data; otherwise the
    shortest phrase that answers the question.{letter_rule}
  - route: one or two lines on how you derived it (inputs, tool, parameters). Do not put the
    resulting value in the route.
  - evidence: the script path and the output line that shows the value.
- Before finishing, re-read each question and check that your answer follows its stated method,
  rounding and format. Then call submit with a one-line summary.
""".strip()

LETTER_RULE = "\n    These are multiple-choice questions: the answer is the letter of one option, nothing else."

SINGLE = "Your role: you are the only analyst. Answer every question."

ANALYST = (
    "Your role: ANALYST in a small team. Answer every question. After you finish, a second "
    "analyst derives the answers again without seeing yours, and code compares the two."
)

CRITIC = """
Your role: INDEPENDENT CHECKER in a small team. Another analyst has already answered these
questions. You are not shown their answers, code or files, and you cannot read them: that is
deliberate. Derive every answer again from the data, so that code can compare the two
derivations afterwards. An answer you both reach is reported as replicated; where you differ, a
third reviewer examines both. So:
- Do not guess what the other analyst did, and do not aim to match anything. If the question is
  ambiguous, take the reading its wording supports best and state that reading in the route.
- If your task lists the route of the first derivation per question (a one-line description,
  never its result), then where another equally valid route exists (a different language or
  implementation, a direct computation instead of a library call, another way of reading the
  file), take it, so the two derivations are less likely to share a mistake. The listed route
  is not a specification: decide the outcome, the samples and the model from the question and
  the data yourself. Where the question prescribes a tool, use that tool: your independence is
  then your own reading of the data and your own code.
- Be most careful where analyses usually go wrong: which samples and groups are included, the
  direction of a contrast, filters applied before or after a test, identifier mapping, which
  column a threshold applies to, and rounding.
""".strip()

RECONCILER = f"""
Your role: RECONCILER in a small team. Two analysts, A and B, answered the same questions
independently. For the questions in your task their answers do not agree, or are worded
differently and could not be compared by code. You have no stake in either answer.
For each such question:
1. Read both scripts: A worked in {HOME_A}/work, B in {HOME_B}/work. Work in {RECONCILE_DIR}.
2. Find the specific cause of the difference (a different filter, sample set, contrast direction,
   column, test, rounding, or reading of the question) and confirm it by running code.
3. Decide which derivation follows the question's wording and the data. Do not average, do not
   choose by plausibility, and do not prefer A or B by default.
4. Call resolve_dispute: keep "A" or "B"; "both" if they are the same finding (same value within
   the rounding the question asks for, or the same thing in different words); "neither" if both
   are wrong and you derived the answer yourself. final_answer is the answer to report, in the
   format the question asks for. cause is the difference you found; evidence is the script path
   and output that shows it.
Resolve every listed question, the cheapest first, then call submit with a one-line summary.
""".strip()


def rules(work: str, multiple_choice: bool, answering: bool = True) -> str:
    """Working rules for a role. `answering=False` leaves out the submit_answer rules (the
    reconciler records resolutions, not answers)."""
    text = RULES.format(work=work)
    if answering:
        text += "\n" + ANSWERING.format(letter_rule=LETTER_RULE if multiple_choice else "")
    return text


def brief(questions: list[PublicQuestion]) -> str:
    """The task text every role sees. Built from `PublicQuestion` only."""
    lines = [f"Answer the following {len(questions)} question(s) about the dataset in /data.", ""]
    for q in questions:
        lines.append(f"## Question {q.question_id}")
        lines.append(q.question.strip())
        if q.options is not None:
            lines.append("")
            lines += [f"{chr(65 + i)}. {option}" for i, option in enumerate(q.options)]
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
