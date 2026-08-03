// defineConfig comes from vitest/config so the `test` block typechecks.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Port 9122 is fixed deliberately. This standalone phase reads no environment
 * variables and exposes no proxy, so starting the game cannot opt into host
 * services accidentally.
 */
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 9122,
    host: '127.0.0.1',
    hmr: false,
    watch: {
      // Native watchers, not per-file 1s polling: polling the whole repo at
      // ~15k tracked files stalls the event loop and starves real requests
      // (a 20 MB GLB took 140 s to serve). The authoring library and local
      // projects are huge and never imported by the runtime.
      ignored: ['**/SourceAssets/**', '**/Made assets/**', '**/node_modules/**'],
    },
  },
  build: {
    outDir: 'dist',
    // Public builds do not need multi-megabyte source maps. Local debugging
    // uses Vite's original modules.
    sourcemap: false,
    // Three + R3F is inherently a large bundle; keep the warning focused on
    // regressions materially larger than the current renderer entry.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
