/**
 * Every GLB the game can serve must be able to find its own textures.
 *
 * This exists because the manifest passed while the game was throwing. Five
 * dev-spawn models referenced `Textures/colormap.png` relative to themselves,
 * that directory was never copied into `public/`, and the QA walkthrough
 * recorded five `THREE.GLTFLoader: Couldn't load texture` errors on a run
 * whose asset verification was green. The manifest checked provenance and
 * existence of the .glb; nothing checked what the .glb asked for next.
 *
 * So this walks `public/` itself rather than a list. A verifier that only
 * inspects files someone remembered to enumerate cannot fail on the asset
 * nobody remembered — which was the actual defect.
 *
 * Fails on:
 *   - an image URI that resolves to no file on disk
 *   - a bufferView image whose view is missing or out of range
 *
 * Usage: node scripts/assets/verify-runtime-textures.mjs [--root public]
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'
import { parseGlb, externalImageUris } from './embed-glb-textures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(glb|gltf)$/i.test(entry)) out.push(full)
  }
  return out
}

function checkFile(file) {
  const problems = []
  let json
  try {
    if (file.toLowerCase().endsWith('.gltf')) {
      json = JSON.parse(readFileSync(file, 'utf8'))
    } else {
      ;({ json } = parseGlb(readFileSync(file)))
    }
  } catch (err) {
    return [`unreadable: ${err.message}`]
  }

  // External URIs must resolve against the model's own directory, which is how
  // a browser resolves them from the served URL.
  for (const { index, uri } of externalImageUris(json)) {
    const target = resolve(dirname(file), decodeURIComponent(uri))
    if (!existsSync(target)) {
      problems.push(`image[${index}] -> "${uri}" (404: no file at ${relative(REPO_ROOT, target)})`)
    }
  }

  // Embedded images must point at a bufferView that actually exists.
  const views = json.bufferViews ?? []
  ;(json.images ?? []).forEach((img, index) => {
    if (img.bufferView === undefined) return
    const view = views[img.bufferView]
    if (!view) problems.push(`image[${index}] -> bufferView ${img.bufferView} does not exist`)
    else if (!(view.byteLength > 0)) problems.push(`image[${index}] -> bufferView ${img.bufferView} is empty`)
  })

  // A buffer with a URI in a GLB is a second external dependency.
  ;(json.buffers ?? []).forEach((buf, index) => {
    if (buf.uri && !buf.uri.startsWith('data:')) {
      const target = resolve(dirname(file), decodeURIComponent(buf.uri))
      if (!existsSync(target)) {
        problems.push(`buffer[${index}] -> "${buf.uri}" (404: no file at ${relative(REPO_ROOT, target)})`)
      }
    }
  })

  return problems
}

function main() {
  const i = process.argv.indexOf('--root')
  const root = resolve(REPO_ROOT, i >= 0 ? process.argv[i + 1] : 'public')
  if (!existsSync(root)) {
    console.error(`verify-runtime-textures: no such directory ${root}`)
    process.exit(2)
  }

  const files = walk(root)
  let failed = 0
  for (const file of files) {
    const problems = checkFile(file)
    if (problems.length) {
      failed++
      console.error(`FAIL ${relative(REPO_ROOT, file)}`)
      for (const p of problems) console.error(`       ${p}`)
    }
  }

  console.log(
    `verify-runtime-textures: scanned ${files.length} model(s) under ` +
    `${relative(REPO_ROOT, root)} — ${failed} with unresolvable dependencies`,
  )
  process.exit(failed ? 1 : 0)
}

main()
