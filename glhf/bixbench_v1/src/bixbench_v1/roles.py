"""Instructions for the solvers. The single agent and the swarm's analyst get the same working
rules (`RULES`), so a difference in score comes from the swarm's structure, not from a better
brief. Three swarm roles, each a separate agent with a fresh context:

  analyst      derives every answer (the single agent's job)
  critic       derives every answer again, blind: its prompt holds the questions and nothing of
               the analyst's, and its Unix user can find no file the analyst wrote
  reconciler   sees both answers with the commands behind them and re-derives by its own
               script: every disagreement, and every agreement reached by the same method

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
- The python tool starts a NEW interpreter on every call: no variable, import or loaded table
  survives from one call to the next, so a later call that uses a name from an earlier one
  fails with NameError. Put everything a step needs in the one call, or write scripts and save
  intermediate results as files in {work} and load them again. bash_session, by contrast, is
  one shell that keeps its working directory and environment between calls.
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
    shortest phrase that answers the question.
    {conclusion_rule}{letter_rule}
  - route: one or two lines on how you derived it (inputs, tool, parameters). Do not put the
    resulting value in the route.
  - evidence: the script path and the output line that shows the value.
  - alternatives (optional): if the question leaves a choice open (which samples, which test,
    which direction, which filter) and you computed the result under more than one defensible
    reading, give your answer for the reading the wording supports best and list the other
    results here, each as "value | what was different". Record them even when they are
    inconvenient; code flags an answer whose alternatives differ, it does not replace it.
- Before finishing, re-read each question and check that your answer follows its stated method,
  rounding and format. Then call submit with a one-line summary.
""".strip()

# The same sentence for the single agent, both swarm derivations and every forced final turn.
CONCLUSION_RULE = (
    "Exception: when the question asks what the effect, impact, relationship or significance "
    "of something is (not for a value alone), a bare number does not answer it: give the "
    "conclusion in a few words followed by the value that supports it, for example "
    '"no significant effect (p = 0.41)" or "increases severity (OR 1.52)".'
)

LETTER_RULE = "\n    These are multiple-choice questions: the answer is the letter of one option, nothing else."

SINGLE = "Your role: you are the only analyst. Answer every question."

ANALYST = (
    "Your role: ANALYST in a small team. Answer every question. After you finish, a second "
    "analyst derives the answers again without seeing anything of yours, and a third re-derives "
    "the ones that matter."
)

# For every solver: the single agent gets the same forced final turn as a swarm derivation.
FINAL_TURN = """
- If your budget ends before every question is answered you get one last turn, without tools,
  to record your best answer for the rest from the work you have done. So keep your outputs
  short and informative: print the candidate value for each question as soon as you have one.
""".strip()

# For the two swarm derivations only.
METHOD_LINE = """
- submit_answer also takes `method`: ONE line that stands on its own for that question (never
  "same as above"), in this form:
    data=<files and columns used>; subset=<rows or samples included>; procedure=<test, model or
    formula, with its settings>; tool=<package.function>
  State what you actually ran. Do not put the resulting value in it. Code compares your method
  line with the other analyst's: an agreement reached by the same method counts for less.
""".strip()

CRITIC = """
Your role: ANALYST in a small team. Answer every question from the data. You start from nothing
but the questions and the files in /data: nobody's notes, code or results are available to you,
and your working directory is empty. Another analyst answers the same questions separately, and
neither of you can see the other's work; code compares the answers afterwards. So:
- Do not guess what anyone else did and do not aim to match anything. Decide the outcome, the
  samples, the columns and the model from the question's wording and the data yourself. If the
  question is ambiguous, take the reading its wording supports best and say which in `method`.
- Be most careful where analyses usually go wrong: which samples and groups are included, the
  direction of a contrast, filters applied before or after a test, identifier mapping, which
  column a threshold applies to, and rounding.
""".strip()

_FORCED_FINAL = """
You were answering questions about a dataset by running code, and your budget has ended. You
cannot run anything more. Below are the questions you have not answered and the end of your own
work log. For EACH listed question call submit_answer once, now:
- answer: the value your log's outputs support best, in the format the question asks for
  (a number as digits only, rounded as the question asks).
  {conclusion_rule}
  If the log shows several candidate values, take the one whose computation follows the
  question's wording most closely. If the log holds no computed value for a question, give your
  best estimate from what the log shows of the data. Never leave a listed question without an
  answer.
{method_line}- evidence: the log line that shows the value.
""".strip()

_FORCED_METHOD = """- method: one line, data=...; subset=...; procedure=...; tool=..., describing the computation
  in the log that the value comes from, or "estimate: no finished computation" if there is none.
"""
_FORCED_ROUTE = """- route: one line on the computation in the log that the value comes from, or "estimate: no
  finished computation" if there is none.
"""


def forced_final(with_method: bool) -> str:
    """Instructions for the forced final turn: the swarm derivations' (with the method line
    their submit_answer requires) and the single agent's (with a route). Otherwise identical."""
    return _FORCED_FINAL.format(
        conclusion_rule=CONCLUSION_RULE,
        method_line=_FORCED_METHOD if with_method else _FORCED_ROUTE,
    )


FORCED_FINAL = forced_final(with_method=True)
FORCED_FINAL_SINGLE = forced_final(with_method=False)

RECONCILER = f"""
Your role: RECONCILER in a small team. Two analysts, A and B, answered the same questions
separately; neither saw the other's work. Your task lists, per question, both answers, each
side's one-line method, and the commands each side ran with their output. You have no stake in
either answer, and you settle nothing by opinion: for every question you handle you WRITE AND
RUN YOUR OWN SCRIPT in {RECONCILE_DIR} that computes the answer from /data, and the harness
re-runs that script and takes the value it prints. Never copy a value from A or B, never pick
the answer that two of three agree on, never choose by plausibility.
1. Disagreements, every one, the cheapest first. From the commands, find the specific cause (a
   different filter, sample set, contrast direction, column, test, coding of a variable,
   rounding, or reading of the question). Decide from the question's wording and the data what
   the computation should be, write it, run it, then call rederive. Code works out which side
   your value supports; if it supports neither, yours is reported.
2. Agreements that are not independent (same method on both sides, or one side's answer is a
   forced estimate), every one. Two analysts who made the same choice agree with each other
   whether or not the choice is right, so this agreement is weak evidence. Re-read the
   question: list the choices their shared method made that the question does not dictate or
   dictates differently (outcome column, which rows or samples, how a variable is coded, which
   terms are in a model, the direction, the rounding). Check those choices against the data
   and the question's exact words, then derive the answer your own way and call rederive. If
   your value differs, set overturn=true only if you can name where their method departs from
   the question; otherwise the agreed answer stays, flagged.
3. Agreements by different methods: spot-check them only if budget is left.
A script for rederive is a .py, .R or .sh file under {RECONCILE_DIR} that reads /data, does not
read {HOME_A} or {HOME_B}, and prints the value as the last line of its output. You may read
the analysts' files to understand what they did. Then call submit with a one-line summary.
""".strip()


def rules(work: str, multiple_choice: bool, answering: bool = True) -> str:
    """Working rules for a role. `answering=False` leaves out the submit_answer rules (the
    reconciler records resolutions, not answers)."""
    text = RULES.format(work=work)
    if answering:
        text += "\n" + ANSWERING.format(
            conclusion_rule="" if multiple_choice else CONCLUSION_RULE,
            letter_rule=LETTER_RULE if multiple_choice else "",
        )
        text += "\n" + FINAL_TURN
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
