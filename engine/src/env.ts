// Loads the repo-root .env (keys) without a dependency. Real environment variables win.
// Imported first by config.ts, so everything that reads process.env at import time sees the keys.
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** KEY=value lines. Quotes are stripped; an unquoted value ends at " #". Blank values are skipped. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    const quoted = /^(["'])(.*)\1/.exec(value)
    if (quoted) value = quoted[2]
    else value = value.replace(/(^|\s)#.*$/, "").trim()
    if (value) out[m[1]] = value
  }
  return out
}

const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env")
if (existsSync(file)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (!process.env[key]) process.env[key] = value
  }
}
