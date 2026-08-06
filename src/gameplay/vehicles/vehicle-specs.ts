/**
 * Vehicle families for Phase 3A.
 *
 * Four families matching the dev GLBs already in the build (sedan, taxi,
 * police, ambulance). The numbers are authored, not measured: the arcade
 * model is tuned to feel city-appropriate — a sedan tops out around 119 km/h,
 * a taxi is livelier, emergency vehicles are heavier. All values are fixed so
 * the deterministic replay has exactly one world to reproduce.
 */
import type { VehicleSpec } from './vehicle-model'

function spec(overrides: Partial<VehicleSpec> & { label: string }): VehicleSpec {
  const base: Omit<VehicleSpec, 'label'> = {
    halfLength: 2.2,
    halfWidth: 0.95,
    height: 1.45,
    wheelbase: 2.7,
    wheelRadius: 0.33,
    maxForwardSpeed: 33,
    maxReverseSpeed: 8,
    acceleration: 9.5,
    reverseAcceleration: 5,
    brakeDeceleration: 16,
    handbrakeDeceleration: 22,
    rollingDrag: 1.1,
    airDrag: 0.008,
    maxSteer: 0.55,
    steerRate: 3,
    grip: 6,
    handbrakeGrip: 1.6,
    handbrakeLateralImpulse: 2.6,
    handbrakeYawBoost: 0.55,
    collisionSpeedKeep: 0.35,
    seat: { x: 0, y: 0.62, z: -0.45 },
    doors: [
      { offset: { x: 0.62, y: 0.7, z: -0.4 }, out: { x: 1, z: 0 } },
      { offset: { x: -0.62, y: 0.7, z: -0.4 }, out: { x: -1, z: 0 } },
    ],
  }
  return { ...base, ...overrides }
}

export const VEHICLE_SPECS: Readonly<Record<string, VehicleSpec>> = {
  sedan: spec({ label: 'Sedan' }),
  taxi: spec({ label: 'Taxi', acceleration: 10.5, maxForwardSpeed: 34 }),
  police: spec({
    label: 'Police',
    halfLength: 2.35,
    acceleration: 11,
    maxForwardSpeed: 37,
    brakeDeceleration: 18,
  }),
  ambulance: spec({
    label: 'Ambulance',
    halfLength: 2.6,
    halfWidth: 1.05,
    maxForwardSpeed: 30,
    acceleration: 8.5,
  }),
}

export const DEFAULT_VEHICLE_KIND = 'sedan'

export function vehicleSpec(kind: string): VehicleSpec {
  return VEHICLE_SPECS[kind] ?? VEHICLE_SPECS[DEFAULT_VEHICLE_KIND]
}

/** Kinds in the deterministic spawn layout, oldest first. */
export const SPAWN_KINDS: readonly string[] = ['sedan', 'taxi', 'police', 'ambulance']
