// Stands in for `docker` in the run-control tests (GLHF_DOCKER_CMD). It knows the four commands the tracker uses to
// find and remove the sandbox containers of a run, and keeps its "containers" in a JSON file:
//   GLHF_DOCKER_STUB_STATE   [{ id, name, project, mounts: [host paths], sticky?: true }]   (no file: no containers)
//   GLHF_DOCKER_STUB_LOG     gets one line per call: the arguments
//   GLHF_DOCKER_STUB_FAIL=1  every call fails, like a machine without a running Docker daemon
// A "sticky" container survives `rm`.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"

const args = process.argv.slice(2)
if (process.env.GLHF_DOCKER_STUB_LOG) appendFileSync(process.env.GLHF_DOCKER_STUB_LOG, `${args.join(" ")}\n`)
if (process.env.GLHF_DOCKER_STUB_FAIL === "1") { console.error("Cannot connect to the Docker daemon"); process.exit(1) }
const file = process.env.GLHF_DOCKER_STUB_STATE
const state = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []

if (args[0] === "ps") console.log(state.map((c) => c.id).join("\n"))
else if (args[0] === "inspect") {
  const ids = args.slice(args.indexOf("--format") + 2)
  for (const c of state.filter((c) => ids.includes(c.id))) console.log([c.id, `/${c.name}`, c.project ?? "", ...c.mounts, ""].join("\t"))
} else if (args[0] === "rm") {
  writeFileSync(file, JSON.stringify(state.filter((c) => c.sticky || !args.includes(c.id))))
} else if (args[0] === "network") { /* no networks */ } else { console.error(`docker stub: unknown command ${args[0]}`); process.exit(2) }
