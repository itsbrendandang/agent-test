# Specialist profiles (draft, not wired into the solver)

Nine profiles for the full workflow, each taken from one portfolio of the drug-candidate board
(`board/agents/`). They keep the board's two habits: members talk to each other, and nothing counts until
it is a checked proof point. **Status: these files are instructions only. No code loads them yet, and no
run, scripted or real, has used them.**

The board portfolios named in `based_on` were replaced by the nine swarm roles on 2026-11-14. The old
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
| `prior-work-analyst` | Competitive and IP Analyst | Specialist | drug briefs only, never benchmark tasks |

Residents (experimenters) and nurses (plain-code data checks) are the existing swarm roles and are not
repeated here.

## Skill agents (draft, instructions only)

`skills/` groups the 100 Biomni Skill Hub skills into 19 role agents (`skills/README.md`, `skills/skills-map.json`). **Status: the skill
packages (scripts, references, assets) are not installed, 38 of the 100 skills have no Overview text at all, these agents are instructions
only and are not wired into any solver, and nothing routes work to them yet.** The nine profiles above are separate and unchanged.

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

- Whether `board/` is removed. Nothing here depends on it staying, but these files cite it as their source.
- Which two or three specialists to wire first. The solver is being changed by another piece of work.
- The effect of any of this on accuracy: untested, and it needs real-model runs to test.
