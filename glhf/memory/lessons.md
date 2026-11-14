
## Task demo, 2026-11-14 20:00 UTC
Check line endings first (CRLF input is easy to miss); use the csv module with newline="" and strip fields.
Compare IDs in the data against the sample sheet early; extra samples can sit in the data but not in the sheet.
Have the pipeline script write a short METHODS.md itself, then let the reporter overwrite it with the fuller version.
Keep the notebook updated as steps run; it ended up nearly empty, which makes the reporting harder.
Write deviations.md even when empty ("none"), so the reporter does not have to infer it.
For tiny tasks, one numbered script plus a pilot flag (env var) is enough; don't over-engineer.
Run check_outputs before finishing.

