// Thin wrapper over the Tauri window API. Everything is a no-op in a plain browser.
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

async function crewWindow() {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow")
  return WebviewWindow.getByLabel("crew")
}

export async function isCrewOut(): Promise<boolean> {
  if (!isDesktop) return false
  return (await (await crewWindow())?.isVisible()) ?? false
}

export async function setCrewOut(out: boolean) {
  if (!isDesktop) return
  const w = await crewWindow()
  if (!w) return
  if (out) {
    const { currentMonitor } = await import("@tauri-apps/api/window")
    const m = await currentMonitor()
    if (m) {
      const area = m.workArea ?? { position: m.position, size: m.size }
      await w.setPosition(area.position)
      await w.setSize(area.size)
    }
    await w.setIgnoreCursorEvents(true)
    await w.show()
  } else {
    await w.hide()
  }
}
