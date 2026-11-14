import { useEffect, useState } from "react"
import type { Species } from "@/components/Buddy"

export interface CrewMember {
  id: string
  name: string
  role: string
  species: Species
  image?: string // uploaded character art (data URL); replaces the built-in look
  skill?: string // contents of this agent's SKILL.md
}

const KEY = "simlab.crew.v1"

export const DEFAULT_CREW: CrewMember[] = [
  { id: "researcher", name: "Momo", role: "Researcher", species: "bunny" },
  { id: "builder", name: "Ember", role: "Builder", species: "flame" },
  { id: "reviewer", name: "Fuji", role: "Reviewer", species: "mountain" },
]

function load(): CrewMember[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as CrewMember[]) : null
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_CREW
  } catch {
    return DEFAULT_CREW
  }
}

// Shared between the dashboard and the desktop overlay window through localStorage.
export function useCrew() {
  const [crew, setCrew] = useState(load)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setCrew(load()) }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])
  const save = (next: CrewMember[]) => {
    setCrew(next)
    localStorage.setItem(KEY, JSON.stringify(next))
  }
  const update = (id: string, patch: Partial<CrewMember>) => save(crew.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  return { crew, update, save }
}

// Shrinks an uploaded picture so it fits comfortably in localStorage.
export function readCharacterImage(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement("canvas")
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL("image/png"))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")) }
    img.src = url
  })
}
