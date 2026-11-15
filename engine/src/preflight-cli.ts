// npm run preflight (see preflight.ts). Reads the keys the engine reads (.env and the environment); prints no key.
import "./env.ts"
import { loadConfig } from "./config.ts"
import { runPreflight } from "./paid/preflight.ts"

const result = await runPreflight({ env: process.env, fetch, config: loadConfig(), log: (line) => console.log(line) })
process.exit(result.ok ? 0 : 1)
