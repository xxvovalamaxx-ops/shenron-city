/**
 * Forward kinematics for a glTF skeleton, so a clip can be checked without a
 * renderer.
 *
 * Written because "the character looks right" was, for three separate rounds
 * of this bug, a claim nobody could check without opening a browser and
 * squinting — and two of the instruments used to check it (a Box3 over a
 * SkinnedMesh, a luma readout of a WebGL canvas) turned out to measure
 * something else entirely. Bone world positions are unambiguous: a standing
 * human has their head above their feet, and no amount of shader or camera
 * trouble changes that number.
 *
 * Rotation-only FK would not do. Limb *positions* need the translations too,
 * and the whole question is where the hands and feet end up.
 */

const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Column-major 4x4 multiply, matching glTF and three's layout. */
export function mat4Multiply(a, b) {
  const out = new Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3]
    }
  }
  return out
}

/** Compose translation, rotation (x,y,z,w) and scale into a 4x4. */
export function composeTRS(t, q, s) {
  const [x, y, z, w] = q
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  const [sx, sy, sz] = s
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ]
}

export function translationOf(m) {
  return { x: m[12], y: m[13], z: m[14] }
}

/** Nearest-neighbour-with-lerp sampling of a vector track. */
function sampleVec(times, values, time, fallback) {
  const n = times.length
  if (n === 0) return fallback
  if (n === 1 || time <= times[0]) return values[0]
  if (time >= times[n - 1]) return values[n - 1]
  let i = 1
  while (i < n - 1 && times[i] < time) i++
  const span = times[i] - times[i - 1]
  const t = span <= 0 ? 0 : (time - times[i - 1]) / span
  return values[i - 1].map((v, k) => v + (values[i][k] - v) * t)
}

function sampleQuat(times, values, time, fallback) {
  const n = times.length
  if (n === 0) return fallback
  if (n === 1 || time <= times[0]) return values[0]
  if (time >= times[n - 1]) return values[n - 1]
  let i = 1
  while (i < n - 1 && times[i] < time) i++
  const span = times[i] - times[i - 1]
  const t = span <= 0 ? 0 : (time - times[i - 1]) / span
  const a = values[i - 1]
  const b = values[i]
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const sign = dot < 0 ? -1 : 1
  const q = a.map((v, k) => v + (b[k] * sign - v) * t)
  const len = Math.hypot(...q) || 1
  return q.map((v) => v / len)
}

function readAccessor(json, bin, index) {
  const a = json.accessors[index]
  const view = json.bufferViews[a.bufferView]
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]
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

/**
 * World positions of every named node, posed by `clipName` at `time`.
 *
 * Nodes with no channel keep their rest transform, which is what a player
 * would see: an unmapped bone does not vanish, it simply does not move.
 */
export function poseAt(json, bin, clipName, time) {
  const nodes = json.nodes ?? []
  const parent = new Array(nodes.length).fill(-1)
  nodes.forEach((n, i) => {
    for (const c of n.children ?? []) parent[c] = i
  })

  const animation = (json.animations ?? []).find((a) => a.name === clipName)
  const tracks = new Map()
  for (const channel of animation?.channels ?? []) {
    const sampler = animation.samplers[channel.sampler]
    const key = `${channel.target.node}:${channel.target.path}`
    tracks.set(key, {
      times: readAccessor(json, bin, sampler.input),
      values: readAccessor(json, bin, sampler.output),
    })
  }

  const order = []
  const seen = new Set()
  const visit = (i) => {
    if (seen.has(i)) return
    if (parent[i] >= 0) visit(parent[i])
    seen.add(i)
    order.push(i)
  }
  for (let i = 0; i < nodes.length; i++) visit(i)

  const world = new Array(nodes.length)
  for (const i of order) {
    const n = nodes[i]
    const tr = tracks.get(`${i}:translation`)
    const rot = tracks.get(`${i}:rotation`)
    const sc = tracks.get(`${i}:scale`)
    const t = tr ? sampleVec(tr.times, tr.values, time, n.translation) : n.translation ?? [0, 0, 0]
    const q = rot ? sampleQuat(rot.times, rot.values, time, n.rotation) : n.rotation ?? [0, 0, 0, 1]
    const s = sc ? sampleVec(sc.times, sc.values, time, n.scale) : n.scale ?? [1, 1, 1]
    const local = composeTRS(t, q, s)
    world[i] = parent[i] >= 0 ? mat4Multiply(world[parent[i]], local) : local
  }

  const out = new Map()
  nodes.forEach((n, i) => {
    if (n.name) out.set(n.name, translationOf(world[i]))
  })
  return out
}

/** Duration of a clip, from the largest input time across its samplers. */
export function clipDuration(json, bin, clipName) {
  const animation = (json.animations ?? []).find((a) => a.name === clipName)
  if (!animation) return 0
  let max = 0
  for (const sampler of animation.samplers) {
    const times = readAccessor(json, bin, sampler.input)
    if (times.length) max = Math.max(max, times[times.length - 1])
  }
  return max
}

export { IDENTITY4 }
