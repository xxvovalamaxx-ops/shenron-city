import { describe, expect, it } from 'vitest'
import { decodeSave, defaultSave, encodeSave, SAVE_VERSION } from '../save'
import {
  createVehicleSim,
  restoreOwnedVehicle,
  snapshotOwnedVehicle,
  stepVehicleSim,
  type PlayerVehicleInput,
} from './vehicle-control'
import { AabbVehicleWorld } from './vehicle-collision'
import { aabb } from '../collision'

// The default layout parks the owned car near the Midtown East spawn point
// (MANHATTAN_SPAWN_POINT); the arena floor must cover that area for prompts
// and ground probes to resolve.
const FLOOR = aabb(1000, 0, -3000, 4000, 1, 4000)
const world = new AabbVehicleWorld([FLOOR])

function driveFor(sim: ReturnType<typeof createVehicleSim>, seconds: number, input: PlayerVehicleInput = { throttle: 1, brake: 0, steer: 0, handbrake: false, horn: false, interact: false }) {
  const dt = 1 / 120
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    stepVehicleSim(sim, world, input, dt, 21)
  }
}

describe('vehicle save round trip', () => {
  it('a fresh session has nothing to persist', () => {
    const sim = createVehicleSim(0)
    expect(snapshotOwnedVehicle(sim)).toBeNull()
  })

  it('persists the owned car once the player has driven it', () => {
    const sim = createVehicleSim(0)
    // Stand at the owned car's door and enter it.
    const owned = [...sim.registry.vehicles.values()].find((v) => v.owned)!
    sim.player.pos = { x: owned.pose.pos.x + 1, y: 0.5, z: owned.pose.pos.z }
    driveFor(sim, 1 / 120, { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, interact: true })
    driveFor(sim, 1)
    driveFor(sim, 1 / 120, { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, interact: false })

    const snapshot = snapshotOwnedVehicle(sim)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.kind).toBe('sedan')
    // The car keeps the heading it had when parked (the spawn car faces the
    // nearest boulevard segment).
    expect(snapshot!.heading).toBeCloseTo(owned.pose.heading, 6)
    expect(Math.hypot(snapshot!.pos.x - owned.pose.pos.x, snapshot!.pos.z - owned.pose.pos.z)).toBeLessThan(15)
  })

  it('encode/decode carries the vehicle section', () => {
    const sim = createVehicleSim(0)
    const owned = [...sim.registry.vehicles.values()].find((v) => v.owned)!
    sim.player.pos = { x: owned.pose.pos.x + 1, y: 0.5, z: owned.pose.pos.z }
    driveFor(sim, 1 / 120, { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, interact: true })
    driveFor(sim, 1)
    const snapshot = snapshotOwnedVehicle(sim)!

    const encoded = JSON.parse(encodeSave({ ...defaultSave(), pos: { x: 5, y: 1, z: 5 }, vehicle: snapshot }))
    expect(encoded.v).toBe(SAVE_VERSION)
    expect(encoded.vehicle).toEqual({ kind: snapshot.kind, pos: snapshot.pos, heading: snapshot.heading })

    const loaded = decodeSave(JSON.stringify(encoded))
    expect(loaded.fault).toBeNull()
    expect(loaded.repaired).toEqual([])
    expect(loaded.data.vehicle).toEqual(snapshot)
  })

  it('restores the car as PARKED and stands the player at its door', () => {
    const sim = createVehicleSim(0)
    const saved = { kind: 'taxi', pos: { x: 100, y: 0.5, z: 50 }, heading: 0.7 }
    restoreOwnedVehicle(sim, saved)

    const owned = [...sim.registry.vehicles.values()].find((v) => v.owned)!
    expect(owned.kind).toBe('taxi')
    expect(owned.state).toBe('PARKED')
    expect(owned.pose.pos.x).toBeCloseTo(100, 6)
    expect(owned.pose.heading).toBeCloseTo(0.7, 6)
    expect(sim.registry.playerVehicleId).toBeNull()
    expect(sim.playerVisible).toBe(true)
    expect(sim.ownedPersisted).toBe(true)
  })

  it('a save with a broken vehicle restores with no car and a repair note', () => {
    const base = JSON.parse(encodeSave(defaultSave())) as Record<string, unknown>
    const broken = decodeSave(
      JSON.stringify({ ...base, vehicle: { kind: 'sedan', pos: { x: 1e9, y: 0, z: 0 }, heading: 0 } }),
    )
    expect(broken.fault).toBeNull()
    expect(broken.repaired).toContain('vehicle')
    expect(broken.data.vehicle).toBeNull()

    const nanHeading = decodeSave(
      JSON.stringify({ ...base, vehicle: { kind: 'sedan', pos: { x: 0, y: 0, z: 0 }, heading: Number.NaN } }),
    )
    expect(nanHeading.repaired).toContain('vehicle')
    expect(nanHeading.data.vehicle).toBeNull()
  })
})
