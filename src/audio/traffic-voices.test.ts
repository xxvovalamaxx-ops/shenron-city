import { describe, expect, it } from 'vitest'
import { assignTrafficVoices, kindPitch, trafficRpm, TRAFFIC_HEARING_RADIUS, type TrafficSoundSource } from './traffic-voices'
import type { ListenerPose } from './mix'

const listener: ListenerPose = { pos: { x: 0, y: 0, z: 0 }, forward: { x: 0, z: -1 } }

function car(key: string, x: number, z: number, extra: Partial<TrafficSoundSource> = {}): TrafficSoundSource {
  return { key, x, y: 0, z, speed: 8, kind: 'sedan', siren: false, ...extra }
}

describe('trafficRpm', () => {
  it('idles when stopped and stays in 0..1', () => {
    expect(trafficRpm(0)).toBeLessThan(0.1)
    for (let s = 0; s < 60; s += 0.7) {
      const r = trafficRpm(s)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(1)
    }
  })

  it('drops at a gear change', () => {
    expect(trafficRpm(6.4)).toBeGreaterThan(trafficRpm(6.6))
  })
})

describe('kindPitch', () => {
  it('makes heavy vehicles lower and police higher', () => {
    expect(kindPitch('van')).toBeLessThan(1)
    expect(kindPitch('police')).toBeGreaterThan(1)
    expect(kindPitch('sedan')).toBe(1)
  })
})

describe('assignTrafficVoices', () => {
  it('gives the voices to the nearest cars and ignores far ones', () => {
    const cars = [car('a', 0, 40), car('b', 0, 5), car('c', 3, 0), car('d', 0, TRAFFIC_HEARING_RADIUS + 5), car('e', 10, 0), car('f', 20, 0)]
    const out = assignTrafficVoices(cars, listener, [null, null, null, null])
    const keys = out.map((v) => v.key).sort()
    expect(keys).toEqual(['b', 'c', 'e', 'f'])
  })

  it('keeps a car on the same voice while it stays near', () => {
    const first = assignTrafficVoices([car('a', 2, 0), car('b', 4, 0)], listener, [null, null, null, null])
    const prev = first.map((v) => v.key)
    const second = assignTrafficVoices([car('z', 1, 0), car('b', 4, 0), car('a', 2, 0)], listener, prev)
    expect(second[prev.indexOf('a')].key).toBe('a')
    expect(second[prev.indexOf('b')].key).toBe('b')
    expect(second.map((v) => v.key)).toContain('z')
  })

  it('is silent with no cars nearby', () => {
    const out = assignTrafficVoices([], listener, ['x', null, null, null])
    expect(out.every((v) => v.key === null && v.gain === 0)).toBe(true)
  })

  it('pans a car on the right to the right', () => {
    const [v] = assignTrafficVoices([car('r', 10, 0)], listener, [null], 1)
    expect(v.pan).toBeGreaterThan(0.5)
    expect(v.gain).toBeGreaterThan(0)
  })

  it('prefers a siren over a slightly closer quiet car', () => {
    const out = assignTrafficVoices([car('quiet', 0, 10), car('cop', 0, 15, { siren: true, kind: 'police' })], listener, [null], 1)
    expect(out[0].key).toBe('cop')
    expect(out[0].siren).toBe(true)
  })
})
