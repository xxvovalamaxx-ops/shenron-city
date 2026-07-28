import { readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { glbMetrics, readGlb } from './glb-utils.mjs'

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const requested = process.argv.slice(2)
const targets = requested.length > 0
  ? requested.map((value) => resolve(root, value))
  : walk(resolve(root, 'public/assets/production')).filter((path) => path.endsWith('.glb'))

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const rows = targets.map((path) => {
  const { file, document } = readGlb(path)
  return {
    path: relative(root, path).replaceAll('\\', '/'),
    bytes: file.length,
    ...glbMetrics(document),
  }
})

console.log(JSON.stringify(rows, null, 2))
