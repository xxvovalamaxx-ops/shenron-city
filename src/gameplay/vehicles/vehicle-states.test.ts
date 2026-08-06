import { describe, expect, it } from 'vitest'
import {
  createDefaultLayout,
  createRegistry,
  nearestEnterableDoor,
  parkedMotion,
  seatWorld,
  spawnVehicle,
  transitionVehicle,
  vehicleDoors,
  VEHICLE_STATES,
  VEHICLE_TRANSITIONS,
} from './vehicle-entities'
import { vehicleSpec } from './vehicle-specs'

describe('the seven states', () => {
  it('contains exactly the required states', () => {
    expect(VEHICLE_STATES).toEqual([
      'UNAVAILABLE',
      'PARKED',
      'ENTERING',
      'PLAYER_CONTROLLED',
      'EXITING',
      'AI_CONTROLLED',
      'DISABLED',
    ])
  })

  it('has the required authority transfers and no shortcuts', () => {
    // Player takes a parked car.
    expect(VEHICLE_TRANSITIONS.PARKED).toContain('ENTERING')
    expect(VEHICLE_TRANSITIONS.ENTERING).toContain('PLAYER_CONTROLLED')
    // Player exits: park, never straight back to AI.
    expect(VEHICLE_TRANSITIONS.PLAYER_CONTROLLED).toContain('EXITING')
    expect(VEHICLE_TRANSITIONS.EXITING).toContain('PARKED')
    expect(VEHICLE_TRANSITIONS.EXITING).not.toContain('AI_CONTROLLED')
    // Return to AI is explicit and routed through PARKED.
    expect(VEHICLE_TRANSITIONS.PARKED).toContain('AI_CONTROLLED')
    // AI gives the player authority only through ENTERING.
    expect(VEHICLE_TRANSITIONS.AI_CONTROLLED).toContain('ENTERING')
    expect(VEHICLE_TRANSITIONS.AI_CONTROLLED).not.toContain('PLAYER_CONTROLLED')
    // DISABLED is terminal.
    expect(VEHICLE_TRANSITIONS.DISABLED).toEqual([])
  })
})

describe('transitionVehicle', () => {
  it('spawns into PARKED and enters via ENTERING', () => {
    const registry = createRegistry()
    const entity = spawnVehicle(registry, 'sedan', { pos: { x: 0, y: 0, z: 0 }, heading: 0 }, 'PARKED', parkedMotion())
    expect(registry.playerVehicleId).toBeNull()

    expect(transitionVehicle(registry, entity.id, 'ENTERING').ok).toBe(true)
    expect(entity.state).toBe('ENTERING')
    expect(entity.controller).toBe('player')
    expect(registry.playerVehicleId).toBe(entity.id)

    expect(transitionVehicle(registry, entity.id, 'PLAYER_CONTROLLED').ok).toBe(true)
    expect(entity.state).toBe('PLAYER_CONTROLLED')
  })

  it('transfers authority from AI to the player and drops the AI state', () => {
    const registry = createRegistry()
    const entity = spawnVehicle(registry, 'taxi', { pos: { x: 0, y: 0, z: 0 }, heading: 0 }, 'AI_CONTROLLED', parkedMotion())
    entity.ai = { laneId: 'boulevard-loop', distance: 10, targetSpeed: 8, reactionClock: 0 }

    expect(transitionVehicle(registry, entity.id, 'ENTERING').ok).toBe(true)
    expect(entity.ai).toBeNull()
    expect(entity.controller).toBe('player')
    expect(registry.playerVehicleId).toBe(entity.id)

    expect(transitionVehicle(registry, entity.id, 'PLAYER_CONTROLLED').ok).toBe(true)
  })

  it('parks the car on exit and releases the player', () => {
    const registry = createRegistry()
    const entity = spawnVehicle(registry, 'sedan', { pos: { x: 0, y: 0, z: 0 }, heading: 0 }, 'PARKED', parkedMotion())
    transitionVehicle(registry, entity.id, 'ENTERING')
    transitionVehicle(registry, entity.id, 'PLAYER_CONTROLLED')

    expect(transitionVehicle(registry, entity.id, 'EXITING').ok).toBe(true)
    expect(transitionVehicle(registry, entity.id, 'PARKED').ok).toBe(true)
    expect(entity.state).toBe('PARKED')
    expect(registry.playerVehicleId).toBeNull()
  })

  it('refuses illegal transitions with a reason', () => {
    const registry = createRegistry()
    const entity = spawnVehicle(registry, 'sedan', { pos: { x: 0, y: 0, z: 0 }, heading: 0 }, 'PARKED', parkedMotion())

    const direct = transitionVehicle(registry, entity.id, 'PLAYER_CONTROLLED')
    expect(direct.ok).toBe(false)
    if (!direct.ok) expect(direct.reason).toContain('not an allowed transition')

    expect(transitionVehicle(registry, entity.id, 'DISABLED').ok).toBe(false)
    expect(entity.state).toBe('PARKED')
  })

  it('returns a car to the AI through the explicit PARKED → AI_CONTROLLED step', () => {
    const registry = createRegistry()
    const entity = spawnVehicle(registry, 'sedan', { pos: { x: 0, y: 0, z: 0 }, heading: 0 }, 'PARKED', parkedMotion())

    const result = transitionVehicle(registry, entity.id, 'AI_CONTROLLED')
    expect(result.ok).toBe(true)
    expect(entity.state).toBe('AI_CONTROLLED')
    expect(entity.controller).toBe('ai')
    expect(entity.ai).not.toBeNull()
  })

  it('DISABLED is terminal', () => {
    const registry = createRegistry()
    const entity = spawnVehicle(registry, 'sedan', { pos: { x: 0, y: 0, z: 0 }, heading: 0 }, 'AI_CONTROLLED', parkedMotion())
    expect(transitionVehicle(registry, entity.id, 'DISABLED').ok).toBe(true)
    for (const state of VEHICLE_STATES) {
      expect(transitionVehicle(registry, entity.id, state).ok).toBe(false)
    }
  })
})

describe('default layout', () => {
  it('is deterministic: the same seed builds the same world', () => {
    const a = createDefaultLayout(8, 0x53a3)
    const b = createDefaultLayout(8, 0x53a3)
    const snap = (layout: typeof a) =>
      [...layout.registry.vehicles.values()]
        .sort((x, y) => x.id - y.id)
        .map((v) => [v.id, v.kind, v.state, v.pose.heading, v.pose.pos.x, v.pose.pos.z, v.owned])
    expect(snap(a)).toEqual(snap(b))
  })

  it('always includes a parked car the player owns', () => {
    const { registry } = createDefaultLayout()
    const owned = [...registry.vehicles.values()].filter((v) => v.owned)
    expect(owned).toHaveLength(1)
    expect(owned[0].state).toBe('PARKED')
    expect(registry.playerVehicleId).toBeNull()
  })

  it('scales AI traffic with the budget', () => {
    const aiCount = (layout: { registry: ReturnType<typeof createDefaultLayout>['registry'] }) =>
      [...layout.registry.vehicles.values()].filter((v) => v.state === 'AI_CONTROLLED').length
    expect(aiCount(createDefaultLayout(3))).toBe(0)
    expect(aiCount(createDefaultLayout(12))).toBe(9)
  })
})

describe('doors and seats', () => {
  it('finds the closest door inside the prompt radius and rejects far ones', () => {
    const spec = vehicleSpec('sedan')
    const pose = { pos: { x: 0, y: 0, z: 0 }, heading: 0 }
    const doors = vehicleDoors(spec, pose)
    expect(doors.length).toBeGreaterThanOrEqual(2)

    const near = nearestEnterableDoor(spec, pose, { x: 0.7, y: 0, z: -0.4 })
    expect(near).not.toBeNull()
    expect(nearestEnterableDoor(spec, pose, { x: 20, y: 0, z: 20 })).toBeNull()

    const seat = seatWorld(spec, pose)
    expect(seat.y).toBeCloseTo(spec.seat.y, 9)
  })
})
