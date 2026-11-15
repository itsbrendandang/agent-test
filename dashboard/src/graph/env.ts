import { useSyncExternalStore } from "react"

/** Can this browser make a WebGL context? Never throws. The context is released straight away. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas")
    const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as WebGLRenderingContext | null
    if (!gl) return false
    gl.getExtension("WEBGL_lose_context")?.loseContext()
    return true
  } catch { return false }
}

const QUERY = "(prefers-reduced-motion: reduce)"
const media = () => (typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : undefined)
/** The person asked the system for less motion. */
export const reducedMotionNow = (): boolean => media()?.matches ?? false
export const useReducedMotion = (): boolean =>
  useSyncExternalStore(
    (cb) => { const m = media(); m?.addEventListener?.("change", cb); return () => m?.removeEventListener?.("change", cb) },
    reducedMotionNow, () => false,
  )
