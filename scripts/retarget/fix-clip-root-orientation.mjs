/**
 * Rotate a bone's animated orientation by a fixed correction, in every clip.
 *
 * The retargeted locomotion clips came out of Blender laying the character
 * face-down: measured in the running game, the head sat 0.29 m *below* the
 * feet with a 1.41 m horizontal span, where a standing 1.8 m body reads about
 * +1.6 m up and 0.1 m across.
 *
 * Two separate faults produced that, and this script fixes the second.
 * `strip-root-holder-channels.mjs` removes the -90 degree X rotation the
 * exporter animated onto the skeleton *holder*. What remains is a genuine
 * frame error in the baked bone data: the whole animated hierarchy is rotated
 * 90 degrees about Z relative to the mesh's own rest pose, because the
 * Quaternius source rig and the Sketchfab target rig do not share a rest
 * orientation and the world-space bake carried that difference through.
 *
 * The correction was not guessed. It was found by sweeping candidate rotations
 * on `root_01` in the live game and measuring head-above-feet for each:
 *
 *     none    -0.29 m up, 1.410 m across
 *     x-90    +0.117,     1.435
 *     x180    +0.290,     1.410
 *     y+-90   -0.290,     1.410
 *     z-90    -1.405,     0.313
 *     z+90    +1.405,     0.313   <- standing
 *
 * Only a rotation about Z moves the span, because the body's long axis lies
 * along X; that is why the obvious X corrections all failed and left the span
 * untouched.
 *
 * Applied to the bone rather than at runtime because the asset is what is
 * wrong. Each clip owns its own output accessor for this channel — checked,
 * seven accessors, none shared with another node or path — so rewriting them
 * in place cannot disturb anything else.
 *
 * Usage:
 *   node scripts/retarget/fix-clip-root-orientation.mjs <glb> --bone root_01 --axis z --degrees 90
 */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { parseGlb, writeGlb } from './strip-root-holder-channels.mjs'

/** Quaternion (x, y, z, w) for `degrees` about a principal axis. */
export function axisQuaternion(axis, degrees) {
  const half = ((degrees * Math.PI) / 180) / 2
  const s = Math.sin(half)
  const w = Math.cos(half)
  if (axis === 'x') return [s, 0, 0, w]
  if (axis === 'y') return [0, s, 0, w]
  if (axis === 'z') return [0, 0, s, w]
  throw new Error(`axis must be x, y or z (got ${axis})`)
}

/** Hamilton product, (x, y, z, w) convention — same as three's. */
export function multiplyQuaternions(a, b) {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

function accessorView(json, bin, index) {
  const accessor = json.accessors[index]
  const view = json.bufferViews[accessor.bufferView]
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  if (accessor.componentType !== 5126) {
    throw new Error(`accessor ${index} is not float (componentType ${accessor.componentType})`)
  }
  if (accessor.type !== 'VEC4') {
    throw new Error(`accessor ${index} is ${accessor.type}, expected VEC4`)
  }
  return { start, count: accessor.count }
}

/**
 * Pre-multiply every key of `bone`'s rotation channel by `correction`.
 *
 * Pre- rather than post-multiplication: the correction is expressed in the
 * bone's parent space, which is where the frame error lives. Post-multiplying
 * would rotate the body about its own axes and give a different, wrong answer.
 */
export function correctBoneRotation(json, bin, boneName, correction) {
  const names = (json.nodes ?? []).map((n) => n.name ?? '')
  const seen = new Set()
  let keys = 0
  let clips = 0

  for (const animation of json.animations ?? []) {
    let touched = false
    for (const channel of animation.channels ?? []) {
      if (channel.target?.path !== 'rotation') continue
      if (names[channel.target.node] !== boneName) continue
      const output = animation.samplers[channel.sampler].output
      if (seen.has(output)) continue
      seen.add(output)
      const { start, count } = accessorView(json, bin, output)
      for (let k = 0; k < count; k++) {
        const o = start + k * 16
        const q = [
          bin.readFloatLE(o),
          bin.readFloatLE(o + 4),
          bin.readFloatLE(o + 8),
          bin.readFloatLE(o + 12),
        ]
        const next = multiplyQuaternions(correction, q)
        bin.writeFloatLE(next[0], o)
        bin.writeFloatLE(next[1], o + 4)
        bin.writeFloatLE(next[2], o + 8)
        bin.writeFloatLE(next[3], o + 12)
        keys++
      }
      touched = true
    }
    if (touched) clips++
  }
  return { keys, clips, accessors: seen.size }
}

function main(argv) {
  const file = argv[0]
  if (!file) {
    console.error(
      'usage: fix-clip-root-orientation.mjs <glb> --bone root_01 --axis z --degrees 90 [--out GLB]',
    )
    process.exit(2)
  }
  const arg = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : fallback
  }
  const bone = arg('--bone', 'root_01')
  const axis = arg('--axis', 'z')
  const degrees = Number(arg('--degrees', '90'))
  const out = arg('--out', file)

  const { json, bin } = parseGlb(readFileSync(file))
  const correction = axisQuaternion(axis, degrees)
  const report = correctBoneRotation(json, bin, bone, correction)
  if (!report.keys) {
    console.log(`skip ${file}: no rotation channel for "${bone}"`)
    return
  }
  writeFileSync(out, writeGlb(json, bin))
  console.log(
    `ok   ${out}: rotated ${bone} by ${degrees} deg about ${axis} — ` +
      `${report.keys} key(s) across ${report.clips} clip(s), ${report.accessors} accessor(s)`,
  )
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2))
}
