import { describe, expect, it } from 'vitest'

import {
  quatMultiply,
  quatInverse,
  quatNormalize,
  quatAngle,
  quatNlerp,
  sampleRotation,
  restWorldRotations,
  topoOrder,
  retargetFrame,
} from './retarget-math.mjs'

/** Quaternion for `deg` about a principal axis. */
function axis(a, deg) {
  const h = ((deg * Math.PI) / 180) / 2
  const s = Math.sin(h)
  const w = Math.cos(h)
  return a === 'x' ? [s, 0, 0, w] : a === 'y' ? [0, s, 0, w] : [0, 0, s, w]
}
const deg = (rad) => (rad * 180) / Math.PI
const IDENTITY = [0, 0, 0, 1]

describe('quaternion primitives', () => {
  it('multiplies in the same order three does', () => {
    // 90 about x then 90 about y, composed left-to-right as parent * child.
    const q = quatMultiply(axis('x', 90), axis('y', 90))
    expect(quatAngle(q, IDENTITY)).toBeGreaterThan(0)
    // Composing with the inverse returns identity.
    expect(deg(quatAngle(quatMultiply(q, quatInverse(q)), IDENTITY))).toBeCloseTo(0, 6)
  })

  it('inverts a non-unit quaternion correctly', () => {
    const scaled = axis('z', 40).map((v) => v * 3)
    const back = quatMultiply(scaled, quatInverse(scaled))
    expect(deg(quatAngle(back, IDENTITY))).toBeCloseTo(0, 6)
  })

  it('measures the shortest arc, ignoring the double cover', () => {
    const q = axis('y', 90)
    const negated = q.map((v) => -v)
    // q and -q are the same orientation.
    expect(deg(quatAngle(q, negated))).toBeCloseTo(0, 6)
    expect(deg(quatAngle(IDENTITY, q))).toBeCloseTo(90, 4)
  })

  it('normalises garbage to identity rather than propagating NaN', () => {
    expect(quatNormalize([0, 0, 0, 0])).toEqual(IDENTITY)
    expect(quatNormalize([Number.NaN, 0, 0, 1])).toEqual(IDENTITY)
    expect(quatInverse([0, 0, 0, 0])).toEqual(IDENTITY)
  })
})

describe('quatNlerp', () => {
  it('lands on the endpoints', () => {
    const a = axis('y', 0)
    const b = axis('y', 90)
    expect(deg(quatAngle(quatNlerp(a, b, 0), a))).toBeCloseTo(0, 6)
    expect(deg(quatAngle(quatNlerp(a, b, 1), b))).toBeCloseTo(0, 6)
  })

  it('takes the shortest arc when the endpoints are opposite-signed', () => {
    const a = axis('y', 10)
    const b = axis('y', 20).map((v) => -v)
    // Naive lerp would swing the long way round through ~340 degrees.
    const mid = quatNlerp(a, b, 0.5)
    expect(deg(quatAngle(a, mid))).toBeLessThan(10)
  })
})

describe('sampleRotation', () => {
  const times = [0, 1, 2]
  const values = [axis('y', 0), axis('y', 90), axis('y', 180)]

  it('returns keys exactly at key times', () => {
    expect(deg(quatAngle(sampleRotation(times, values, 1), values[1]))).toBeCloseTo(0, 6)
  })

  it('interpolates between keys', () => {
    const half = sampleRotation(times, values, 0.5)
    expect(deg(quatAngle(values[0], half))).toBeGreaterThan(30)
    expect(deg(quatAngle(values[0], half))).toBeLessThan(60)
  })

  it('clamps outside the range instead of extrapolating', () => {
    expect(deg(quatAngle(sampleRotation(times, values, -5), values[0]))).toBeCloseTo(0, 6)
    expect(deg(quatAngle(sampleRotation(times, values, 99), values[2]))).toBeCloseTo(0, 6)
  })

  it('survives an empty or single-key track', () => {
    expect(sampleRotation([], [], 0.5)).toEqual(IDENTITY)
    expect(sampleRotation([3], [axis('x', 45)], 0)).toEqual(axis('x', 45))
  })
})

describe('restWorldRotations and topoOrder', () => {
  // root -> a -> b, each rotated 30 degrees about z.
  const nodes = [
    { name: 'root', parent: -1, rotation: axis('z', 30) },
    { name: 'a', parent: 0, rotation: axis('z', 30) },
    { name: 'b', parent: 1, rotation: axis('z', 30) },
  ]

  it('accumulates down the chain', () => {
    const world = restWorldRotations(nodes)
    expect(deg(quatAngle(IDENTITY, world[0]))).toBeCloseTo(30, 4)
    expect(deg(quatAngle(IDENTITY, world[1]))).toBeCloseTo(60, 4)
    expect(deg(quatAngle(IDENTITY, world[2]))).toBeCloseTo(90, 4)
  })

  it('accumulates correctly when a child precedes its parent in the array', () => {
    // glTF does not guarantee parent-first ordering and the real player rig
    // does not oblige. Iterating by index threw "a is not iterable" on the
    // first run against it, because world[parent] was still undefined.
    const shuffled = [
      { name: 'b', parent: 1, rotation: axis('z', 30) },
      { name: 'a', parent: 2, rotation: axis('z', 30) },
      { name: 'root', parent: -1, rotation: axis('z', 30) },
    ]
    const world = restWorldRotations(shuffled)
    expect(world.every(Boolean)).toBe(true)
    expect(deg(quatAngle(IDENTITY, world[2]))).toBeCloseTo(30, 4)
    expect(deg(quatAngle(IDENTITY, world[1]))).toBeCloseTo(60, 4)
    expect(deg(quatAngle(IDENTITY, world[0]))).toBeCloseTo(90, 4)
  })

  it('orders parents before children even when the array does not', () => {
    const shuffled = [
      { name: 'b', parent: 2, rotation: IDENTITY },
      { name: 'a', parent: 2, rotation: IDENTITY },
      { name: 'root', parent: -1, rotation: IDENTITY },
    ]
    const order = topoOrder(shuffled)
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(1))
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(0))
    expect(order).toHaveLength(3)
  })
})

describe('retargetFrame', () => {
  /** Two rigs, same topology, deliberately different rest orientations. */
  function rigs() {
    const src = [
      { name: 'root', parent: -1, rotation: IDENTITY },
      { name: 'arm', parent: 0, rotation: axis('z', 90) }, // points one way
    ]
    const tgt = [
      { name: 'root', parent: -1, rotation: IDENTITY },
      { name: 'arm', parent: 0, rotation: axis('x', 45) }, // points another
    ]
    return {
      src,
      tgt,
      srcRestWorld: restWorldRotations(src),
      tgtRestWorld: restWorldRotations(tgt),
      pairs: [
        { source: 0, target: 0 },
        { source: 1, target: 1 },
      ],
    }
  }

  it('a source at rest leaves the target at rest', () => {
    // The property the old bake violated most obviously: copying absolute
    // orientation moved the target even when the source had not moved at all.
    const { src, tgt, srcRestWorld, tgtRestWorld, pairs } = rigs()
    const local = retargetFrame({
      srcWorld: srcRestWorld,
      srcRestWorld,
      tgtNodes: tgt,
      tgtRestWorld,
      pairs,
    })
    expect(deg(quatAngle(local.get(1), tgt[1].rotation))).toBeCloseTo(0, 6)
    expect(deg(quatAngle(local.get(0), src[0].rotation))).toBeCloseTo(0, 6)
  })

  it('transfers the source delta, not the source orientation', () => {
    // Source arm swings 40 degrees about y from ITS rest. The target arm must
    // swing 40 degrees about y from ITS OWN rest — which is a different
    // absolute orientation, and that is the whole point.
    const { tgt, srcRestWorld, tgtRestWorld, pairs } = rigs()
    const swing = axis('y', 40)
    const srcWorld = [srcRestWorld[0], quatMultiply(swing, srcRestWorld[1])]

    const local = retargetFrame({
      srcWorld,
      srcRestWorld,
      tgtNodes: tgt,
      tgtRestWorld,
      pairs,
    })
    const movedWorld = quatMultiply(local.get(0), local.get(1))
    expect(deg(quatAngle(tgtRestWorld[1], movedWorld))).toBeCloseTo(40, 3)
  })

  it('keeps unmapped bones at their rest local', () => {
    const src = [{ name: 'root', parent: -1, rotation: IDENTITY }]
    const tgt = [
      { name: 'root', parent: -1, rotation: IDENTITY },
      { name: 'orphan', parent: 0, rotation: axis('x', 20) },
    ]
    const local = retargetFrame({
      srcWorld: restWorldRotations(src),
      srcRestWorld: restWorldRotations(src),
      tgtNodes: tgt,
      tgtRestWorld: restWorldRotations(tgt),
      pairs: [{ source: 0, target: 0 }],
    })
    expect(local.has(1)).toBe(false)
  })

  it('solves parents before children, so a child inherits the moved parent', () => {
    // If the child were solved against its parent's REST frame instead of its
    // retargeted frame, the parent's motion would be applied twice.
    const src = [
      { name: 'root', parent: -1, rotation: IDENTITY },
      { name: 'a', parent: 0, rotation: IDENTITY },
      { name: 'b', parent: 1, rotation: IDENTITY },
    ]
    const tgt = src.map((n) => ({ ...n }))
    const srcRestWorld = restWorldRotations(src)
    const tgtRestWorld = restWorldRotations(tgt)
    // Rotate only the middle bone in world space; the tip follows it rigidly.
    const turn = axis('z', 30)
    const srcWorld = [srcRestWorld[0], quatMultiply(turn, srcRestWorld[1]), quatMultiply(turn, srcRestWorld[2])]

    const local = retargetFrame({
      srcWorld,
      srcRestWorld,
      tgtNodes: tgt,
      tgtRestWorld,
      pairs: [
        { source: 0, target: 0 },
        { source: 1, target: 1 },
        { source: 2, target: 2 },
      ],
    })
    // The tip's LOCAL rotation must be identity — it did not move relative to
    // its parent. Double-applying the parent's turn would show 30 degrees.
    expect(deg(quatAngle(local.get(2), IDENTITY))).toBeCloseTo(0, 4)
    expect(deg(quatAngle(local.get(1), turn))).toBeCloseTo(0, 4)
  })
})
