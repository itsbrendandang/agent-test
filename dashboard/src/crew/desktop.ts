// True inside the Tauri desktop app, false in a plain browser.
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
