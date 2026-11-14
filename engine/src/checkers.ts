// Escalation checkers. Only claims Jev left between its thresholds (or computed claims, which Jev
// should not do math on) reach these, so OpenAI credits and Claude Code time go to the hard cases.
import { spawn } from "node:child_process"
import type { Models } from "@earendil-works/pi-ai"
import { type BoardConfig, MOCK, ROOT } from "./config.ts"
import type { Verdict } from "./events.ts"

export interface Ruling { verdict: Verdict; note: string; usd: number }

const VERDICT = /\b(verified|unsupported|contradicted)\b/i

/** OpenAI reads the evidence and rules on a contested literature claim. */
export async function openaiCheck(models: Models, config: BoardConfig, claim: string, evidence: string): Promise<Ruling> {
  if (MOCK || !process.env.OPENAI_API_KEY) return { verdict: "unsupported", note: "mock: evidence mentions the topic but not the number", usd: 0 }
  const model = models.getModel("openai", config.checkers.openai_model)
  if (!model) throw new Error(`OpenAI model ${config.checkers.openai_model} is not available`)
  const reply = await models.complete(model, {
    systemPrompt: "You verify scientific claims against evidence. Answer with one word, verified, unsupported, or contradicted, then one sentence quoting the evidence.",
    messages: [{ role: "user", content: `Claim: ${claim}\n\nEvidence:\n${evidence}`, timestamp: Date.now() }],
  })
  const text = reply.content.map((c) => (c.type === "text" ? c.text : "")).join("")
  return { verdict: (VERDICT.exec(text)?.[1]?.toLowerCase() as Verdict) ?? "unsupported", note: text.slice(0, 300), usd: reply.usage.cost.total }
}

/** Claude Code reruns a computed claim (RDKit, a script) headless, in the repo. */
export async function claudeCodeCheck(config: BoardConfig, claim: string, source: string): Promise<Ruling> {
  if (MOCK) return { verdict: "verified", note: "mock: RDKit recomputation matches within tolerance", usd: 0 }
  const prompt = `Verify this computed claim by recomputing it (use RDKit via python if needed). Claim: ${claim}. Source: ${source}. ` +
    `Reply with one word, verified, unsupported, or contradicted, then one sentence with the recomputed value.`
  const [cmd, ...args] = config.checkers.claude_code_cmd.split(" ")
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, [...args, prompt], { cwd: ROOT })
    let stdout = ""
    child.stdout.on("data", (d) => (stdout += d))
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`claude exited ${code}`))))
  })
  let text = out, usd = 0
  try { const json = JSON.parse(out); text = json.result ?? out; usd = json.total_cost_usd ?? 0 } catch { /* plain text */ }
  return { verdict: (VERDICT.exec(text)?.[1]?.toLowerCase() as Verdict) ?? "unsupported", note: text.slice(0, 300), usd }
}
