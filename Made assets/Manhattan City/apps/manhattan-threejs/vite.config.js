import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

// The world data lives in the repo, not in the app. Copying 26 MB of glb into
// public/ on every dev start is wasteful and would put build artefacts under
// version control twice, so serve them straight from where the build script
// wrote them.
const MOUNTS = {
  '/tiles/': path.join(REPO, 'exports'),
  '/data/': path.join(REPO, 'data', 'manhattan', 'runtime'),
  '/streets/': path.join(REPO, 'data', 'manhattan', 'streets'),
  '/props/': path.join(REPO, 'data', 'manhattan', 'props'),
  '/lod/': path.join(REPO, 'exports', 'lod'),
  '/hq/': path.join(REPO, 'data', 'manhattan', 'hq'),
  '/subway/': path.join(REPO, 'data', 'manhattan', 'subway'),
  '/doors/': path.join(REPO, 'data', 'manhattan', 'doors'),
}

const MIME = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.csv': 'text/csv',
}

// Dev-only capture sink. The runtime posts a canvas PNG here and it lands in
// evidence/phase2/, which is where the Phase 2 plan wants proof of what the
// build actually looks like. Writing screenshots from inside the app is the
// only way to capture the real GPU output rather than a description of it.
const EVIDENCE = path.join(REPO, 'evidence', 'phase2')

function captureSink() {
  return {
    name: 'capture-sink',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('POST only')
        }
        const name = (new URL(req.url, 'http://x').searchParams.get('name') ||
          'capture').replace(/[^a-z0-9._-]/gi, '_')
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          const b64 = body.replace(/^data:image\/\w+;base64,/, '')
          // A canvas with no backing store serialises to "data:," and used to
          // land here as a 0-byte file that still answered ok:true. Evidence
          // that reports success without an image is worse than no evidence.
          if (b64.length < 1000) {
            res.statusCode = 422
            res.setHeader('Content-Type', 'application/json')
            return res.end(JSON.stringify({
              ok: false, error: 'empty frame', bytes: b64.length,
            }))
          }
          fs.mkdirSync(EVIDENCE, { recursive: true })
          const file = path.join(EVIDENCE, `${name}.png`)
          fs.writeFileSync(file, Buffer.from(b64, 'base64'))
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            ok: true,
            file: path.relative(REPO, file),
            bytes: fs.statSync(file).size,
          }))
        })
      })
    },
  }
}

function serveWorldData() {
  return {
    name: 'serve-world-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url || '').split('?')[0])
        const mount = Object.keys(MOUNTS).find((m) => url.startsWith(m))
        if (!mount) return next()

        const rel = url.slice(mount.length)
        // no traversal out of the mount
        if (rel.includes('..')) {
          res.statusCode = 403
          return res.end('forbidden')
        }
        const file = path.join(MOUNTS[mount], rel)
        if (!file.startsWith(MOUNTS[mount]) || !fs.existsSync(file) ||
            !fs.statSync(file).isFile()) {
          res.statusCode = 404
          return res.end('not found')
        }
        res.setHeader('Content-Type',
          MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
        // Tiles are large and rarely rebuilt, so cache them. The runtime
        // payload is small and is rewritten every time the classifier runs;
        // caching it silently serves a stale city.
        res.setHeader('Cache-Control',
          (mount === '/tiles/' || mount === '/lod/')
            ? 'public, max-age=3600' : 'no-store')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [captureSink(), serveWorldData()],
  server: { port: 5173, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
