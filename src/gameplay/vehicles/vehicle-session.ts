/**
 * The live vehicle session: the singleton the game loop drives.
 *
 * `vehicleSim` is the authoritative vehicle world — the same state the tests
 * build themselves, but module-level because there is one game. The step
 * driver subdivides the frame delta into the fixed physics substep so frame
 * hitching never changes a trajectory that the determinism test pins down.
 *
 * It also owns the per-frame read-outs other layers want without touching
 * the sim: the gearbox (engine note, HUD gear and revs) and
 * {@link getVehicleHud}, the one getter the HUD reads.
 */
import {
  createLiveVehicleSim,
  stepVehicleSim,
  VEHICLE_SUBSTEP,
  type PlayerVehicleInput,
  type SimEvent,
  type VehicleSimState,
} from './vehicle-control'
import type { VehicleWorld } from './vehicle-collision'
import { speedKmh } from './vehicle-model'
import { vehicleSpec } from './vehicle-specs'
import {
  gearboxFor,
  gearLabel,
  initialGearbox,
  revFraction,
  stepGearbox,
  type GearboxSpec,
  type GearboxState,
} from './vehicle-gearbox'

export {
  snapshotOwnedVehicle,
  restoreOwnedVehicle,
  type SavedVehicle,
} from './vehicle-control'

export const vehicleSim: VehicleSimState = createLiveVehicleSim()

/**
 * Every event of the last stepped frame, in order (the session step returns
 * the same list; this copy is for layers that run later in the frame — the
 * vehicle rig's effects and audio).
 */
export const lastFrameEvents: SimEvent[] = []

/** The input of the last stepped frame (effects read the handbrake, audio the horn). */
export const lastSessionInput: Required<PlayerVehicleInput> = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  horn: false,
  interact: false,
  lookBehind: false,
  hornHeld: false,
}

/**
 * Dev-only tooling knob: scales the session's clock (captures under a CPU
 * rasteriser run at a fraction of a frame per second). Never set in play.
 */
export const vehicleDevClock = { timeScale: 1 }

let gearSpec: GearboxSpec | null = null
let gearKind: string | null = null
let gearState: GearboxState | null = null
let lastThrottle = 0

/**
 * Advance the session by a frame of `dt` seconds. The frame is subdivided
 * into fixed {@link VEHICLE_SUBSTEP} steps (plus a deterministic remainder),
 * so the simulation sees the same integration size regardless of the frame
 * rate.
 */
export function stepVehicleSession(
  world: VehicleWorld,
  input: PlayerVehicleInput,
  dt: number,
  clockHour: number,
): SimEvent[] {
  dt *= vehicleDevClock.timeScale
  const frames = Math.max(1, Math.ceil(dt / VEHICLE_SUBSTEP))
  const sub = dt / frames
  let events: SimEvent[] = []
  for (let i = 0; i < frames; i++) {
    // stepVehicleSim clears its own event array each step, so the frame-level
    // result must accumulate across substeps — dropping all but the last
    // would lose edge-emitted events (horn, enter, exit, the enter prompt)
    // on exactly the substeps they fire on. Edge inputs apply to the first
    // substep only.
    const stepInput = i === 0 ? input : { ...input, horn: false, interact: false }
    events = events.concat(stepVehicleSim(vehicleSim, world, stepInput, sub, clockHour))
  }
  stepSessionGearbox(input.throttle, dt)
  Object.assign(lastSessionInput, { lookBehind: false, hornHeld: false }, input)
  lastFrameEvents.length = 0
  for (const event of events) lastFrameEvents.push(event)
  return events
}

function stepSessionGearbox(throttle: number, dt: number): void {
  lastThrottle = throttle
  const id = vehicleSim.registry.playerVehicleId
  const entity = id !== null ? vehicleSim.registry.vehicles.get(id) : undefined
  if (!entity) {
    gearState = null
    gearKind = null
    return
  }
  if (gearKind !== entity.kind || !gearSpec || !gearState) {
    gearKind = entity.kind
    gearSpec = gearboxFor(vehicleSpec(entity.kind))
    gearState = initialGearbox(gearSpec)
  }
  gearState = stepGearbox(gearState, gearSpec, entity.motion.speed, throttle, dt)
}

/** What the HUD (and the engine note) needs about the player's car. */
export interface VehicleHudState {
  /** True while the player is in a car (entering, driving or exiting). */
  inVehicle: boolean
  /** True only while the player has the wheel. */
  driving: boolean
  /** Session kind id: 'sedan', 'taxi', 'police', 'suv', 'van', 'coupe' … */
  kind: string | null
  /** Display name, e.g. 'Oriel Cab'. Fictional. */
  name: string | null
  /** Ground speed, km/h, unsigned. */
  speedKmh: number
  /** Signed speed along the car, m/s (negative reversing). */
  speed: number
  /** 'R', 'N', '1' … '6'. */
  gear: string
  /** Engine speed, rev/min. */
  rpm: number
  /** 0 at idle … 1 at the redline. */
  rpmNorm: number
  redlineRpm: number
  /** 0..1 throttle this frame. */
  throttle: number
  headlights: boolean
  /** True for the frame a shift began (audio uses it). */
  shiftedUp: boolean
  shiftedDown: boolean
}

const EMPTY_HUD: VehicleHudState = {
  inVehicle: false,
  driving: false,
  kind: null,
  name: null,
  speedKmh: 0,
  speed: 0,
  gear: 'N',
  rpm: 0,
  rpmNorm: 0,
  redlineRpm: 0,
  throttle: 0,
  headlights: false,
  shiftedUp: false,
  shiftedDown: false,
}

/**
 * Read-only snapshot of the player's car for the HUD. Cheap; call it from a
 * rAF/interval or a useFrame. Returns a fresh object.
 */
export function getVehicleHud(): VehicleHudState {
  const id = vehicleSim.registry.playerVehicleId
  const entity = id !== null ? vehicleSim.registry.vehicles.get(id) : undefined
  if (!entity) return { ...EMPTY_HUD }
  const spec = vehicleSpec(entity.kind)
  const gs = gearState
  const gsp = gearSpec
  return {
    inVehicle: true,
    driving: entity.state === 'PLAYER_CONTROLLED',
    kind: entity.kind,
    name: spec.label,
    speedKmh: speedKmh(entity.motion.speed),
    speed: entity.motion.speed,
    gear: gs ? gearLabel(gs.gear) : 'N',
    rpm: gs ? gs.rpm : 0,
    rpmNorm: gs && gsp ? revFraction(gsp, gs) : 0,
    redlineRpm: gsp?.redlineRpm ?? 0,
    throttle: lastThrottle,
    headlights: vehicleSim.headlightsOn,
    shiftedUp: gs?.shiftedUp ?? false,
    shiftedDown: gs?.shiftedDown ?? false,
  }
}
