import { describe, expect, it } from 'vitest'
import { NO_PHOTO_INPUT, PHOTO_FOV_MAX, PHOTO_FOV_MIN, PHOTO_LEASH, photoForward, startPhotoCamera, stepPhotoCamera } from './photo-mode'

const start = () => startPhotoCamera({ x: 10, y: 14, z: 20 }, 0, 0, 60)

describe('photo mode camera', () => {
  it('looks down -Z at yaw 0 and flies where it looks', () => {
    expect(photoForward(0, 0).z).toBeCloseTo(-1)
    let s = start()
    for (let i = 0; i < 10; i++) s = stepPhotoCamera(s, { ...NO_PHOTO_INPUT, forward: true }, 0.1, 12)
    expect(s.pos.z).toBeCloseTo(16, 5)
    expect(s.pos.x).toBeCloseTo(10, 5)
  })

  it('strafes right along +X at yaw 0', () => {
    const s = stepPhotoCamera(start(), { ...NO_PHOTO_INPUT, right: true }, 1, 12)
    expect(s.pos.x).toBeGreaterThan(10)
  })

  it('stays on its leash and above the ground', () => {
    let s = start()
    for (let i = 0; i < 400; i++) s = stepPhotoCamera(s, { ...NO_PHOTO_INPUT, forward: true, fast: true }, 0.1, 12)
    expect(Math.hypot(s.pos.x - 10, s.pos.y - 14, s.pos.z - 20)).toBeLessThanOrEqual(PHOTO_LEASH + 1e-6)
    for (let i = 0; i < 100; i++) s = stepPhotoCamera(s, { ...NO_PHOTO_INPUT, down: true, fast: true }, 0.1, 12)
    expect(s.pos.y).toBeGreaterThanOrEqual(12.25 - 1e-9)
  })

  it('zooms within its lens range and rolls within limits', () => {
    let s = start()
    for (let i = 0; i < 60; i++) s = stepPhotoCamera(s, { ...NO_PHOTO_INPUT, zoom: 1, rollDir: 1 }, 0.1, null)
    expect(s.fov).toBe(PHOTO_FOV_MIN)
    expect(s.roll).toBe(45)
    for (let i = 0; i < 60; i++) s = stepPhotoCamera(s, { ...NO_PHOTO_INPUT, zoom: -1 }, 0.1, null)
    expect(s.fov).toBe(PHOTO_FOV_MAX)
  })
})
