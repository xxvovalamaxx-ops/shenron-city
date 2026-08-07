// Copies the Draco decoder out of the installed three package into public/.
// GLTFLoader needs a URL to fetch the wasm from, and pointing it at a CDN
// would make the app require the network to open a local world file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..')
const SRC = path.join(APP, 'node_modules', 'three', 'examples', 'jsm', 'libs',
  'draco')
const DST = path.join(APP, 'public', 'draco')

if (!fs.existsSync(SRC)) {
  console.error('[draco] not found at', SRC, '- run npm install first')
  process.exit(1)
}

fs.mkdirSync(DST, { recursive: true })
let n = 0
for (const f of fs.readdirSync(SRC)) {
  const s = path.join(SRC, f)
  if (!fs.statSync(s).isFile()) continue
  fs.copyFileSync(s, path.join(DST, f))
  n++
}
// the gltf subfolder holds the decoder GLTFLoader actually asks for
const GSRC = path.join(SRC, 'gltf')
if (fs.existsSync(GSRC)) {
  for (const f of fs.readdirSync(GSRC)) {
    const s = path.join(GSRC, f)
    if (!fs.statSync(s).isFile()) continue
    fs.copyFileSync(s, path.join(DST, f))
    n++
  }
}
console.log(`[draco] copied ${n} files -> public/draco/`)
