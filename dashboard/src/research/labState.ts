// The live Agent Lab of the Research page (ResearchLive.tsx): whether the person wants it open while an answer is made.

const KEY = "research.lab"
/** Remembered in this browser; open unless the person closed it. */
export function loadLabOpen(): boolean { try { return localStorage.getItem(KEY) !== "closed" } catch { return true } }
export function saveLabOpen(open: boolean) { try { localStorage.setItem(KEY, open ? "open" : "closed") } catch { /* private mode: not remembered */ } }
