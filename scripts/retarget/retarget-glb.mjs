/**
 * Retarget locomotion from one rigged glTF onto another, without Blender.
 *
 * Replaces scripts/retarget/bake-retarget.py, which produced clips that were
 * wrong twice over:
 *
 *   - It used a world-space CopyRotation with mix_mode='REPLACE', which copies
 *     the source bone's *absolute* orientation. Two humanoid rigs almost never
 *     share a rest orientation, so the target's limbs went where the source's
 *     bone axes were. Measured on an idle frame: median 78.8 degrees from rest
 *     across 88 bones, worst 179.
 *   - The bake did not actually vary per frame. Every clip came out with two
 *     keyframes — the exporter's collapse of a constant channel — against 17
 *     to 61 in the source. The character held one fixed wrong pose and called
 *     it walking.
 *
 * Doing it here instead of in Blender means the pipeline is reproducible from
 * a checkout, runs in CI, and its arithmetic is unit-tested (retarget-math).
 *
 * Usage:
 *   node scripts/retarget/retarget-glb.mjs \
 *     --source scripts/retarget/quaternius-hero.glb \
 *     --target public/models/characters/player/player-clips.glb \
 *     --mapping scripts/retarget/mapping.json \
 *     [--out <glb>] [--dry-run]
 *
 * The target is a clips file that already carries the destination skeleton and
 * one animation per clip. Its channels are repointed at freshly appended
 * accessors; the node hierarchy and the rest pose are never touched.
 */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { parseGlb, writeGlb } from './strip-root-holder-channels.mjs'
import { axisQuaternion, correctBoneRotation } from './fix-clip-root-orientation.mjs'
import {
  restWorldRotations,
  retargetFrame,
  sampleRotation,
  quatMultiply,
  quatAngle,
  topoOrder,
} from './retarget-math.mjs'

const FLOAT = 5126
const ARRAY_BUFFER_NONE = undefined

/** Nodes as retarget-math wants them: name, parent index, rest rotation. */
export function buildNodes(json) {
  const nodes = (json.nodes ?? []).map((n) => ({
    name: n.name ?? '',
    parent: -1,
    rotation: n.rotation ?? [0, 0, 0, 1],
    translation: n.translation ?? [0, 0, 0],
  }))
  ;(json.nodes ?? []).forEach((n, i) => {
    for (const c of n.children ?? []) nodes[c].parent = i
  })
  return nodes
}

function readAccessor(json, bin, index) {
  const a = json.accessors[index]
  const view = json.bufferViews[a.bufferView]
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]
  if (a.componentType !== FLOAT) {
    throw new Error(`accessor ${index}: expected float, got componentType ${a.componentType}`)
  }
  const stride = view.byteStride ?? comps * 4
  const out = []
  for (let k = 0; k < a.count; k++) {
    const o = start + k * stride
    const v = []
    for (let c = 0; c < comps; c++) v.push(bin.readFloatLE(o + c * 4))
    out.push(comps === 1 ? v[0] : v)
  }
  return out
}

/** Rotation tracks of one animation, keyed by node index. */
function readRotationTracks(json, bin, animation) {
  const tracks = new Map()
  for (const channel of animation.channels ?? []) {
    if (channel.target?.path !== 'rotation') continue
    const sampler = animation.samplers[channel.sampler]
    tracks.set(channel.target.node, {
      times: readAccessor(json, bin, sampler.input),
      values: readAccessor(json, bin, sampler.output),
    })
  }
  return tracks
}

/** Union of every key time in an animation's rotation tracks, sorted. */
function keyTimes(tracks) {
  const set = new Set()
  for (const { times } of tracks.values()) for (const t of times) set.add(+t.toFixed(6))
  const out = [...set].sort((a, b) => a - b)
  return out.length ? out : [0]
}

/** Append a float accessor to the BIN and return its index. */
function appendAccessor(json, chunks, values, type) {
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type]
  const buf = Buffer.alloc(values.length * comps * 4)
  values.forEach((v, k) => {
    const arr = comps === 1 ? [v] : v
    for (let c = 0; c < comps; c++) buf.writeFloatLE(arr[c], (k * comps + c) * 4)
  })
  const byteOffset = chunks.length
  chunks.push(buf)
  const view = json.bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: buf.length,
    target: ARRAY_BUFFER_NONE,
  }) - 1
  const accessor = {
    bufferView: view,
    componentType: FLOAT,
    count: values.length,
    type,
  }
  if (type === 'SCALAR') {
    const nums = values
    accessor.min = [Math.min(...nums)]
    accessor.max = [Math.max(...nums)]
  }
  return json.accessors.push(accessor) - 1
}

/** A growable BIN chunk that reports its own length as an offset. */
function binBuilder(initial) {
  const parts = [initial]
  let length = initial.length
  return {
    get length() {
      return length
    },
    push(buf) {
      const pad = (4 - (length % 4)) % 4
      if (pad) {
        parts.push(Buffer.alloc(pad, 0))
        length += pad
      }
      parts.push(buf)
      length += buf.length
    },
    build: () => Buffer.concat(parts),
    offsetOf: () => length,
  }
}

export function retargetClips({ source, target, mapping, log = () => {} }) {
  const srcNodes = buildNodes(source.json)
  const tgtNodes = buildNodes(target.json)
  const srcIndex = new Map(srcNodes.map((n, i) => [n.name, i]))
  const tgtIndex = new Map(tgtNodes.map((n, i) => [n.name, i]))

  const pairs = []
  const unmatched = []
  for (const [srcName, tgtName] of Object.entries(mapping)) {
    const s = srcIndex.get(srcName)
    const t = tgtIndex.get(tgtName)
    if (s === undefined || t === undefined) {
      unmatched.push(`${srcName} -> ${tgtName}`)
      continue
    }
    pairs.push({ source: s, target: t })
  }

  const srcRestWorld = restWorldRotations(srcNodes)
  const tgtRestWorld = restWorldRotations(tgtNodes)
  const srcOrder = topoOrder(srcNodes)

  const chunks = binBuilder(target.bin)
  const bufferParts = []
  const builder = {
    get length() {
      return chunks.length
    },
    push: (buf) => {
      bufferParts.push(buf)
      chunks.push(buf)
    },
  }

  const summary = []
  for (const animation of target.json.animations ?? []) {
    const name = animation.name
    const srcAnimation = (source.json.animations ?? []).find((a) => a.name === name)
    if (!srcAnimation) {
      summary.push({ clip: name, skipped: 'no source clip of that name' })
      continue
    }
    const srcTracks = readRotationTracks(source.json, source.bin, srcAnimation)
    const times = keyTimes(srcTracks)

    // Per frame: source world rotations, then the retarget.
    const perTarget = new Map()
    for (const time of times) {
      const srcLocal = srcNodes.map((n, i) => {
        const track = srcTracks.get(i)
        return track ? sampleRotation(track.times, track.values, time) : n.rotation
      })
      // topoOrder, not array order: glTF does not guarantee a parent appears
      // before its children, and this rig does not oblige.
      const srcWorld = new Array(srcNodes.length)
      for (const i of srcOrder) {
        const p = srcNodes[i].parent
        srcWorld[i] = p >= 0 ? quatMultiply(srcWorld[p], srcLocal[i]) : srcLocal[i]
      }
      const local = retargetFrame({ srcWorld, srcRestWorld, tgtNodes, tgtRestWorld, pairs })
      for (const [tgt, q] of local) {
        if (!perTarget.has(tgt)) perTarget.set(tgt, [])
        perTarget.get(tgt).push(q)
      }
    }

    // Repoint each rotation channel at fresh accessors.
    const timeAccessor = appendAccessor(target.json, builder, times, 'SCALAR')
    let rewritten = 0
    for (const channel of animation.channels ?? []) {
      if (channel.target?.path !== 'rotation') continue
      const values = perTarget.get(channel.target.node)
      if (!values || values.length !== times.length) continue
      const output = appendAccessor(target.json, builder, values, 'VEC4')
      animation.samplers[channel.sampler] = {
        input: timeAccessor,
        output,
        interpolation: 'LINEAR',
      }
      rewritten++
    }

    // How far the first frame sits from rest — a sanity number, not a gate.
    const first = [...perTarget.entries()].map(([t, v]) =>
      (quatAngle(tgtNodes[t].rotation ?? [0, 0, 0, 1], v[0]) * 180) / Math.PI,
    )
    first.sort((a, b) => a - b)
    summary.push({
      clip: name,
      keys: times.length,
      bones: rewritten,
      medianDeviationDeg: first.length ? +first[Math.floor(first.length / 2)].toFixed(1) : null,
    })
    log(`  ${name}: ${times.length} keys, ${rewritten} bones`)
  }

  return { summary, unmatched, pairs: pairs.length, bin: chunks.build() }
}

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : fallback
  }
  const sourcePath = arg('--source', 'scripts/retarget/quaternius-hero.glb')
  const targetPath = arg('--target', 'public/models/characters/player/player-clips.glb')
  const mappingPath = arg('--mapping', 'scripts/retarget/mapping.json')
  const out = arg('--out', targetPath)
  const dryRun = argv.includes('--dry-run')
  // Rest-delta retargeting transfers each bone's motion correctly but says
  // nothing about how the two rigs' world frames line up. The source's root
  // carries a -90 degree X rest rotation (Quaternius's Z-up to Y-up
  // conversion) whose mapped target, _rootJoint, has no channel to receive it
  // — those were stripped as exporter bookkeeping. So the alignment is applied
  // here instead, on the bone below the holder.
  //
  // Measured, not chosen: with the retarget alone the head sat 0.205 m below
  // the feet; z+90 put it 1.414 m below with a vertical span, i.e. upside
  // down; z-90 gives head 1.404 m ABOVE feet, span 0.244, both hands 0.55 m
  // below the head and 0.225 m apart. Standing, arms down.
  const alignBone = arg('--align-bone', 'root_01')
  const alignAxis = arg('--align-axis', 'z')
  const alignDegrees = Number(arg('--align-degrees', '-90'))

  const source = parseGlb(readFileSync(sourcePath))
  const target = parseGlb(readFileSync(targetPath))
  const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'))

  console.log(`retarget: ${sourcePath} -> ${targetPath}`)
  const result = retargetClips({ source, target, mapping, log: (m) => console.log(m) })

  if (result.unmatched.length) {
    console.warn(`  ${result.unmatched.length} mapping pair(s) matched no node:`)
    for (const u of result.unmatched.slice(0, 8)) console.warn(`    ${u}`)
  }
  console.log(`  ${result.pairs} bone pairs resolved`)
  for (const s of result.summary) {
    if (s.skipped) console.warn(`  SKIP ${s.clip}: ${s.skipped}`)
  }

  if (dryRun) {
    console.log('  --dry-run: nothing written')
    return
  }
  let bin = result.bin
  if (alignDegrees !== 0) {
    const report = correctBoneRotation(
      target.json,
      bin,
      alignBone,
      axisQuaternion(alignAxis, alignDegrees),
    )
    console.log(
      `  aligned ${alignBone} by ${alignDegrees} deg about ${alignAxis} — ` +
        `${report.keys} key(s) across ${report.clips} clip(s)`,
    )
  }
  writeFileSync(out, writeGlb(target.json, bin))
  console.log(`ok   ${out}`)
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2))
}
