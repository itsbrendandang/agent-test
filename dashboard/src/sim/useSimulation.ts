import { useCallback, useEffect, useRef, useState } from "react"
import type { Metrics, Params, SimEvent, Simulation, TimelineEvent } from "./types"

const HISTORY = 300
const MAX_EVENTS = 60
const FLUSH_EVERY = 12 // frames between React updates

export function useSimulation(sim: Simulation, params: Params, running: boolean, speed: number) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const state = useRef<unknown>(null)
  const paramsRef = useRef(params)
  const [tick, setTick] = useState(0)
  const [history, setHistory] = useState<Metrics[]>([])
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const tickRef = useRef(0)
  const histRef = useRef<Metrics[]>([])
  const eventsRef = useRef<TimelineEvent[]>([])
  const nextId = useRef(0)

  paramsRef.current = params

  const pushEvents = useCallback((list: SimEvent[]) => {
    if (!list.length) return
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    const stamped = list.map((e) => ({ ...e, id: nextId.current++, tick: tickRef.current, time }))
    eventsRef.current = [...stamped.reverse(), ...eventsRef.current].slice(0, MAX_EVENTS)
  }, [])

  const collect = useCallback(() => {
    if (!state.current) return
    if (sim.metrics) histRef.current = [...histRef.current.slice(-HISTORY + 1), sim.metrics(state.current)]
    if (sim.drainEvents) pushEvents(sim.drainEvents(state.current))
  }, [sim, pushEvents])

  const flush = useCallback(() => {
    setTick(tickRef.current)
    setHistory(histRef.current)
    setEvents(eventsRef.current)
  }, [])

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (ctx && state.current) sim.draw(ctx, state.current, paramsRef.current)
  }, [sim])

  const log = useCallback((e: SimEvent) => {
    pushEvents([e])
    setEvents(eventsRef.current)
  }, [pushEvents])

  const reset = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const rect = c.getBoundingClientRect()
    c.width = Math.max(200, Math.floor(rect.width))
    c.height = Math.max(200, Math.floor(rect.height))
    state.current = sim.init(paramsRef.current, c.width, c.height)
    tickRef.current = 0
    histRef.current = []
    eventsRef.current = []
    pushEvents([{ kind: "info", label: "Simulation started", detail: sim.name }])
    collect()
    flush()
    draw()
  }, [sim, draw, collect, flush, pushEvents])

  const stepOnce = useCallback(() => {
    if (!state.current) return
    sim.step(state.current, paramsRef.current)
    tickRef.current++
    collect()
  }, [sim, collect])

  const step = useCallback(() => {
    stepOnce()
    draw()
    flush()
  }, [stepOnce, draw, flush])

  const resetKey = (sim.resetOn ?? []).map((k) => String(params[k])).join("|")
  useEffect(reset, [reset, resetKey])

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    // Hidden views report a zero size; only rebuild when the visible size really changed.
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width), h = Math.floor(entry.contentRect.height)
      if (w < 200 || h < 200 || (w === c.width && h === c.height)) return
      reset()
    })
    ro.observe(c)
    return () => ro.disconnect()
  }, [reset])

  useEffect(() => {
    if (!running) return
    let raf = 0
    let acc = 0
    let frames = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (document.hidden) return
      acc += speed
      while (acc >= 1) {
        stepOnce()
        acc -= 1
      }
      // Skip painting while another view is showing; update React about 5 times a second.
      if (canvasRef.current?.offsetParent) draw()
      if (++frames % FLUSH_EVERY === 0) flush()
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running, speed, stepOnce, draw, flush])

  useEffect(() => {
    if (!running) draw()
  }, [params, running, draw])

  return { canvasRef, tick, history, events, reset, step, log }
}
