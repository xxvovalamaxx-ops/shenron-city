/**
 * The live vehicle session: the singleton the game loop drives.
 *
 * `vehicleSim` is the authoritative vehicle world — the same state the tests
 * build themselves, but module-level because there is one game. The step
 * driver subdivides the frame delta into the fixed physics substep so frame
 * hitching never changes a trajectory that the determinism test pins down.
 */
import {
  createVehicleSim,
  stepVehicleSim,
  VEHICLE_SUBSTEP,
  type PlayerVehicleInput,
  type SimEvent,
  type VehicleSimState,
} from './vehicle-control'
import type { VehicleWorld } from './vehicle-collision'

export {
  snapshotOwnedVehicle,
  restoreOwnedVehicle,
  type SavedVehicle,
} from './vehicle-control'

export const vehicleSim: VehicleSimState = createVehicleSim()

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
  const frames = Math.max(1, Math.ceil(dt / VEHICLE_SUBSTEP))
  const sub = dt / frames
  let events: SimEvent[] = []
  for (let i = 0; i < frames; i++) {
    // stepVehicleSim clears its own event array each step, so the frame-level
    // result must accumulate across substeps — dropping all but the last
    // would lose edge-emitted events (horn, enter, exit, the enter prompt)
    // on exactly the substeps they fire on.
    events = events.concat(stepVehicleSim(vehicleSim, world, input, sub, clockHour))
  }
  return events
}
