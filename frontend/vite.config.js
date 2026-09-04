import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// vite.config.js — SIH26191 Risk-Aware Relocation Platform
// Proxy: all /api/* requests forwarded to FastAPI backend at port 8000.
// This means the frontend NEVER needs the backend URL hardcoded —
// in Docker, 'backend' resolves via Docker internal DNS.
// On the host dev machine, localhost:8000 is the FastAPI dev server.

import fs from 'fs'

const isDocker = fs.existsSync('/.dockerenv')
const backendTarget = process.env.BACKEND_URL || (isDocker ? 'http://backend:8000' : 'http://localhost:8000')

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',  // required for Docker container access
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (path) => path,  // keep /api prefix — FastAPI expects it
      },
      '/healthz': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
