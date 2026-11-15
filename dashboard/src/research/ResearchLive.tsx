// The Research page while an answer is made: the conversation and the live Agent Lab side by side (the conversation
// on the left, the lab on the right), or the lab above the conversation when there is no room for both. When the
// answer is finished the lab folds into one line, so the answer gets the width; it can be opened again, and replayed.
//
// The lab is the Agent Lab's own scene (lab/Lab, lab/LabScene, lab/motion), drawn by lab/adapter's answerLab from the
// events the answer on the page already receives (useSeenEvents: no second stream). A teammate is in the lab only
// when a step of the answer is its own, and it moves only for a step the engine reported. Nothing is timed or made up
// here. The one exception to "live" is a replay, which is said as such: the recorded events again, one after another.
// A practice answer is over in a few milliseconds, so one started on this visit is replayed once by itself.
// Reduced motion (the system setting) and "Pause motion" (the scene's own button) are honoured by the scene.
import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import { Lab } from "@/lab/Lab"
import { answerLab, answerOrder, num, str, type LabEvent } from "@/lab/adapter"
import { CHARACTERS, clip, plural } from "@/lab/model"
import { countAt, defaultPace, lengthOf, timelineOf } from "@/lab/replay"
import { useSeenEvents } from "./api"
import { loadLabOpen, saveLabOpen } from "./labState"
import "@/design/researchLab.css"

/** An answer that was over in less than this (a practice answer) could not be watched; one started on this visit is replayed once. */
export const BLINK_MS = 5000
/** A replay plays the recorded events this many times faster than their pace (replay.ts: real, or evenly spaced). */
export const REPLAY_SPEED = 3
/** After the last event of a replay, the end state stays this long (ms of replay time) before the replay ends. */
const REPLAY_HOLD_MS = 4500
const TICK_MS = 100
const ENDS = new Set(["research.finished", "research.failed", "research.cancelled"])

const STATUS_WORD = { empty: "Not started", waiting: "Waiting to start", running: "Team at work", done: "Answer finished", failed: "Answer failed", cancelled: "Answer stopped" } as const
const STATUS_GLYPH = { empty: "", waiting: "…", running: "●", done: "✓", failed: "✕", cancelled: "■" } as const

/**
 * How many teammates the engine has reported doing something: a step, a walk. A teammate with a role in answers but no
 * step yet stays idle at its desk. Counted before the answer's end, which sends every teammate back to its desk (or
 * marks it done) whether it worked or not. A method specialist took part once a step of its own started, unless the
 * engine ended that step without asking it.
 */
function tookPart(ordered: LabEvent[], answer: string | undefined): number {
  const worked = answerLab(ordered.filter((e) => !ENDS.has(String(e.type))), answer)
  const notAsked = new Set(ordered.filter((e) => e.type === "step.finished" && str(e.summary)?.startsWith("Not asked")).map((e) => e.step))
  const guests = new Set(ordered.filter((e) => e.type === "step.started" && !notAsked.has(e.step) && worked.visitors.some((v) => v.id === e.agent)).map((e) => e.agent)).size
  return CHARACTERS.filter((c) => { const a = worked.characters[c.id]; return a.inRun && (a.state !== "idle" || a.trips.length > 0) }).length + guests
}

function useReducedMotion(): boolean {
  const query = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : undefined)
  const [reduced, setReduced] = useState(() => !!query()?.matches)
  useEffect(() => {
    const q = query()
    if (!q) return
    const on = () => setReduced(q.matches)
    on(); q.addEventListener?.("change", on)
    return () => q.removeEventListener?.("change", on)
  }, [])
  return reduced
}

interface Props {
  /** The answer the lab follows: the one being made, else the latest. None: the conversation alone. */
  answer?: string
  /** Started on this visit (not restored): a practice answer, over in a blink, is replayed once by itself. */
  fresh?: boolean
  /** The conversation (and its composer). */
  children: ReactNode
}

export function ResearchLive({ answer, fresh = false, children }: Props) {
  const events = useSeenEvents(answer)
  const reduced = useReducedMotion()
  const bodyId = useId()
  const [pref, setPref] = useState(loadLabOpen) // open while an answer is being made
  const [reopened, setReopened] = useState<string>() // the finished answer whose lab the person opened again
  const [replay, setReplay] = useState<{ answer: string; auto: boolean; n: number }>() // n: which replay, so a new one starts from the beginning
  const [replays, setReplays] = useState(0)
  const [considered, setConsidered] = useState<string>() // the last answer looked at for a replay by itself
  const [position, setPosition] = useState(0) // ms into the replay

  const ordered = useMemo(() => answerOrder(events as unknown as LabEvent[]), [events])
  const full = useMemo(() => answerLab(ordered, answer), [ordered, answer])
  const timeline = useMemo(() => timelineOf(ordered.map((e) => num(e.at))), [ordered])
  const pace = defaultPace(timeline)
  const playing = replay && replay.answer === answer ? replay : undefined
  const count = playing ? countAt(timeline, pace, position) : ordered.length
  const model = useMemo(() => (playing ? answerLab(ordered.slice(0, count), answer) : full), [playing, ordered, count, answer, full])
  const first = num(ordered[0]?.at)
  // The replay's present, in engine time: the time of the last event shown. A live run is watched at "now".
  const clock = playing && first !== undefined && count > 0 ? first + timeline.offsets[count - 1] : undefined

  const took = useMemo(() => tookPart(ordered, answer), [ordered, answer])
  const shownTook = useMemo(() => (playing ? tookPart(ordered.slice(0, count), answer) : took), [playing, ordered, count, answer, took])
  const has = !!answer && took > 0 // before the first step there is nobody to show: the answer says it is starting
  const live = full.status === "running" || full.status === "waiting"
  const finished = full.status === "done" || full.status === "failed" || full.status === "cancelled"
  const open = has && (!!playing || (live ? pref : reopened === answer))

  const play = (auto: boolean) => { if (!answer) return; setPosition(0); setReplays(replays + 1); setReplay({ answer, auto, n: replays + 1 }) }
  // A practice answer started on this visit was over before anyone could watch it: play its events once, then fold.
  if (answer && fresh && has && finished && considered !== answer) {
    setConsidered(answer)
    if (pref && !reduced && timeline.realMs < BLINK_MS) play(true)
  }

  useEffect(() => {
    if (!playing) return
    const end = lengthOf(timeline, pace) + REPLAY_HOLD_MS
    const started = Date.now()
    const timer = window.setInterval(() => {
      const at = (Date.now() - started) * REPLAY_SPEED
      if (at >= end) setReplay(undefined)
      else setPosition(at)
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [playing, timeline, pace])

  const toggle = () => {
    if (open) {
      setReplay(undefined); setReopened(undefined)
      if (live) { setPref(false); saveLabOpen(false) }
    } else if (live) { setPref(true); saveLabOpen(true) }
    else setReopened(answer)
  }
  const startReplay = () => { setReopened(answer); play(false) }

  const latest = live ? full.log.at(-1)?.text : undefined
  const status = playing ? model.status : full.status // a replay says the state of the moment it shows
  return (
    <div className="research-live" data-lab={has ? (open ? "open" : "closed") : undefined}>
      <div className="research-live-grid">
        {has && (
          <aside className="research-lab" aria-label="Agent Lab for this answer" data-status={status}>
            <div className="research-lab-bar">
              <span className="research-lab-title">Agent Lab</span>
              <span className="research-lab-status" data-status={status}>
                {playing && "Replay: "}{STATUS_GLYPH[status] && <span aria-hidden="true">{STATUS_GLYPH[status]} </span>}{STATUS_WORD[status]}
                <span className="muted"> · {plural(shownTook, "teammate")} {status === "done" || status === "failed" || status === "cancelled" ? "took part" : "on it"}</span>
              </span>
              {!open && latest && <span className="research-lab-latest muted small" title={latest}>{clip(latest, 120)}</span>}
              <span className="research-lab-actions">
                {finished && !playing && <button type="button" className="link-btn" onClick={startReplay} title="Play this answer's recorded events again, one after another.">Replay</button>}
                <button type="button" className="btn research-lab-toggle" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={toggle}>{open ? "Hide the lab" : "Show the lab"}</button>
              </span>
            </div>
            {open && (
              <div className="research-lab-body" id={bodyId}>
                <Lab model={model} compact layout="compact" clock={clock} speed={playing ? REPLAY_SPEED : 1} settleKey={playing ? `replay:${playing.n}` : "live"}
                  footer={playing && (
                    <span className="research-lab-replay">
                      <span className="mono">Replay · {count} of {ordered.length} events{pace === "even" ? " · evenly spaced" : ""} · {REPLAY_SPEED}×</span>
                      <button type="button" className="link-btn" onClick={() => { setReplay(undefined); if (playing.auto) setReopened(undefined) }}>Stop replay</button>
                    </span>
                  )} />
              </div>
            )}
          </aside>
        )}
        <div className="research-live-chat">{children}</div>
      </div>
    </div>
  )
}
