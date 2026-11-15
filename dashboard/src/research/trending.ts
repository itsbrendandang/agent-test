// The "Try asking" questions (TryAsking.tsx, the Overview's starters): biology questions from what people search on
// Google right now. The engine reads Google Trends' free feed, keeps the searches about biology or health and makes each a question (GET /api/trending,
// engine/src/search/trending.ts). When nothing trending is about biology it sends curated biology questions instead.
// A trend is someone's search, so it is shown as plain text only.
import { useEffect, useState } from "react"
import { readEngine } from "@/lib/engine"

export interface TryQuestion { question: string; topic: string; trending: boolean }
export interface TryAskingReply { source: "google-trends" | "curated"; fetchedAt: number; items: TryQuestion[] }

const isQuestion = (q: unknown): q is TryQuestion =>
  !!q && typeof (q as TryQuestion).question === "string" && !!(q as TryQuestion).question.trim() && typeof (q as TryQuestion).topic === "string"

/** The engine's "Try asking" questions; undefined while they load or when the engine cannot be reached. */
export function useTryAsking(): TryAskingReply | undefined {
  const [reply, setReply] = useState<TryAskingReply>()
  useEffect(() => {
    let stopped = false
    readEngine<TryAskingReply>("/api/trending").then((r) => {
      const items = Array.isArray(r?.items) ? r.items.filter(isQuestion).slice(0, 6) : []
      if (!stopped && items.length) setReply({ source: r.source === "google-trends" ? "google-trends" : "curated", fetchedAt: Number(r.fetchedAt) || 0, items })
    }, () => {}) // no engine: the row is left out, the box still works
    return () => { stopped = true }
  }, [])
  return reply
}

/** The words after "Try asking": says where the questions come from. */
export const tryAskingNote = (reply: TryAskingReply | undefined) => (reply?.source === "google-trends" ? "Biology trending on Google Search now" : undefined)
