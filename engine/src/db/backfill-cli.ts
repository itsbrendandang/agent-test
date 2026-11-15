// npm run db:backfill (see backfill.ts). Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as the engine does (.env and
// the environment); prints no key. Uses the runs folder of board/config.yaml, or DRUG_BOARD_RUNS_DIR.
import "../env.ts"
import { loadConfig } from "../config.ts"
import { backfill } from "./backfill.ts"
import { restClient, supabaseSettings } from "./supabase.ts"

const settings = supabaseSettings()
if (!settings) {
  console.error("The database is off: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example), then run this again.")
  process.exit(1)
}
try {
  await backfill(loadConfig(), restClient({ ...settings, timeoutMs: Math.max(settings.timeoutMs, 30_000) }), (line) => console.log(line))
  console.log("Done.")
} catch (error) {
  console.error(`Backfill stopped: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
