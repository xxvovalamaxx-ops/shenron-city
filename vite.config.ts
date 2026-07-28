// defineConfig comes from vitest/config so the `test` block typechecks.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Standalone game server. There is deliberately no API or WebSocket proxy in
 * this phase, so browser requests cannot be forwarded to host services.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 9122,
    host: '127.0.0.1',
    hmr: false,
    clearScreen: false,
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // three + R3F is inherently a large bundle; the default 500 kB warning
    // fires on every build and trains you to ignore it.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
