// The app's version, from package.json (set at build time by Vite's `define`; see vite.config.ts and vitest.config.ts).
declare const __APP_VERSION__: string | undefined
export const VERSION: string = typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "dev"
