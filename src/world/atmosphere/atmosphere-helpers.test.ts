/**
 * The small deterministic pieces around the atmosphere: when the environment
 * re-bakes, how the shadow map snaps, where lamp pools go, and the grade.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  altitudeBand,
  environmentNeedsBake,
  skylineScaleForBand,
  type EnvironmentKey,
} from './environment'
import { halfExtentForAltitude, shadowPresetFor, snapToShadowTexels } from './sun-shadow'
import { lampHeadLocal } from './light-pools'
import { gradeFor } from './grade'
import { atmosphereAt, sunDirection } from './model'

const key = (over: Partial<EnvironmentKey> = {}): EnvironmentKey => ({
  sunX: 0,
  sunY: 1,
  sunZ: 0,
  cover: 0.3,
  rain: 0,
  night: 0,
  altitudeBand: 0,
  ...over,
})

describe('environmentNeedsBake', () => {
  it('always bakes the first time', () => {
    expect(environmentNeedsBake(null, key(), 0)).toBe(true)
  })

  it('is throttled even when the sky moved', () => {
    const moved = key({ sunX: 0.2, sunY: 0.98 })
    expect(environmentNeedsBake(key(), moved, 0.2)).toBe(false)
    expect(environmentNeedsBake(key(), moved, 2)).toBe(true)
  })

  it('does not re-bake a sky that has not visibly changed', () => {
    const d = sunDirection(12)
    const e = sunDirection(12.02)
    const a = key({ sunX: d.x, sunY: d.y, sunZ: d.z })
    const b = key({ sunX: e.x, sunY: e.y, sunZ: e.z })
    expect(environmentNeedsBake(a, b, 5)).toBe(false)
  })

  it('re-bakes for a degree of sun, weather, night or altitude change', () => {
    const d = sunDirection(12)
    const e = sunDirection(12.2)
    expect(environmentNeedsBake(key({ sunX: d.x, sunY: d.y, sunZ: d.z }), key({ sunX: e.x, sunY: e.y, sunZ: e.z }), 5)).toBe(true)
    expect(environmentNeedsBake(key(), key({ cover: 0.5 }), 5)).toBe(true)
    expect(environmentNeedsBake(key(), key({ rain: 0.2 }), 5)).toBe(true)
    expect(environmentNeedsBake(key(), key({ night: 0.2 }), 5)).toBe(true)
    expect(environmentNeedsBake(key(), key({ altitudeBand: 2 }), 5)).toBe(true)
  })

  it('refreshes eventually even when nothing changed', () => {
    expect(environmentNeedsBake(key(), key(), 31)).toBe(true)
  })
})

describe('altitude bands', () => {
  it('shrink the skyline ring as the camera climbs', () => {
    expect(altitudeBand(14, 12.4)).toBe(0)
    expect(altitudeBand(100, 12.4)).toBe(1)
    expect(altitudeBand(332, 12.4)).toBe(3)
    expect(skylineScaleForBand(0)).toBeGreaterThan(skylineScaleForBand(3))
  })
})

describe('shadow presets', () => {
  it('casts no shadows on low', () => {
    expect(shadowPresetFor('low')).toBeNull()
    expect(shadowPresetFor('medium')).not.toBeNull()
    expect(shadowPresetFor('high')!.mapSize).toBeGreaterThan(shadowPresetFor('medium')!.mapSize)
  })

  it('reaches further from the air in a few coarse steps', () => {
    expect(halfExtentForAltitude(200, 2)).toBe(200)
    expect(halfExtentForAltitude(200, 50)).toBe(200)
    expect(halfExtentForAltitude(200, 320)).toBeGreaterThan(400)
    // stepped, so the texel size is constant while walking
    expect(halfExtentForAltitude(200, 70)).toBe(halfExtentForAltitude(200, 150))
  })
})

describe('snapToShadowTexels', () => {
  const toLight = new THREE.Vector3(-0.8, 0.45, 0.4).normalize()
  const texel = 0.25

  it('moves a point by less than a texel', () => {
    const p = new THREE.Vector3(1003.37, 12.4, -2871.91)
    const out = snapToShadowTexels(p, toLight, texel, new THREE.Vector3())
    expect(out.distanceTo(p)).toBeLessThan(texel)
  })

  it('maps nearby points onto one grid, so the map slides by whole texels', () => {
    const basis = new THREE.Matrix4().lookAt(toLight, new THREE.Vector3(), new THREE.Vector3(0, 1, 0))
    const inv = basis.clone().invert()
    for (const x of [0, 0.1, 7.33, -120.9]) {
      const out = snapToShadowTexels(new THREE.Vector3(x, 12.4, x * 0.7), toLight, texel, new THREE.Vector3())
      const local = out.applyMatrix4(inv)
      expect(Math.abs(local.x / texel - Math.round(local.x / texel))).toBeLessThan(1e-6)
      expect(Math.abs(local.y / texel - Math.round(local.y / texel))).toBeLessThan(1e-6)
    }
  })
})

describe('lampHeadLocal', () => {
  it('hangs the head under the arm tip and the pool below it', () => {
    const box = new THREE.Box3(new THREE.Vector3(-0.15, 0, -0.15), new THREE.Vector3(3.11, 8.94, 0.15))
    const { head, pool } = lampHeadLocal(box)
    expect(head.x).toBeGreaterThan(2.5)
    expect(head.y).toBeGreaterThan(8)
    expect(pool.x).toBeCloseTo(head.x, 9)
    expect(pool.y).toBe(0)
  })

  it('survives an empty box', () => {
    const { head } = lampHeadLocal(new THREE.Box3())
    expect(Number.isFinite(head.x) && Number.isFinite(head.y)).toBe(true)
  })
})

describe('gradeFor', () => {
  it('stays in a sane range over the whole day and weather', () => {
    for (let h = 0; h < 24; h += 0.5) {
      for (const rain of [0, 1]) {
        const g = gradeFor(atmosphereAt({ hour: h, cover: 0.4, rain }))
        expect(g.contrast).toBeGreaterThan(0.9)
        expect(g.contrast).toBeLessThan(1.25)
        expect(g.saturation).toBeGreaterThan(0.7)
        expect(g.saturation).toBeLessThan(1.3)
        expect(g.grain).toBeLessThan(0.05)
        for (const v of [...g.lift, ...g.shadowTint, ...g.highlightTint]) expect(Math.abs(v)).toBeLessThan(0.08)
        for (const v of [...g.gamma, ...g.gain]) expect(Math.abs(v - 1)).toBeLessThan(0.15)
      }
    }
  })

  it('splits teal shadows from orange highlights', () => {
    const g = gradeFor(atmosphereAt({ hour: 17.5, cover: 0.3, rain: 0 }))
    expect(g.shadowTint[2]).toBeGreaterThan(g.shadowTint[0])
    expect(g.highlightTint[0]).toBeGreaterThan(g.highlightTint[2])
  })

  it('desaturates in the rain', () => {
    const dry = gradeFor(atmosphereAt({ hour: 14, cover: 0.3, rain: 0 }))
    const wet = gradeFor(atmosphereAt({ hour: 14, cover: 0.95, rain: 1 }))
    expect(wet.saturation).toBeLessThan(dry.saturation)
  })
})
