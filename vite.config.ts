// defineConfig comes from vitest/config so the `test` block typechecks;
// loadEnv is vite's and is not re-exported there.
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Port 9122 by default, out of the way of the Mission Control API (9120) and
 * its web frontend (9121).
 *
 * /api and /ws are proxied rather than called cross-origin. Mission Control's
 * CORS allowlist is deliberately narrow and does not include this port;
 * proxying keeps requests same-origin so the game needs no loosening of the
 * backend's security posture. See docs/SECURITY_BOUNDARY.md.
 *
 * MISSION_CONTROL_URL points at your own Mission Control. Nothing here should
 * ever hold a credential — the backend owns those.
 */
export default defineConfig(({ mode }) => {
  // '.' rather than process.cwd() — vite resolves it against the config's own
  // directory, and it keeps @types/node out of the dependency list.
  const env = loadEnv(mode, '.', '')
  const api = env.MISSION_CONTROL_URL || 'http://127.0.0.1:9120'
  const ws = api.replace(/^http/, 'ws')

  return {
    plugins: [react()],
    server: {
      port: Number(env.GAME_PORT) || 9122,
      host: '127.0.0.1',
      proxy: {
        '/api': { target: api, changeOrigin: true },
        '/ws': { target: ws, ws: true },
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
  }
})
