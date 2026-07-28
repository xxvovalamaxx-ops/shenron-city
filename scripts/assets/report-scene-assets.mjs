import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const scripts = [
  'scripts/assets/verify-manifest.mjs',
  'scripts/assets/inspect-gltf.mjs',
  'scripts/assets/scene-audit.mjs',
]
for (const script of scripts) {
  const result = spawnSync(process.execPath, [resolve(root, script)], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
