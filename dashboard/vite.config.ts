import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The version in package.json, shown in the profile menu's footer (src/lib/version.ts).
const version = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss()],
  server: { port: 5317, host: "127.0.0.1", strictPort: true },
  clearScreen: false,
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
