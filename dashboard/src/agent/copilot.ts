import type { Metrics, Params, Simulation } from "@/sim/types"

export interface CopilotContext {
  sim: Simulation
  params: Params
  metrics: Metrics
  tick: number
  running: boolean
  play: () => void
  pause: () => void
  reset: () => void
  setParam: (key: string, value: number | boolean | string) => void
}

const fmt = (v: number) => (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2))

// Local stand-in so the UI works offline. To use a real model, replace this with the
// AI SDK's `useChat` against your own API route and expose the same actions as tools.
export async function respond(input: string, ctx: CopilotContext): Promise<string> {
  const text = input.trim().toLowerCase()
  await new Promise((r) => setTimeout(r, 250))

  if (/^(pause|stop)\b/.test(text)) {
    ctx.pause()
    return `Paused **${ctx.sim.name}** at tick ${ctx.tick}.`
  }
  if (/^(play|resume|start|run)\b/.test(text)) {
    ctx.play()
    return `Running **${ctx.sim.name}**.`
  }
  if (/^(reset|restart)\b/.test(text)) {
    ctx.reset()
    return `Restarted **${ctx.sim.name}** with the current parameters.`
  }

  const set = text.match(/^set\s+(.+?)\s+(?:to|=)\s+(.+)$/)
  if (set) {
    const [, name, raw] = set
    const spec = ctx.sim.params.find(
      (p) => p.key.toLowerCase() === name || p.label.toLowerCase() === name || p.label.toLowerCase().includes(name),
    )
    if (!spec) return `I couldn't find a parameter called "${name}". Try: ${ctx.sim.params.map((p) => p.label).join(", ")}.`
    let value: number | boolean | string
    if (spec.type === "number") {
      const n = Number(raw)
      if (Number.isNaN(n)) return `"${raw}" isn't a number.`
      value = Math.min(spec.max, Math.max(spec.min, n))
    } else if (spec.type === "boolean") {
      value = /^(on|true|yes|1)$/.test(raw)
    } else {
      const opt = spec.options.find((o) => o.toLowerCase() === raw)
      if (!opt) return `Options for ${spec.label}: ${spec.options.join(", ")}.`
      value = opt
    }
    ctx.setParam(spec.key, value)
    const restarts = ctx.sim.resetOn?.includes(spec.key)
    return `Set **${spec.label}** to \`${value}\`${restarts ? ". The simulation restarted to apply it." : "."}`
  }

  if (/(param|setting|control)/.test(text)) {
    if (!ctx.sim.params.length) return "This simulation has no parameters."
    return [
      `**${ctx.sim.name}** parameters:`,
      "",
      ...ctx.sim.params.map((p) => `- ${p.label}: \`${String(ctx.params[p.key])}\``),
    ].join("\n")
  }

  if (/(status|summary|how|what|metric|doing)/.test(text) || !text) {
    const rows = Object.entries(ctx.metrics)
    return [
      `**${ctx.sim.name}** is ${ctx.running ? "running" : "paused"} at tick ${ctx.tick.toLocaleString()}.`,
      "",
      ...(rows.length ? rows.map(([k, v]) => `- ${k}: **${fmt(v)}**`) : ["No metrics reported yet."]),
    ].join("\n")
  }

  return [
    "I'm a local placeholder copilot. I can:",
    "",
    "- give a **status** summary",
    "- list **parameters**",
    "- **pause**, **play** or **reset**",
    "- `set <parameter> to <value>`",
  ].join("\n")
}
