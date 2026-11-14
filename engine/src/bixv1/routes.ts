// /api/bixv1/*: read-only results of the BixBench v1 adapter (glhf/bixbench_v1) for the dashboard.
// Shapes are in types.ts. Nothing here starts a run, calls a model or writes a file.
//
//   GET /api/bixv1/runs               run folders, newest first (BixRun[])
//   GET /api/bixv1/runs/:id           one run with a row per question (BixRunDetail). 404 when there is none.
//   GET /api/bixv1/scoreboard         single agent against swarm, paired only when the settings match (BixScoreRow[])
//
// Query, on all three: ?profile=per-mode|official|paper picks the grading profile. Default: the one report.json
// was written with, else "per-mode". On a run that was not graded with it: 400 for /runs/:id; the run is left
// out of the scoreboard; in the list its counts are all "not graded".
// Runs are cached in memory while their files are unchanged (store.ts), so polling these routes is cheap.
//
// IDEAL ANSWERS: ONE RULE. No response carries the ground-truth answer of a question unless the request is
// GET /api/bixv1/runs/:id?ideal=1, it carries the engine's session token (x-glhf-token; 401 {error, field: "token",
// needsToken: true} without, also from the dashboard's Origin, which any local program can claim) and the run is neither "running" (a capsule run is still going) nor "empty" (it
// has no capsule run at all); both are refused with 409. A "stalled" run is allowed, see below. Why:
//   * The default responses are polled by the dashboard and readable by anything on this machine, including
//     coding agents that work on the solvers and their prompts. An answer that shows up there can end up in a
//     prompt, a lesson file or a screenshot, and then every later run on that question is worthless. Right or
//     wrong is all a results view needs.
//   * The adapter keeps the same line: run.json, grade.json and report.json hold verdicts, never ideals. The
//     only source is the dataset's question file, which this module opens for the ?ideal=1 request and for
//     nothing else.
//   * A run that is still going is refused (409) even with the flag: its solver is at work on these questions.
//     A "stalled" run is allowed although not every capsule run in it finished: it is not at work, its crashed
//     capsule runs have been silent past their time limit.
//   * The judge's raw reply and the grader's note can quote or describe the ideal, so they follow the same rule.
// The flag is for a person reviewing a finished or stalled run who needs to see why an answer was marked wrong. It is a
// deliberate act, not a default, and the response is marked `idealsRevealed: true` and `cache-control: no-store`.
// What the rule cannot hide: an answer graded correct by exact match is, by definition, the ideal answer.
import type { IncomingMessage, ServerResponse } from "node:http"
import { hasSessionToken, TOKEN_FILE } from "../glhf/routes.ts"
import { HttpError, tokenNeeded } from "../http.ts"
import { scoreboard } from "./scoreboard.ts"
import { listRuns, loadAll, loadRun, readIdeals, safeId } from "./store.ts"
import type { BixRunDetail } from "./types.ts"

const json = (res: ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(code, { "content-type": "application/json", ...headers })
  res.end(JSON.stringify(body))
}

const flag = (value: string | null) => value === "1" || value === "true"

/** Handles a request under /api/bixv1. `parts` is the path split on "/": api, bixv1, runs, :id. */
export async function handleBixV1(req: IncomingMessage, res: ServerResponse, parts: string[], options: { hasToken?: (req: IncomingMessage) => boolean } = {}): Promise<void> {
  try {
    if (req.method !== "GET") throw new HttpError(405, "the BixBench v1 results are read-only: GET only")
    const query = new URL(req.url ?? "/", "http://x").searchParams
    const asked = query.get("profile")
    if (asked !== null && !safeId(asked)) throw new HttpError(400, "invalid grading profile")
    const profile = asked ?? undefined
    if (flag(query.get("ideal")) && !(parts[2] === "runs" && parts[3] && !parts[4])) throw new HttpError(400, "ideal answers are returned only by GET /api/bixv1/runs/:id?ideal=1")

    if (parts[2] === "runs" && !parts[3]) return json(res, 200, listRuns({ profile }))
    if (parts[2] === "scoreboard" && !parts[3]) return json(res, 200, scoreboard(loadAll({ profile })))
    if (parts[2] === "runs" && parts[3] && !parts[4]) {
      let id: string
      try { id = decodeURIComponent(parts[3]) } catch { throw new HttpError(400, "invalid run id") }
      if (!safeId(id)) throw new HttpError(400, "invalid run id")
      const reveal = flag(query.get("ideal"))
      // Before the run is even looked up: without the token the flag gets nothing, not even whether the run exists.
      if (reveal && !(options.hasToken ?? hasSessionToken)(req)) return json(res, 401, tokenNeeded("showing ideal answers", TOKEN_FILE), { "cache-control": "no-store" })
      const loaded = loadRun(id, { profile, withJudgeText: reveal })
      if (!loaded) throw new HttpError(404, "no such run")
      if (profile && !loaded.run.gradingProfiles.includes(profile)) {
        throw new HttpError(400, `this run was not graded with profile ${profile}; it has: ${loaded.run.gradingProfiles.join(", ") || "none"}`)
      }
      const detail: BixRunDetail = { run: loaded.run, questions: loaded.questions, idealsRevealed: false }
      if (!reveal) return json(res, 200, detail)
      if (loaded.run.state === "running" || loaded.run.state === "empty") throw new HttpError(409, "ideal answers are shown only for a finished run; this one has capsule runs still going or none at all")
      const ideals = readIdeals()
      if (!ideals) detail.idealNote = "the dataset's question file is not on this machine (uv run bixbench-v1 download), so there are no ideal answers to show"
      else {
        // Copies: the loaded questions are shared with the store's cache and must never carry an ideal.
        detail.questions = detail.questions.map((q) => { const ideal = ideals.get(q.questionId); return ideal === undefined ? q : { ...q, ideal } })
        detail.idealsRevealed = true
        if (loaded.run.answerModes.some((m) => m !== "open")) detail.idealNote = "multiple-choice run: the answers are letters; the ideal shown is the text of the correct option, not its letter"
      }
      return json(res, 200, detail, { "cache-control": "no-store" })
    }
    json(res, 404, { error: "not found" })
  } catch (error) {
    json(res, error instanceof HttpError ? error.status : 500, { error: String(error instanceof Error ? error.message : error) })
  }
}
