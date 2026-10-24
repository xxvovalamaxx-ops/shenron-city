import { describe, expect, it } from 'vitest'
import { aabb } from '../collision'
import { AabbVehicleWorld } from '../vehicles/vehicle-collision'
import { createLiveVehicleSim, NO_VEHICLE_INPUT, stepVehicleSim } from '../vehicles/vehicle-control'
import { parseStreetGraph, type RawStreetGraph } from '../../ui/radar/street-data'
import {
  BUST_TIME,
  clearDispatch,
  createDispatch,
  desiredUnits,
  MAX_UNITS,
  nextWaypoint,
  pickSpawnNode,
  SPAWN_INTERVAL,
  SPAWN_MAX,
  SPAWN_MIN,
  stepDispatch,
  unitObservers,
} from './police-dispatch'
import { roadDistances } from '../director/mission-catalog'
import { nearestNode } from '../../ui/radar/route'

const DT = 1 / 60

/** An 11 x 11 grid of 60 m blocks centred on the origin (y north = -z). */
function gridCity(): RawStreetGraph {
  const n = 11
  const block = 60
  const nodes: Array<[number, number]> = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) nodes.push([(c - 5) * block, (r - 5) * block])
  const edges: RawStreetGraph['edges'] = []
  const id = (r: number, c: number) => r * n + c
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (c < n - 1) edges.push({ a: id(r, c), b: id(r, c + 1), width: 12, length: block })
      if (r < n - 1) edges.push({ a: id(r, c), b: id(r + 1, c), width: 12, length: block })
    }
  }
  return { nodes, edges }
}

const data = parseStreetGraph(gridCity())
const world = new AabbVehicleWorld([aabb(0, 0, 0, 800, 1, 800)])

function run(seconds: number, stars: number, player = { x: 0, z: 0 }, onFoot = true, spotted = true) {
  const sim = createLiveVehicleSim()
  sim.player.pos = { x: player.x, y: 0.5, z: player.z }
  const dispatch = createDispatch()
  let busted = false
  let minDistance = Infinity
  for (let t = 0; t < seconds; t += DT) {
    const result = stepDispatch(dispatch, sim, world, data, {
      stars,
      spotted,
      player,
      playerVel: { x: 0, z: 0 },
      onFoot,
      dt: DT,
    })
    busted ||= result.busted
    stepVehicleSim(sim, world, NO_VEHICLE_INPUT, DT, 12)
    for (const unit of dispatch.units.values()) {
      const e = sim.registry.vehicles.get(unit.id)!
      minDistance = Math.min(minDistance, Math.hypot(e.pose.pos.x - player.x, e.pose.pos.z - player.z))
    }
  }
  return { sim, dispatch, busted, minDistance }
}

describe('police dispatch', () => {
  it('scales units with the wanted level, capped', () => {
    expect(desiredUnits(0)).toBe(0)
    expect(desiredUnits(1)).toBeGreaterThanOrEqual(1)
    expect(desiredUnits(5)).toBe(MAX_UNITS)
  })

  it('sends nobody without a wanted level', () => {
    const { dispatch } = run(10, 0)
    expect(dispatch.units.size).toBe(0)
  })

  it('spawns cruisers one at a time up to strength, on the road, in the spawn band', () => {
    const { dispatch, sim } = run(SPAWN_INTERVAL * 5, 3, { x: 0, z: 0 }, false, false)
    expect(dispatch.units.size).toBe(desiredUnits(3))
    for (const unit of dispatch.units.values()) {
      const e = sim.registry.vehicles.get(unit.id)!
      expect(e.kind).toBe('police')
      expect(e.controller).toBe('pursuit')
    }
  })

  it('picks spawn nodes a few hundred metres of road away', () => {
    const node = pickSpawnNode(data, { x: 0, z: 0 }, 0)!
    const home = nearestNode(data.graph, 0, 0, true)
    const d = roadDistances(data.graph, home, 1000, false)[node]
    expect(d).toBeGreaterThanOrEqual(SPAWN_MIN)
    expect(d).toBeLessThanOrEqual(SPAWN_MAX)
  })

  it('drives along the streets to the suspect', () => {
    const { minDistance } = run(40, 1, { x: 0, z: 0 }, false, false)
    expect(minDistance).toBeLessThan(15)
  })

  it('arrests a player on foot once a unit has pulled up beside them', () => {
    const { busted } = run(45, 1, { x: 0, z: 0 }, true, true)
    expect(busted).toBe(true)
  })

  it('does not arrest a driver', () => {
    const { busted } = run(20, 1, { x: 0, z: 0 }, false, true)
    expect(busted).toBe(false)
  })

  it('reports every unit as an observer and can clear them all', () => {
    const { dispatch, sim } = run(SPAWN_INTERVAL * 3, 2)
    expect(unitObservers(dispatch, sim).length).toBe(dispatch.units.size)
    clearDispatch(dispatch, sim)
    expect(dispatch.units.size).toBe(0)
    expect([...sim.registry.vehicles.values()].some((v) => v.controller === 'pursuit')).toBe(false)
  })

  it('stands units down when the heat is off', () => {
    const sim = createLiveVehicleSim()
    const dispatch = createDispatch()
    const step = (stars: number, player: { x: number; z: number }) =>
      stepDispatch(dispatch, sim, world, data, { stars, spotted: false, player, playerVel: { x: 0, z: 0 }, onFoot: false, dt: DT })
    step(2, { x: 0, z: 0 })
    expect(dispatch.units.size).toBe(1)
    // Heat off, suspect far away: the unit peels off at once.
    step(0, { x: 250, z: 250 })
    expect(dispatch.units.size).toBe(0)
  })

  it('takes the next route point ahead of the car', () => {
    const route = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 30, z: 0 }, { x: 60, z: 0 }]
    expect(nextWaypoint(route, { x: 4, z: 0 })).toEqual({ x: 30, z: 0 })
  })

  it('never aims back at a route point the car has just driven past', () => {
    const route = [{ x: 0, z: 240 }, { x: 0, z: 180 }, { x: 0, z: 120 }]
    // 17 m past the first node, heading down the route.
    expect(nextWaypoint(route, { x: 0, z: 223 })).toEqual({ x: 0, z: 180 })
  })

  it('arrest timing is not instant', () => {
    expect(BUST_TIME).toBeGreaterThan(1)
  })
})
