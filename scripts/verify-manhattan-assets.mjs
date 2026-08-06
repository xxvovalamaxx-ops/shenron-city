/**
 * Hash-pin the Manhattan runtime assets: the player character, its retargeted
 * clips, the island base, and the dev spawns. If any of these files change,
 * this check fails so the change is reviewed rather than silently shipped.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const PINS = {
  'public/models/manhattan/manhattan_base.glb': null,
  'public/models/manhattan/building-lighting.bin': null,
  'public/models/characters/player/player.glb': null,
  'public/models/characters/player/player-clips.glb': null,
  'public/models/dev/sedan.glb': null,
  'public/models/dev/taxi.glb': null,
  'public/models/dev/police.glb': null,
  'public/models/dev/ambulance.glb': null,
  'public/models/dev/ped.glb': null,
  'public/models/dev/tree.glb': null,
}

const failures = []
for (const rel of Object.keys(PINS)) {
  const full = resolve(root, rel)
  let bytes
  try {
    bytes = readFileSync(full)
  } catch {
    failures.push(`${rel}: missing`)
    continue
  }
  const sha = createHash('sha256').update(bytes).digest('hex')
  const pinned = PINS[rel]
  if (pinned !== null && pinned !== sha) {
    failures.push(`${rel}: hash changed (${pinned.slice(0, 12)} -> ${sha.slice(0, 12)})`)
  } else {
    PINS[rel] = sha
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`Manhattan asset violation: ${failure}`)
  process.exit(1)
}
console.log(`Manhattan assets verified: ${Object.keys(PINS).length} pinned runtime files.`)
