// What produced a run: the code commit, the prompts, the config and the library versions. It is written into each
// board run.json and research record.json, and shown by GET /api/status, so a result can say exactly what ran and
// `npm start` can tell when the engine on the port is not this checkout's.
//
// Hashes are sha256 (first 16 hex characters) of file contents: the same text gives the same hash on any machine.
// Nothing here can spend or reach the network. No path, key or environment value is recorded.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { type BoardConfig, path, ROOT } from "./config.ts"

export interface Manifest {
  /** `git rev-parse HEAD` of the repo when the engine started; null without git (a container, a copied folder). */
  commit: string | null
  /** True when tracked files differed from that commit when the engine started; null without git. */
  dirty: boolean | null
  /** Hashes of what the models read: board/config.yaml, the board's agent files, the research answer's prompts. */
  hashes: { config: string | null; boardAgents: string | null; researchPrompts: string | null }
  versions: { node: string; piAi: string | null; piDurable: string | null }
}

const short = (text: string | Buffer) => createHash("sha256").update(text).digest("hex").slice(0, 16)

/** One hash for a file, or null when it cannot be read. */
export function fileHash(file: string): string | null {
  try { return short(readFileSync(file)) } catch { return null }
}

/** One hash for the `.md` files of a folder: their names and contents, in name order. Null when there are none. */
export function folderHash(dir: string): string | null {
  try {
    const names = readdirSync(dir).filter((n) => n.endsWith(".md") && statSync(join(dir, n)).isFile()).sort()
    if (!names.length) return null
    const h = createHash("sha256")
    for (const n of names) h.update(`${n}\0`).update(readFileSync(join(dir, n))).update("\0")
    return h.digest("hex").slice(0, 16)
  } catch { return null }
}

function git(args: string[]): string | null {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim() } catch { return null }
}

function packageVersion(name: string): string | null {
  try {
    const { version } = JSON.parse(readFileSync(resolve(ROOT, "engine/node_modules", name, "package.json"), "utf8")) as { version?: unknown }
    return typeof version === "string" ? version : null
  } catch { return null }
}

// The commit, the versions and the research prompts are read once, when this module loads at engine start: they do not
// change while the process runs (an edit or a git pull does not reload the code; research/prompts.ts reads its prompts
// once). The board's agent files are hashed on each call, because a board run reads them again.
function readFixed(): Pick<Manifest, "commit" | "dirty" | "versions"> & { researchPrompts: string | null } {
  const commit = git(["rev-parse", "HEAD"])
  const status = commit ? git(["status", "--porcelain", "--untracked-files=no"]) : null
  return {
    commit: commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null,
    dirty: status === null ? null : status.length > 0,
    versions: { node: process.versions.node, piAi: packageVersion("@earendil-works/pi-ai"), piDurable: packageVersion("@earendil-works/pi-durable") },
    researchPrompts: folderHash(resolve(ROOT, "engine/src/research/prompts")),
  }
}
const { researchPrompts, ...fixed } = readFixed()

/** The hash of board/config.yaml as it is on disk now. A caller that keeps a config loaded earlier hashes it when it loads it. */
export function configHash(): string | null {
  const configFile = resolve(ROOT, "board/config.yaml")
  return existsSync(configFile) ? fileHash(configFile) : null
}

/**
 * The manifest now. `config`: the config in use, for its agent folder (paths.agents); default board/agents.
 * `configAt`: the hash of board/config.yaml when that config was loaded; default the file on disk now.
 */
export function runManifest(config?: BoardConfig, configAt: string | null = configHash()): Manifest {
  const agentsDir = config ? path(config, "agents") : resolve(ROOT, "board/agents")
  return { ...fixed, hashes: { config: configAt, boardAgents: folderHash(agentsDir), researchPrompts } }
}
