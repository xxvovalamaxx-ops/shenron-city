import { describe, expect, it } from 'vitest'
import {
  STEP_HEIGHT,
  aabb,
  collidesAt,
  groundHeight,
  moveWithCollisions,
  type AABB,
} from './collision'

const FLOOR: AABB = aabb(0, -0.5, 0, 100, 1, 100)
const dt = 1 / 60

describe('collision primitives', () => {
  it('detects standing inside a wall', () => {
    const wall = aabb(0, 2, 0, 6, 4, 0.5)
    expect(collidesAt({ x: 0, y: 0, z: 0 }, [wall])).toBe(true)
    expect(collidesAt({ x: 10, y: 0, z: 0 }, [wall])).toBe(false)
  })

  it('ignores a wall the player is standing above', () => {
    const lowBlock = aabb(0, 0.25, 0, 4, 0.5, 4)
    expect(collidesAt({ x: 0, y: 0.6, z: 0 }, [lowBlock])).toBe(false)
  })

  it('reports the floor as ground', () => {
    expect(groundHeight({ x: 0, y: 0.1, z: 0 }, [FLOOR])).toBeCloseTo(0, 5)
  })
})

describe('movement', () => {
  it('walks freely across open floor', () => {
    const r = moveWithCollisions({ x: 0, y: 0, z: 0 }, { x: 0.1, z: 0 }, 0, dt, [FLOOR])
    expect(r.position.x).toBeCloseTo(0.1, 5)
    expect(r.grounded).toBe(true)
  })

  it('is stopped by a wall instead of passing through it', () => {
    const wall = aabb(1, 2, 0, 0.5, 4, 10)
    const r = moveWithCollisions({ x: 0, y: 0, z: 0 }, { x: 5, z: 0 }, 0, dt, [FLOOR, wall])
    expect(r.position.x).toBeLessThan(1)
  })

  it('does not tunnel through the thinnest collider in the world', () => {
    // Regression: resolving only the destination let a single large delta —
    // produced by any frame hitch — pass straight through a door leaf.
    const doorLeaf = aabb(1, 2, 0, 0.16, 4, 10)
    for (const delta of [0.3, 1, 5, 50]) {
      const r = moveWithCollisions({ x: 0, y: 0, z: 0 }, { x: delta, z: 0 }, 0, dt, [
        FLOOR,
        doorLeaf,
      ])
      expect(r.position.x).toBeLessThan(1)
    }
  })

  it('slides along a wall rather than sticking', () => {
    // Wall on +X. Moving diagonally into it should still make Z progress.
    const wall = aabb(1, 2, 0, 0.5, 4, 40)
    const r = moveWithCollisions({ x: 0, y: 0, z: 0 }, { x: 5, z: 0.2 }, 0, dt, [FLOOR, wall])
    expect(r.position.z).toBeCloseTo(0.2, 5)
  })

  it('steps up a low kerb', () => {
    const kerb = aabb(1.5, STEP_HEIGHT / 2, 0, 2, STEP_HEIGHT, 10)
    const r = moveWithCollisions({ x: 0, y: 0, z: 0 }, { x: 1.2, z: 0 }, 0, dt, [FLOOR, kerb])
    expect(r.position.x).toBeGreaterThan(0.5)
    expect(r.position.y).toBeGreaterThan(0.1)
  })

  it('will not step up a wall that is too tall', () => {
    const tall = aabb(1.5, 1.5, 0, 2, 3, 10)
    const r = moveWithCollisions({ x: 0, y: 0, z: 0 }, { x: 1.2, z: 0 }, 0, dt, [FLOOR, tall])
    expect(r.position.y).toBeLessThan(0.1)
    expect(r.position.x).toBeLessThan(0.6)
  })

  it('falls under gravity and settles on the floor', () => {
    let p = { x: 0, y: 8, z: 0 }
    let vy = 0
    for (let i = 0; i < 400; i++) {
      const r = moveWithCollisions(p, { x: 0, z: 0 }, vy, dt, [FLOOR])
      p = r.position
      vy = r.velocityY
    }
    expect(p.y).toBeCloseTo(0, 2)
    expect(vy).toBe(0)
  })

  it('cannot escape a sealed room from inside', () => {
    const room: AABB[] = [
      FLOOR,
      aabb(0, 2, 5, 12, 4, 0.5),
      aabb(0, 2, -5, 12, 4, 0.5),
      aabb(5, 2, 0, 0.5, 4, 12),
      aabb(-5, 2, 0, 0.5, 4, 12),
    ]
    let p = { x: 0, y: 0, z: 0 }
    let vy = 0
    // Shove hard in every direction for a while.
    const dirs = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
      { x: 0.8, z: 0.8 },
    ]
    for (let i = 0; i < 600; i++) {
      const d = dirs[i % dirs.length]
      const r = moveWithCollisions(p, { x: d.x * 0.5, z: d.z * 0.5 }, vy, dt, room)
      p = r.position
      vy = r.velocityY
      expect(Math.abs(p.x)).toBeLessThan(5)
      expect(Math.abs(p.z)).toBeLessThan(5)
    }
  })
})
