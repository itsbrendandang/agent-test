// Loads the repo-root .env (keys) without a dependency. Real environment variables win.
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ROOT } from "./config.ts"

const file = resolve(ROOT, ".env")
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}
