import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5317, host: "127.0.0.1", strictPort: true },
  clearScreen: false,
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
