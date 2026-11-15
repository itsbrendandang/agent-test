# Prompts of the research answer

These four files are the instructions the models get. They are plain text so they can be reviewed and edited without
reading code. `prompts.ts` loads them and fills the `{{...}}` places.

| File | Who reads it | Tier in `board/config.yaml` |
|---|---|---|
| `planner.md` | the query planner | `models.cheap` |
| `writer.md` | the writer, for the draft and again for the revision | `models.strong` |
| `reviser.md` | added under `writer.md` for the one revision | `models.strong` |
| `critic.md` | the critic, under the board's own critic instructions (`board/agents/critic.md`) | `models.rival` (must be another vendor than the writer) |

The screening of search results and the check of each cited sentence use the board's existing wording in
`engine/src/questions.ts`; it is not copied here.

No rule in these files is trusted to hold by itself. What code enforces is listed in `docs/research-answer.md`.
