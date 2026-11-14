import { isDesktop } from "@/crew/desktop"

// Calls into the Rust side. Only available in the desktop app.
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop) throw new Error("This needs the desktop app")
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}
export { isDesktop }
