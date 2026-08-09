/**
 * Promoting a city traffic car into a drivable one, and putting it back.
 *
 * The game holds cars in two deliberately different shapes, and that is not
 * the defect:
 *
 *   LION traffic  up to 700 cars as `{ lane, s, v }` — an index into the lane
 *                 graph and an arclength along it. No physics, no world pose;
 *                 the renderer derives a matrix per frame and draws them
 *                 instanced. Cheap enough to run the whole island.
 *   Phase 3A      a handful of `VehicleEntity` with a real world pose, a
 *                 motion integrator, a state machine and a controller.
 *                 Deterministic, replayable, and far too expensive for 700.
 *
 * Storing 700 cars the second way would cost what the second way costs. The
 * actual defect is that nothing connects them: the car the player walks up to
 * is a lane-space car, and entering it spawned a *separate* Phase 3A entity,
 * so for a moment the world contained two of it. The brief's requirement is
 * exactly this and no more — "a city traffic vehicle may become
 * player-controlled without spawning a second overlapping version", and on
 * release it "parks or returns safely to AI through a defined state
 * transition".
 *
 * So: one representation is live at a time, and the transition between them is
 * a function rather than a spawn. Promotion converts lane-space to world pose
 * and hands the car to the physics sim; demotion projects the world pose back
 * onto the nearest lane and hands it to LION.
 *
 * Coordinates. LION works in the Manhattan local plane: +x east, +y north,
 * heading measured in that plane. The world is Three's: +x east, +z south, so
 * world z = -y. A Y-rotation of `heading` takes a body's +x axis to
 * (cos h, 0, -sin h), which is why the heading carries across unchanged —
 * see Traffic._render, which this mirrors exactly.
 *
 * Pure arithmetic, no Three and no React, so every claim below is a test.
 */
import type { VehiclePose } from './vehicle-model'
import type { VehicleEntity, VehicleRegistry } from './vehicle-entities'

/** A lane from the LION graph, as `Traffic` builds it. */
export interface HandoffLane {
  /** Polyline points in the local plane, [x_east, y_north]. */
  pts: ReadonlyArray<readonly [number, number]>
  /** Cumulative arclength at each point; cum[0] === 0. */
  cum: ReadonlyArray<number>
  /** Total length, metres. Equals cum[cum.length - 1]. */
  len: number
  /** Free-flow speed, m/s. */
  speed: number
}

/** A LION traffic car, as `Traffic._spawn` builds it. */
export interface TrafficCar {
  /** Index into the lane array. */
  lane: number
  /** Arclength along the lane, metres. */
  s: number
  /** Speed along the lane, m/s. */
  v: number
  seed: number
  alive: boolean
  [extra: string]: unknown
}

export interface WorldPlacement {
  pos: { x: number; y: number; z: number }
  /** Radians, Y-rotation. Same convention as the instanced renderer. */
  heading: number
}

/**
 * The LION side, handed to the vehicle sim.
 *
 * Injected rather than imported, for the same reason `LaneProvider` is: the
 * vehicle core is renderer-free and test-hermetic, and `Traffic` is a THREE
 * system that owns instanced meshes. A test can hand over two lanes and three
 * cars; the game hands over 25,468 lanes and about four hundred.
 *
 * **`cars` must resolve to the array LION is using right now.** Not a copy,
 * and not a reference captured once at install time. Both fail, and the second
 * fails silently: `Traffic` replaces `this.vehicles` wholesale twice — once
 * when it rebuilds the in-scope set (`this.vehicles = keep`) and once when it
 * reaps dead cars (`this.vehicles = this.vehicles.filter(...)`). A captured
 * reference is stale from the first rebuild onward, so `promoteTrafficCar`
 * splices a car out of an array nobody reads while the live one keeps
 * circulating — reintroducing the exact duplicate this module exists to
 * prevent, with a promotion that reports success.
 *
 * The wiring in ManhattanCity therefore supplies getters. Measured before that
 * fix: the pool reported 25,468 lanes and 0 cars against a fleet of 399.
 */
export interface CityTrafficPool {
  /** The live traffic array — re-read on every access, never snapshotted. */
  readonly cars: TrafficCar[]
  readonly lanes: ReadonlyArray<HandoffLane>
  /** Road surface height a promoted car is placed at. */
  readonly roadY: number
}

/**
 * World placement of a point `s` metres along a lane.
 *
 * Mirrors Traffic._pointAt and Traffic._render together, so a promoted car
 * starts exactly where the instanced car was drawn rather than a metre off.
 * `s` is clamped: a car may be integrated slightly past the end of its lane
 * before the router moves it, and extrapolating off the polyline would throw
 * it into a building.
 */
export function laneToWorld(lane: HandoffLane, s: number, roadY: number): WorldPlacement {
  const cum = lane.cum
  const clamped = Math.min(Math.max(s, 0), lane.len)
  let i = 1
  while (i < cum.length - 1 && cum[i] < clamped) i++
  const span = Math.max(1e-6, cum[i] - cum[i - 1])
  const t = (clamped - cum[i - 1]) / span
  const a = lane.pts[i - 1]
  const b = lane.pts[i]
  const x = a[0] + (b[0] - a[0]) * t
  const y = a[1] + (b[1] - a[1]) * t
  return {
    pos: { x, y: roadY, z: -y },
    heading: Math.atan2(b[1] - a[1], b[0] - a[0]),
  }
}

export interface LaneProjection {
  /** Arclength of the closest point on the lane. */
  s: number
  /** Planar distance from the query point to the lane, metres. */
  distance: number
}

/**
 * Closest point on a lane to a world position.
 *
 * Segment-wise perpendicular projection with the parameter clamped to [0, 1],
 * so a point beyond either end of a segment projects onto that end rather than
 * onto the infinite line — without the clamp, a car sitting past a lane's last
 * point reports a plausible `s` far outside the lane.
 */
export function projectOntoLane(
  lane: HandoffLane,
  worldX: number,
  worldZ: number,
): LaneProjection {
  const px = worldX
  const py = -worldZ
  let best: LaneProjection = { s: 0, distance: Number.POSITIVE_INFINITY }
  for (let i = 1; i < lane.pts.length; i++) {
    const a = lane.pts[i - 1]
    const b = lane.pts[i]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const lenSq = dx * dx + dy * dy
    const t = lenSq < 1e-12 ? 0 : Math.min(1, Math.max(0, ((px - a[0]) * dx + (py - a[1]) * dy) / lenSq))
    const cx = a[0] + dx * t
    const cy = a[1] + dy * t
    const distance = Math.hypot(px - cx, py - cy)
    if (distance < best.distance) {
      best = { s: lane.cum[i - 1] + Math.sqrt(lenSq) * t, distance }
    }
  }
  return best
}

export interface NearestLane extends LaneProjection {
  laneId: number
}

/**
 * The lane a world position belongs to, within `maxDistance`.
 *
 * Returns null rather than a far-away best guess: a car abandoned inside a
 * plaza or on a rooftop has no lane, and handing LION a car 40 m off its own
 * polyline would teleport it sideways on the next frame.
 */
export function nearestLane(
  lanes: ReadonlyArray<HandoffLane>,
  worldX: number,
  worldZ: number,
  maxDistance = 12,
): NearestLane | null {
  let best: NearestLane | null = null
  for (let id = 0; id < lanes.length; id++) {
    const p = projectOntoLane(lanes[id], worldX, worldZ)
    if (p.distance <= maxDistance && (!best || p.distance < best.distance)) {
      best = { laneId: id, ...p }
    }
  }
  return best
}

export interface PromotionResult {
  entity: VehicleEntity
  /** Where the car was in the traffic array, so a caller can assert on it. */
  removedIndex: number
}

/**
 * Turn one LION car into a drivable entity, and take it out of LION.
 *
 * The removal is not a caller's responsibility. Leaving it to the call site is
 * precisely how the world ends up containing two of the same car — one
 * instanced and one physical, in the same place, one of them un-drivable. The
 * splice happens here, in the same function that creates the entity, so the
 * two cannot come apart.
 *
 * Returns null when the car is not in the array or its lane does not exist,
 * rather than inventing an entity for a car that is no longer there.
 */
export function promoteTrafficCar(
  traffic: TrafficCar[],
  car: TrafficCar,
  lanes: ReadonlyArray<HandoffLane>,
  registry: VehicleRegistry,
  roadY: number,
  kind = 'sedan',
): PromotionResult | null {
  const index = traffic.indexOf(car)
  if (index < 0) return null
  const lane = lanes[car.lane]
  if (!lane) return null

  const placement = laneToWorld(lane, car.s, roadY)
  traffic.splice(index, 1)
  car.alive = false

  const pose: VehiclePose = {
    pos: { x: placement.pos.x, y: placement.pos.y, z: placement.pos.z },
    heading: placement.heading,
  }
  const entity: VehicleEntity = {
    id: registry.nextId++,
    kind,
    state: 'PARKED',
    controller: 'ai',
    pose,
    motion: {
      // Carried over, not zeroed: a car doing 12 m/s that becomes drivable
      // must not stop dead in the middle of an avenue.
      speed: car.v,
      lateral: 0,
      steerAngle: 0,
      wheelSpin: 0,
      braking: false,
      // LION only ever drives cars forward along their lane, so a promoted
      // car is never mid-reverse.
      reversing: false,
    },
    owned: false,
    ai: {
      laneId: String(car.lane),
      distance: car.s,
      targetSpeed: lane.speed,
      reactionClock: 0,
    },
  }
  registry.vehicles.set(entity.id, entity)
  return { entity, removedIndex: index }
}

/**
 * Put a drivable entity back into LION, and take it out of the registry.
 *
 * The inverse of promotion, with the same single-representation guarantee. A
 * car with no lane within range is left in the registry as a parked entity and
 * null is returned — abandoning it on a plaza should leave a real parked car
 * there, not delete it and not snap it to a road 40 m away.
 */
export function demoteToTraffic(
  entity: VehicleEntity,
  traffic: TrafficCar[],
  lanes: ReadonlyArray<HandoffLane>,
  registry: VehicleRegistry,
  maxDistance = 12,
): TrafficCar | null {
  const near = nearestLane(lanes, entity.pose.pos.x, entity.pose.pos.z, maxDistance)
  if (!near) return null
  if (registry.playerVehicleId === entity.id) return null

  const car: TrafficCar = {
    lane: near.laneId,
    s: near.s,
    // Forward speed only, and never negative: LION integrates s forward and a
    // reversing car handed back would drive backwards up its own lane.
    v: Math.max(0, entity.motion.speed),
    seed: entity.id,
    alive: true,
  }
  traffic.push(car)
  registry.vehicles.delete(entity.id)
  return car
}

/**
 * How many live representations exist for a car, across both systems.
 *
 * Exists to be asserted on. The bug this whole module addresses is "two", and
 * a count is the only statement of it that a test can make directly.
 */
export function countRepresentations(
  traffic: ReadonlyArray<TrafficCar>,
  registry: VehicleRegistry,
  seed: number,
): number {
  let n = 0
  for (const car of traffic) if (car.seed === seed && car.alive) n++
  for (const entity of registry.vehicles.values()) if (entity.id === seed) n++
  return n
}
