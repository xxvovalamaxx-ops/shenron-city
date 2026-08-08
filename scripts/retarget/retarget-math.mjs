/**
 * The arithmetic of retargeting one skeleton's motion onto another.
 *
 * Kept separate from any file handling so every claim below is a unit test.
 *
 * The rule the previous attempt got wrong: you do not copy a source bone's
 * orientation onto the target. Two humanoid rigs almost never share a rest
 * orientation — Quaternius's `upperarm_l` and Sketchfab's `upperarm_l_024`
 * point different ways in their bind poses — so copying absolute orientation
 * puts the target limb where the *source's bone axis* is, not where the motion
 * should be. Measured on the clips that produced: a median deviation of 78.8
 * degrees from rest across 88 bones on an idle frame, worst 179.
 *
 * What transfers is the *delta from rest*, in world space:
 *
 *     delta        = srcWorld(frame) * inverse(srcRestWorld)
 *     tgtWorld     = delta * tgtRestWorld
 *     tgtLocal     = inverse(tgtParentWorld(frame)) * tgtWorld
 *
 * Parents must be solved before children, because `tgtParentWorld` is the
 * result of the parent's own retarget, not its rest.
 *
 * Quaternions are [x, y, z, w], matching glTF's accessor layout and three's
 * in-memory order, so nothing has to be reordered on the way in or out.
 */

export function quatMultiply(a, b) {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

/** Conjugate over the squared norm — correct for non-unit input too. */
export function quatInverse(q) {
  const [x, y, z, w] = q
  const n = x * x + y * y + z * z + w * w
  if (n === 0) return [0, 0, 0, 1]
  return [-x / n, -y / n, -z / n, w / n]
}

export function quatNormalize(q) {
  const [x, y, z, w] = q
  const len = Math.hypot(x, y, z, w)
  if (!Number.isFinite(len) || len === 0) return [0, 0, 0, 1]
  return [x / len, y / len, z / len, w / len]
}

/** Shortest-arc angle between two orientations, in radians. */
export function quatAngle(a, b) {
  const d = quatMultiply(quatInverse(a), b)
  return 2 * Math.acos(Math.max(-1, Math.min(1, Math.abs(quatNormalize(d)[3]))))
}

/**
 * Normalised linear interpolation, taking the shortest arc.
 *
 * nlerp rather than slerp: the source keys are dense (17-61 per clip for a
 * one-second loop) so the arc between neighbours is small, and nlerp has no
 * branch for near-parallel inputs to get wrong.
 */
export function quatNlerp(a, b, t) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const s = dot < 0 ? -1 : 1
  return quatNormalize([
    a[0] + (b[0] * s - a[0]) * t,
    a[1] + (b[1] * s - a[1]) * t,
    a[2] + (b[2] * s - a[2]) * t,
    a[3] + (b[3] * s - a[3]) * t,
  ])
}

/** Sample a keyframed rotation track at an arbitrary time. */
export function sampleRotation(times, values, time) {
  const n = times.length
  if (n === 0) return [0, 0, 0, 1]
  if (n === 1 || time <= times[0]) return values[0]
  if (time >= times[n - 1]) return values[n - 1]
  let i = 1
  while (i < n - 1 && times[i] < time) i++
  const span = times[i] - times[i - 1]
  const t = span <= 0 ? 0 : (time - times[i - 1]) / span
  return quatNlerp(values[i - 1], values[i], t)
}

/**
 * World rotations of every node in a rest pose.
 *
 * `nodes` is `[{ name, parent, rotation }]` with `parent` an index or -1.
 *
 * Walks in {@link topoOrder} rather than array order. glTF does not guarantee
 * that a parent appears before its children, and the real player rig does not
 * oblige: iterating by index threw `a is not iterable` on the first run,
 * because `world[parent]` was still undefined when the child was reached.
 */
export function restWorldRotations(nodes) {
  const world = new Array(nodes.length)
  for (const i of topoOrder(nodes)) {
    const local = nodes[i].rotation ?? [0, 0, 0, 1]
    const p = nodes[i].parent
    world[i] = p >= 0 ? quatMultiply(world[p], local) : local
  }
  return world
}

/** Indices ordered so a parent always precedes its children. */
export function topoOrder(nodes) {
  const out = []
  const emitted = new Set()
  const visit = (i) => {
    if (emitted.has(i)) return
    const p = nodes[i].parent
    if (p >= 0) visit(p)
    emitted.add(i)
    out.push(i)
  }
  for (let i = 0; i < nodes.length; i++) visit(i)
  return out
}

/**
 * Retarget one frame.
 *
 * `srcWorld` and `tgtRestWorld` are world rotations by node index; `pairs` is
 * `[{ source, target }]` of indices, and `tgtNodes` supplies the target
 * hierarchy. Returns local rotations for every mapped target bone, keyed by
 * target index.
 *
 * Unmapped target bones keep their rest local rotation, which is why the
 * running world pose has to be tracked for every node rather than only the
 * mapped ones — an unmapped bone between two mapped ones still moves its
 * child's parent frame.
 */
export function retargetFrame({ srcWorld, srcRestWorld, tgtNodes, tgtRestWorld, pairs }) {
  const targetOf = new Map(pairs.map((p) => [p.target, p.source]))
  const world = new Array(tgtNodes.length)
  const local = new Map()

  for (const i of topoOrder(tgtNodes)) {
    const parent = tgtNodes[i].parent
    const parentWorld = parent >= 0 ? world[parent] : [0, 0, 0, 1]
    const src = targetOf.get(i)

    if (src === undefined) {
      // Not mapped: keep the rest local, so the chain stays intact.
      const rest = tgtNodes[i].rotation ?? [0, 0, 0, 1]
      world[i] = quatMultiply(parentWorld, rest)
      continue
    }

    const delta = quatMultiply(srcWorld[src], quatInverse(srcRestWorld[src]))
    const wanted = quatNormalize(quatMultiply(delta, tgtRestWorld[i]))
    const l = quatNormalize(quatMultiply(quatInverse(parentWorld), wanted))
    local.set(i, l)
    world[i] = wanted
  }

  return local
}
