import { describe, expect, it } from 'vitest'
import {
  AUDIO_ANCHORS,
  BED_VOICES,
  MAX_DISTANCE,
  MIN_STEP_INTERVAL,
  MOTOR,
  ONE_SHOTS,
  REFERENCE_DISTANCE,
  STRIDE_LENGTH,
  ZONE_IDS,
  ZONE_ROOM,
  advanceFootsteps,
  blendRoom,
  dominantZone,
  footstepVoice,
  initialFootsteps,
  interiorAmount,
  masterGain,
  placeSource,
  zoneGains,
  zoneWeights,
  type FootstepState,
  type ZoneMix,
} from './mix'
import { ENTRANCE, HQ, SHAFT, SPAWN } from '../world/layout'
import { MARKET_KEEPER } from '../world/city-data'
import type { Vec3 } from '../gameplay/collision'

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

/** Standing on the ground; the beds are authored around head height, not feet. */
const GROUND_Y = 0.05

const FACING_NORTH = { pos: at(0, 0, 0), forward: { x: 0, z: -1 } }

function total(mix: ZoneMix): number {
  return ZONE_IDS.reduce((sum, id) => sum + mix[id], 0)
}

describe('ambience zones', () => {
  it('always describes the whole city, wherever the player stands', () => {
    const samples: Vec3[] = [
      at(SPAWN.x, SPAWN.y, SPAWN.z),
      at(MARKET_KEEPER.x, GROUND_Y, MARKET_KEEPER.z),
      at(-20, GROUND_Y, 49),
      at(0, GROUND_Y, -15),
      at(0, HQ.y, -15),
      at(0, 90, SHAFT.doorZ - SHAFT.carDepth / 2),
      at(500, 40, -500),
    ]
    for (const p of samples) expect(total(zoneWeights(p))).toBeCloseTo(1, 9)
  })

  it('picks the bed the player is actually standing in', () => {
    expect(dominantZone(zoneWeights(at(SPAWN.x, SPAWN.y, SPAWN.z)))).toBe('boulevard')
    expect(dominantZone(zoneWeights(at(MARKET_KEEPER.x, GROUND_Y, MARKET_KEEPER.z)))).toBe('market')
    expect(dominantZone(zoneWeights(at(-20, GROUND_Y, 49)))).toBe('park')
    expect(dominantZone(zoneWeights(at(0, GROUND_Y, -15)))).toBe('lobby')
    expect(dominantZone(zoneWeights(at(0, HQ.y, -15)))).toBe('hq')
  })

  it('keeps the street out of the interiors and vice versa', () => {
    // Floor 45 is 180 m up and sealed; hearing traffic there would be absurd.
    expect(zoneWeights(at(0, HQ.y, -15)).boulevard).toBeCloseTo(0, 6)
    expect(interiorAmount(zoneWeights(at(0, HQ.y, -15)))).toBeCloseTo(1, 6)
    expect(interiorAmount(zoneWeights(at(0, GROUND_Y, -15)))).toBeCloseTo(1, 6)
    // Out on the plaza, neither interior nor the market leaks.
    const plaza = zoneWeights(at(0, GROUND_Y, 12))
    expect(plaza.boulevard).toBeCloseTo(1, 6)
    expect(interiorAmount(plaza)).toBeCloseTo(0, 6)
  })

  it('holds an interior bed for the whole lift ride', () => {
    // The car sits behind the lobby's back wall, so without the shaft volume the
    // rider would hear open-street traffic somewhere around floor 30.
    const carZ = SHAFT.doorZ - SHAFT.carDepth / 2
    for (const y of [1, 20, 60, 120, 175]) {
      expect(interiorAmount(zoneWeights(at(0, y, carZ)))).toBeGreaterThan(0.95)
    }
  })

  it('crossfades rather than cutting, all the way along the playable route', () => {
    // Spawn, market, park, plaza, lobby, into the car, up the shaft, onto 45.
    const route: Vec3[] = [
      at(SPAWN.x, GROUND_Y, SPAWN.z),
      at(SPAWN.x, GROUND_Y, 100),
      at(MARKET_KEEPER.x, GROUND_Y, MARKET_KEEPER.z),
      at(10, GROUND_Y, 60),
      at(-20, GROUND_Y, 49),
      at(0, GROUND_Y, 20),
      at(0, GROUND_Y, -15),
      at(0, GROUND_Y, SHAFT.doorZ - SHAFT.carDepth / 2),
      at(0, HQ.y, SHAFT.doorZ - SHAFT.carDepth / 2),
      at(0, HQ.y, -15),
    ]

    const STEP = 0.05
    let previous = zoneWeights(route[0])
    let worst = 0

    for (let leg = 0; leg < route.length - 1; leg++) {
      const a = route[leg]
      const b = route[leg + 1]
      const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
      const steps = Math.ceil(length / STEP)
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const here = zoneWeights(
          at(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t),
        )
        for (const id of ZONE_IDS) worst = Math.max(worst, Math.abs(here[id] - previous[id]))
        previous = here
      }
    }

    // A hard cut would show up here as a jump towards 1 in a single 5 cm step.
    expect(worst).toBeLessThan(0.05)
  })

  it('crossfades at constant power so doorways do not dip', () => {
    for (const p of [
      at(0, GROUND_Y, ENTRANCE.z),
      at(0, GROUND_Y, ENTRANCE.z - 1),
      at(0, GROUND_Y, ENTRANCE.z + 2),
      at(MARKET_KEEPER.x, GROUND_Y, 70),
    ]) {
      const gains = zoneGains(zoneWeights(p))
      const power = ZONE_IDS.reduce((sum, id) => sum + gains[id] * gains[id], 0)
      expect(power).toBeCloseTo(1, 9)
    }
  })
})

describe('room character', () => {
  it('reproduces a zone when nothing else applies', () => {
    const pure: ZoneMix = { boulevard: 0, market: 0, park: 0, lobby: 1, hq: 0 }
    const room = blendRoom(pure)
    expect(room.reverbSend).toBeCloseTo(ZONE_ROOM.lobby.reverbSend, 9)
    // Cutoffs make a round trip through exp/log, so they land within a
    // billionth of a hertz rather than on the authored integer.
    expect(room.bedCutoffHz).toBeCloseTo(ZONE_ROOM.lobby.bedCutoffHz, 6)
    expect(room.wetCutoffHz).toBeCloseTo(ZONE_ROOM.lobby.wetCutoffHz, 6)
  })

  it('is total, so an empty mix cannot produce a silent filter', () => {
    const empty: ZoneMix = { boulevard: 0, market: 0, park: 0, lobby: 0, hq: 0 }
    expect(blendRoom(empty)).toEqual(ZONE_ROOM.boulevard)
  })

  it('blends cutoffs in the log domain', () => {
    const half: ZoneMix = { boulevard: 0.5, market: 0, park: 0, lobby: 0.5, hq: 0 }
    const room = blendRoom(half)
    const arithmetic = (ZONE_ROOM.boulevard.bedCutoffHz + ZONE_ROOM.lobby.bedCutoffHz) / 2

    expect(room.bedCutoffHz).toBeGreaterThan(ZONE_ROOM.lobby.bedCutoffHz)
    expect(room.bedCutoffHz).toBeLessThan(ZONE_ROOM.boulevard.bedCutoffHz)
    // Half way through the door should be half the octaves, not half the hertz;
    // linear interpolation spends the whole walk still sounding outdoors.
    expect(room.bedCutoffHz).toBeLessThan(arithmetic)
    expect(room.reverbSend).toBeCloseTo(
      (ZONE_ROOM.boulevard.reverbSend + ZONE_ROOM.lobby.reverbSend) / 2,
      9,
    )
  })

  it('tells interiors from exteriors by reverb and filtering, not by level', () => {
    for (const inside of ['lobby', 'hq'] as const) {
      for (const outside of ['boulevard', 'market', 'park'] as const) {
        expect(ZONE_ROOM[inside].reverbSend).toBeGreaterThan(ZONE_ROOM[outside].reverbSend)
        expect(ZONE_ROOM[inside].bedCutoffHz).toBeLessThan(ZONE_ROOM[outside].bedCutoffHz)
      }
    }
  })
})

describe('positional sources', () => {
  it('is at full level in the listener’s lap and silent past the cutoff', () => {
    expect(placeSource(at(0, 0, 0), FACING_NORTH).gain).toBeCloseTo(1, 9)
    expect(placeSource(at(0, 0, -REFERENCE_DISTANCE), FACING_NORTH).gain).toBeCloseTo(1, 9)
    expect(placeSource(at(0, 0, -MAX_DISTANCE), FACING_NORTH).gain).toBe(0)
    expect(placeSource(at(0, 0, -MAX_DISTANCE - 40), FACING_NORTH).gain).toBe(0)
  })

  it('never gets louder as it gets further away', () => {
    let previous = Infinity
    for (let d = 0; d <= MAX_DISTANCE + 5; d += 0.25) {
      const gain = placeSource(at(0, 0, -d), FACING_NORTH).gain
      expect(gain).toBeLessThanOrEqual(previous + 1e-12)
      previous = gain
    }
  })

  it('pans by the listener’s facing, not by world axes', () => {
    // Facing -Z, the right hand points at +X.
    expect(placeSource(at(10, 0, 0), FACING_NORTH).pan).toBeGreaterThan(0.5)
    expect(placeSource(at(-10, 0, 0), FACING_NORTH).pan).toBeLessThan(-0.5)
    expect(placeSource(at(0, 0, -10), FACING_NORTH).pan).toBeCloseTo(0, 9)

    // Turn to face +X and the same source is now straight ahead.
    const facingEast = { pos: at(0, 0, 0), forward: { x: 1, z: 0 } }
    expect(placeSource(at(10, 0, 0), facingEast).pan).toBeCloseTo(0, 9)
    expect(placeSource(at(0, 0, 10), facingEast).pan).toBeGreaterThan(0.5)
  })

  it('collapses the image for a source on top of the listener', () => {
    // A footstep at your own feet has no direction; hard panning it makes the
    // world lurch every time you turn.
    expect(Math.abs(placeSource(at(0.02, 0, 0), FACING_NORTH).pan)).toBeLessThan(0.05)
  })

  it('survives a degenerate facing without producing NaN', () => {
    const stalled = { pos: at(0, 0, 0), forward: { x: 0, z: 0 } }
    const place = placeSource(at(4, 0, 4), stalled)
    expect(Number.isFinite(place.gain)).toBe(true)
    expect(Number.isFinite(place.pan)).toBe(true)
  })

  it('never leaves the panner’s legal range', () => {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.05) {
      const place = placeSource(at(Math.cos(angle) * 30, 0, Math.sin(angle) * 30), FACING_NORTH)
      expect(place.pan).toBeGreaterThanOrEqual(-1)
      expect(place.pan).toBeLessThanOrEqual(1)
    }
  })
})

describe('master volume', () => {
  it('spans the full range and stays monotonic', () => {
    expect(masterGain(0)).toBe(0)
    expect(masterGain(1)).toBe(1)
    expect(masterGain(-3)).toBe(0)
    expect(masterGain(9)).toBe(1)

    let previous = -1
    for (let v = 0; v <= 1.0001; v += 0.02) {
      const gain = masterGain(v)
      expect(gain).toBeGreaterThanOrEqual(previous)
      previous = gain
    }
  })

  it('is quieter than a linear fader in the middle', () => {
    // A linear master puts every usable setting in the top fifth of the slider.
    expect(masterGain(0.5)).toBeLessThan(0.5)
  })
})

describe('footsteps', () => {
  const dt = 1 / 60

  function walk(speed: number, seconds: number, grounded = true): number[] {
    let state: FootstepState = initialFootsteps()
    const fires: number[] = []
    for (let t = 0; t < seconds; t += dt) {
      const next = advanceFootsteps(state, speed, dt, grounded)
      state = next.state
      if (next.fired) fires.push(t)
    }
    return fires
  }

  it('keeps cadence with distance covered, not with frame rate', () => {
    const walked = walk(4.3, 10)
    const expected = (4.3 * 10) / STRIDE_LENGTH
    expect(walked.length).toBeGreaterThan(expected - 3)
    expect(walked.length).toBeLessThan(expected + 3)

    // Sprinting is 65% faster and must sound like it.
    expect(walk(7.1, 10).length).toBeGreaterThan(walked.length)
  })

  it('never machine-guns, whatever the speed', () => {
    for (const speed of [4.3, 7.1, 40, 4000]) {
      const fires = walk(speed, 6)
      for (let i = 1; i < fires.length; i++) {
        expect(fires[i] - fires[i - 1]).toBeGreaterThanOrEqual(MIN_STEP_INTERVAL - 1e-9)
      }
    }
  })

  it('stays silent when standing still or airborne', () => {
    expect(walk(0, 5)).toHaveLength(0)
    expect(walk(6, 5, false)).toHaveLength(0)
  })

  it('does not bank a stride while stopped', () => {
    // Otherwise a long pause fires a step the instant you touch a key again.
    let state = initialFootsteps()
    for (let t = 0; t < 5; t += dt) state = advanceFootsteps(state, 0, dt, true).state
    expect(advanceFootsteps(state, 4.3, dt, true).fired).toBe(false)
  })

  it('varies each step within a deliberate spread', () => {
    expect(footstepVoice(() => 0)).toEqual({ pitch: 0.9, gain: 0.72 })
    expect(footstepVoice(() => 1)).toEqual({ pitch: 1.12, gain: 1 })

    // Pitch is drawn before gain; swapping them would silently narrow the range.
    const sequence = [0, 1]
    let index = 0
    expect(footstepVoice(() => sequence[index++])).toEqual({ pitch: 0.9, gain: 1 })
  })
})

describe('voice tables', () => {
  it('every bed has voices that cannot be driven out of range', () => {
    for (const id of ZONE_IDS) {
      const voices = BED_VOICES[id]
      expect(voices.length).toBeGreaterThan(0)
      for (const voice of voices) {
        expect(voice.gain).toBeGreaterThan(0)
        expect(voice.gain).toBeLessThanOrEqual(1)
        expect(voice.hz).toBeGreaterThan(20)
        expect(voice.hz).toBeLessThan(20000)
        if (voice.kind === 'noise') {
          expect(voice.q).toBeGreaterThan(0)
          // The drift LFO is added to the filter frequency; a deeper swing than
          // the cutoff itself would push a biquad through zero hertz.
          expect(voice.driftHz).toBeLessThan(voice.hz)
          expect(voice.driftRate).toBeLessThan(1)
        }
      }
    }
  })

  it('every one-shot is silent by the time its voice is torn down', () => {
    for (const spec of Object.values(ONE_SHOTS)) {
      expect(spec.level).toBeGreaterThan(0)
      expect(spec.level).toBeLessThanOrEqual(1)
      expect(spec.attack).toBeGreaterThan(0)
      expect(spec.attack).toBeLessThan(spec.duration)
      expect(spec.noise !== null || spec.tone !== null).toBe(true)

      for (const layer of [spec.noise, spec.tone]) {
        if (!layer) continue
        expect(layer.level).toBeGreaterThan(0)
        expect(layer.level).toBeLessThanOrEqual(1)
        expect(layer.fromHz).toBeGreaterThan(0)
        expect(layer.toHz).toBeGreaterThan(0)
      }

      for (const partial of spec.partials) {
        expect(partial.hz).toBeGreaterThan(0)
        expect(partial.level).toBeGreaterThan(0)
        // Every layer is stopped at `duration`; a partial that outlived it would
        // be cut mid-tail and click.
        expect(partial.delay + partial.decay).toBeLessThanOrEqual(spec.duration + 1e-9)
      }
    }
  })

  it('spools the lift motor over a slower ramp than it stops it', () => {
    expect(MOTOR.runHz).toBeGreaterThan(MOTOR.idleHz)
    expect(MOTOR.noiseRunHz).toBeGreaterThan(MOTOR.noiseIdleHz)
    expect(MOTOR.rampDown).toBeGreaterThan(MOTOR.rampUp)
    // The settle knock is scheduled at the end of the stop ramp, so the ride
    // must not still be winding down when it lands.
    expect(ONE_SHOTS.elevatorSettle.duration).toBeLessThan(MOTOR.rampDown * 2)
  })
})

describe('anchors', () => {
  it('sit on the geometry they belong to', () => {
    expect(AUDIO_ANCHORS.entranceDoor.z).toBe(ENTRANCE.z)
    expect(AUDIO_ANCHORS.entranceDoor.y).toBeLessThan(ENTRANCE.height)

    expect(AUDIO_ANCHORS.elevatorDoor(0).z).toBe(SHAFT.doorZ)
    // The car doors travel with the car, so the anchor has to as well.
    expect(AUDIO_ANCHORS.elevatorDoor(HQ.y).y - AUDIO_ANCHORS.elevatorDoor(0).y).toBe(HQ.y)
  })
})
