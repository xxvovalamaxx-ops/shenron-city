/**
 * Vehicle families.
 *
 * Six authored kinds (scripts/blender/vehicles/build_vehicles.py) plus the
 * legacy `ambulance`, which old saves may still name and which now drives the
 * van body. Every name is fictional — a parody family, no real makes. The
 * footprints match the models; the handling numbers are authored, not
 * measured: the arcade model is tuned for Manhattan's short blocks and long
 * avenues, and each top speed sits just above its drag equilibrium so the
 * car settles there under full throttle. All values are fixed so the
 * deterministic replay has exactly one world to reproduce.
 */
import type { VehicleSpec } from './vehicle-model'

type SpecOverrides = Partial<VehicleSpec> & { label: string; model: string }

function spec(overrides: SpecOverrides): VehicleSpec {
  const halfWidth = overrides.halfWidth ?? 0.93
  const seatZ = overrides.seat?.z ?? 0.32
  const base: Omit<VehicleSpec, 'label' | 'model'> = {
    mass: 1500,
    halfLength: 2.39,
    halfWidth,
    height: 1.46,
    wheelbase: 2.82,
    wheelRadius: 0.335,
    maxForwardSpeed: 44,
    maxReverseSpeed: 9,
    acceleration: 10,
    reverseAcceleration: 5.5,
    brakeDeceleration: 17,
    handbrakeDeceleration: 9,
    rollingDrag: 1.1,
    airDrag: 0.0048,
    maxSteer: 0.56,
    steerRate: 3.2,
    grip: 6,
    handbrakeGrip: 1.4,
    handbrakeLateralImpulse: 3.2,
    handbrakeYawBoost: 0.7,
    collisionSpeedKeep: 0.35,
    // The driver sits on the left (local -x is the car's left).
    seat: { x: -0.36, y: 0.72, z: seatZ },
    doors: [
      { offset: { x: halfWidth - 0.12, y: 0.8, z: seatZ }, out: { x: 1, z: 0 } },
      { offset: { x: -(halfWidth - 0.12), y: 0.8, z: seatZ }, out: { x: -1, z: 0 } },
    ],
  }
  return { ...base, ...overrides }
}

export const VEHICLE_SPECS: Readonly<Record<string, VehicleSpec>> = {
  sedan: spec({ label: 'Oriel Sedan', model: 'sedan' }),
  taxi: spec({
    label: 'Oriel Cab',
    model: 'taxi',
    mass: 1560,
    acceleration: 10.5,
    airDrag: 0.0052,
    maxForwardSpeed: 43.5,
  }),
  police: spec({
    label: 'Oriel Pursuit',
    model: 'police',
    mass: 1720,
    acceleration: 12.5,
    airDrag: 0.0045,
    maxForwardSpeed: 51,
    brakeDeceleration: 19,
    grip: 6.6,
  }),
  suv: spec({
    label: 'Brannock XT',
    model: 'suv',
    mass: 2100,
    halfLength: 2.475,
    halfWidth: 0.98,
    height: 1.83,
    wheelbase: 2.96,
    wheelRadius: 0.385,
    acceleration: 9,
    airDrag: 0.0056,
    maxForwardSpeed: 38.5,
    grip: 5.3,
    handbrakeGrip: 1.7,
    seat: { x: -0.38, y: 0.95, z: 0.3 },
  }),
  van: spec({
    label: 'Haulden Courier',
    model: 'van',
    mass: 2600,
    halfLength: 2.675,
    halfWidth: 1.0,
    height: 2.37,
    wheelbase: 3.3,
    wheelRadius: 0.36,
    acceleration: 7.5,
    airDrag: 0.0065,
    maxForwardSpeed: 32,
    maxSteer: 0.5,
    grip: 4.8,
    handbrakeGrip: 1.9,
    seat: { x: -0.42, y: 1.0, z: 1.7 },
  }),
  coupe: spec({
    label: 'Sabrecat GT',
    model: 'coupe',
    mass: 1400,
    halfLength: 2.26,
    halfWidth: 0.95,
    height: 1.3,
    wheelbase: 2.66,
    wheelRadius: 0.34,
    acceleration: 14,
    airDrag: 0.0042,
    maxForwardSpeed: 56,
    grip: 6.8,
    handbrakeGrip: 1.25,
    steerRate: 3.6,
    seat: { x: -0.36, y: 0.6, z: 0.05 },
  }),
  ambulance: spec({
    label: 'Haulden Medic',
    model: 'van',
    mass: 2700,
    halfLength: 2.675,
    halfWidth: 1.0,
    height: 2.37,
    wheelbase: 3.3,
    wheelRadius: 0.36,
    acceleration: 8,
    airDrag: 0.0062,
    maxForwardSpeed: 34,
    maxSteer: 0.5,
    grip: 4.8,
    seat: { x: -0.42, y: 1.0, z: 1.7 },
  }),
}

export const DEFAULT_VEHICLE_KIND = 'sedan'

export function vehicleSpec(kind: string): VehicleSpec {
  return VEHICLE_SPECS[kind] ?? VEHICLE_SPECS[DEFAULT_VEHICLE_KIND]
}

/** Kinds in the deterministic spawn layout, oldest first. */
export const SPAWN_KINDS: readonly string[] = ['sedan', 'taxi', 'police', 'ambulance']

/** Kinds the dev menu and the traffic fleet can produce. */
export const DRIVABLE_KINDS: readonly string[] = ['sedan', 'taxi', 'police', 'suv', 'van', 'coupe']

/** Fixed liveries; every other kind takes a per-car paint. */
export const FIXED_PAINT: Readonly<Record<string, number>> = {
  taxi: 0xf2b736,
  police: 0xf1f2f0,
  ambulance: 0xf4f4f2,
}

/**
 * Street paint: Manhattan traffic is overwhelmingly white, black, silver and
 * grey; saturated colours are the exception. Linear-ish sRGB hex values.
 */
export const STREET_PAINT: readonly number[] = [
  0xe4e4e2, 0xdcdcda, 0xc3c5c8, 0xa9adb2, 0x8a8f95, 0x5f656c,
  0x2b2e32, 0x1c1e22, 0x151618, 0x3a4250, 0x23344f, 0x6d1a1a,
  0x8c2a22, 0x2c4a3a, 0x7a6a4a, 0x40506a, 0xb9b09a, 0x1d3b5c,
]

/** Deterministic paint for a vehicle seed. */
export function paintFor(kind: string, seed: number): number {
  const fixed = FIXED_PAINT[kind]
  if (fixed !== undefined) return fixed
  const i = Math.abs(Math.floor(seed)) % STREET_PAINT.length
  return STREET_PAINT[i]
}
