# Specialist profiles and method skills

Nine profiles for the full workflow, each taken from one portfolio of the drug-candidate board
(`board/agents/`), and under `skills/` the method library: 100 method skills grouped into 19 method agents.
They keep the board's two habits: members talk to each other, and nothing counts until it is a checked proof point.

**Status.** The drug board can use them, as text. A plan drafted in the Home chat adds a specialist to one board
review when the question shares words with its trigger or with the notes of one of its methods
(`engine/src/specialists.ts`, `engine/src/chat/plan.ts`). The specialist is then a board member for that run, with
**no tools**: it cannot run code. Only practice (scripted) runs have used this; no real model has. **The swarm in
`glhf/bixbench` does not use these files.** The rules below under "When a specialist is called", "Conversation" and
"Proof points" describe the full workflow the profiles were written for; on the board the member protocol of
`board/` applies instead (see "On the drug board").

The board portfolios named in `based_on` were replaced by the swarm roles on 2026-11-14. The old
files are in git history (for example `git show d8f249d:board/agents/skeptic.md`).

| Profile | From board portfolio | Place in the workflow | Called when |
|---|---|---|---|
| `chief` | Lead Scientist | Triage, discharge summary | always |
| `contrarian` | Moonshot | Triage: the alternative hypothesis | once per question; again on same-method agreement |
| `attending-skeptic` | Skeptic | Attending (critic), other vendor | every hypothesis in workup |
| `methods-librarian` | Literature Scout | Specialist | a tool or method question |
| `target-biologist` | Target Biologist | Specialist | expression, single-cell, genetics, pathways |
| `medicinal-chemist` | Medicinal Chemist | Specialist | compounds, dose-response |
| `admet` | ADMET / DMPK Scientist | Specialist | pharmacokinetics, assays |
| `toxicologist` | Toxicologist | Specialist | safety, survival, clinical outcomes, unstable results |
| `literature-evidence-synthesist` | Competitive and IP Analyst | Specialist | competing-programme landscape on drug briefs only, never benchmark tasks; trial landscapes, meta-analysis, method comparison (carries 5 skills) |

Residents (experimenters) and nurses (plain-code data checks) are the existing swarm roles and are not
repeated here.

## On the drug board

| Profile | Can a plan add it? | Why not |
|---|---|---|
| `admet`, `medicinal-chemist`, `target-biologist`, `toxicologist` | yes, with no method notes | |
| `literature-evidence-synthesist` | yes, with the notes of its 3 methods that have text | |
| `chief` | no | the board's lead does this job |
| `attending-skeptic` | no | the board's Critic does this job, on the other vendor's model |
| `contrarian` | no | it is called once per question by rule, not by what the question is about |
| `methods-librarian` | no | it needs a documentation search tool, and specialists on the board have no tools |

What a chosen specialist gets, in this order: a fixed frame (it cannot run code or install anything; it says which
analysis would settle the question, the pitfalls, and what the brief's data can and cannot support; it challenges other
members by name; it reports no result that is not in the brief or in the sources the board found); its Purpose and
Instructions from its file; the notes of the methods that matched the question; then what every board member gets (its
deliverable, the CLAIMS format, the shared context with the writing style, the brief). The "Conversation" and "Proof
points" sections of a profile are not sent: the board's own protocol replaces them. The `tools` and `model` lines of a
profile are not used: on the board a specialist has no tools and runs on the `strong` tier.

A specialist takes a place inside the plan's member limit; it never adds one, and no spend cap is raised.

## Method agents (`skills/`)

`skills/` groups the 100 method skills of the method library into 19 method agents (`skills/README.md`,
`skills/skills-map.json`): 18 files in `skills/` and `literature-evidence-synthesist` above, which absorbed the method
agent with the same job. `python3 glhf/specialists/verify_skills.py` checks that every skill has exactly one owner.
**Status: the skill packages (scripts, references, assets) are not installed, and 38 of the 100 skills have no text at
all. The board reads the notes of 58 skills as text; nothing is executed. The swarm does not use them.** The other eight
profiles carry no skills. Reviewer profiles and executor method agents in the same domain were kept apart on purpose
(`skills/README.md`, "Reviewer and executor pairs").

## When a specialist is called

By rule, in code, never because an agent says it is stuck (in the pilot every agent was confident and
wrong):

1. Triage tags the hypothesis with a domain that a profile lists under `trigger`.
2. An attending rejects a hypothesis or sends it back: the matching specialist reviews before the retry.
3. A resident's own alternative results differ by more than the grader's tolerance.
4. Two derivations agree and the method lines match (the existing same-method flag).

Limits: one consult per hypothesis; a consult spends from the run's single total budget; a specialist sees
the question, the data report and the proposed method, not the resident's reasoning.

## Conversation

- Round one is blind: each member writes before seeing any other reply.
- From round two a member sees the others' proof points and their verdicts, never a vote count.
- A reply names the member and the claim it answers, and ends with a request to a named member or "none".
- The chief may address anyone; a specialist replies to whoever called it and to the chief.
- Every message is appended to the run's event log, so the whole conversation can be replayed.

## Proof points

A proof point is one ledger claim:

- the statement, in one sentence;
- what would show it false, registered before any test is run;
- the script and output, or the documentation URL, that a checker can open;
- the verdict, set by code: `supported`, `refuted` or `insufficient`.

The discharge summary lists supported proof points as the answer and every refuted or insufficient one in
the rejection log, with the member who raised it.

## Not decided

- Whether the swarm should use the specialists. Today only the board does, and only as text.
- The trigger rules above ("When a specialist is called") are not code. The board chooses a specialist by word match
  when a plan is drafted, once per run.
- The effect of any of this on a review or on accuracy: untested, and it needs real-model runs to test.
