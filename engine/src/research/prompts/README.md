# Prompts of the research answer

These ten files are the instructions the models get. They are plain text so they can be reviewed and edited without
reading code. `prompts.ts` loads them and fills the `{{...}}` places.

| File | Who reads it | Tier in `board/config.yaml` |
|---|---|---|
| `planner.md` | the query planner | `models.cheap` |
| `writer.md` | the writer, for the draft and again for the revision | `models.strong` |
| `reviser.md` | added under `writer.md` for the one revision | `models.strong` |
| `hypotheses.md` | the planner again, at the Standard level: the hypotheses to test, written before any search, each with its own searches | `models.cheap` |
| `writer-hypotheses.md` | added under `writer.md` when hypotheses are tested: one section per hypothesis, with For / Against / Not found lines | `models.strong` |
| `investigator.md` | one investigator per hypothesis (the writer's model): it drafts its own section from the sources found for its hypothesis | `models.strong` |
| `lead.md` | the writer, in a hypothesis answer: the first paragraph that compares the hypotheses | `models.strong` |
| `stance.md` | a model of another vendor than the writer: does each checked statement support or contradict its hypothesis | `checkers.first_pass.alt` |
| `critic-recheck.md` | the critic again, after the revision: does the revised text resolve each of its notes | `models.rival` |
| `critic.md` | the critic, under the board's own critic instructions (`board/agents/critic.md`) | `models.rival` (must be another vendor than the writer) |

The screening of search results and the check of each cited sentence use the board's existing wording in
`engine/src/questions.ts`; it is not copied here.

No rule in these files is trusted to hold by itself. What code enforces is listed in `docs/research-answer.md`.
