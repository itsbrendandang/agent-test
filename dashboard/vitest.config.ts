import { readFileSync } from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Tests run in jsdom, apart from the app build (vite.config.ts). No test may reach the network: src/test/setup.ts
// replaces fetch with a function that fails unless the test stubs it.
// The version in package.json, shown in the profile menu's footer (src/lib/version.ts).
const version = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
})
