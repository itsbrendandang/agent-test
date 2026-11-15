// Imported first by the tests that check spend totals: an empty GLHF_RUNS_DIR, so this machine's own glhf/runs (its
// Modal spend) never enters a total, however the test file is run. store.ts reads GLHF_RUNS_DIR when it loads.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

process.env.GLHF_RUNS_DIR = mkdtempSync(join(tmpdir(), "glhf-runs-"))
