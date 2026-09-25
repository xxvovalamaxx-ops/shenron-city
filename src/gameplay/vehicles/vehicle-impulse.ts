/**
 * Car-on-car contact as a momentum exchange, renderer-free and deterministic.
 *
 * Two oriented rectangles in the ground plane, each with a mass and a planar
 * velocity. When they overlap and close on each other, a normal impulse with
 * a little restitution and Coulomb friction is exchanged along the SAT
 * contact axis, and the pair is pushed apart by the penetration depth in
 * inverse proportion to mass. The lighter car moves more — ramming a parked
 * sedan with a van shoves it; a sedan bounces off the van.
 *
 * The struck body also receives a yaw rate from the off-centre part of the
 * impulse, so a car clipped at the rear corner spins out.
 */
import { rectContact } from './vehicle-collision'

export interface Body2D {
  x: number
  z: number
  heading: number
  vx: number
  vz: number
  mass: number
  halfLength: number
  halfWidth: number
}

export interface ContactImpulse {
  /** Contact normal from a to b. */
  normal: { x: number; z: number }
  depth: number
  /** Velocity change of each body. */
  dvA: { x: number; z: number }
  dvB: { x: number; z: number }
  /** Heading-rate change (rad/s) of each body, positive = heading increases. */
  dwA: number
  dwB: number
  /** Positional correction of each body. */
  pushA: { x: number; z: number }
  pushB: { x: number; z: number }
  /** Closing speed along the normal before the hit, m/s (>= 0). */
  closingSpeed: number
}

export const CONTACT_RESTITUTION = 0.22
export const CONTACT_FRICTION = 0.35

/** Planar moment of inertia of a rectangle about its centre. */
function inertia(b: Body2D): number {
  const l = b.halfLength * 2
  const w = b.halfWidth * 2
  return (b.mass * (l * l + w * w)) / 12
}

/**
 * Contact impulse between a and b, or null when they do not overlap. A body
 * with `mass = Infinity` is immovable (a wall-like obstacle).
 */
export function contactImpulse(
  a: Body2D,
  b: Body2D,
  restitution = CONTACT_RESTITUTION,
  friction = CONTACT_FRICTION,
): ContactImpulse | null {
  const contact = rectContact(
    { pos: { x: a.x, y: 0, z: a.z }, heading: a.heading },
    a,
    { pos: { x: b.x, y: 0, z: b.z }, heading: b.heading },
    b,
  )
  if (!contact) return null
  const n = contact.axis
  const invA = Number.isFinite(a.mass) && a.mass > 0 ? 1 / a.mass : 0
  const invB = Number.isFinite(b.mass) && b.mass > 0 ? 1 / b.mass : 0
  const invSum = invA + invB
  if (invSum <= 0) return null

  const relX = a.vx - b.vx
  const relZ = a.vz - b.vz
  const closing = relX * n.x + relZ * n.z
  // Positional split so the pair ends just touching.
  const depth = contact.depth + 0.005
  const pushA = { x: -n.x * depth * (invA / invSum), z: -n.z * depth * (invA / invSum) }
  const pushB = { x: n.x * depth * (invB / invSum), z: n.z * depth * (invB / invSum) }

  if (closing <= 0) {
    return {
      normal: n,
      depth: contact.depth,
      dvA: { x: 0, z: 0 },
      dvB: { x: 0, z: 0 },
      dwA: 0,
      dwB: 0,
      pushA,
      pushB,
      closingSpeed: 0,
    }
  }

  const jn = ((1 + restitution) * closing) / invSum
  // Tangential friction, capped by the Coulomb cone and by what stops the
  // tangential slip outright.
  const tx = relX - closing * n.x
  const tz = relZ - closing * n.z
  const tLen = Math.hypot(tx, tz)
  let jtX = 0
  let jtZ = 0
  if (tLen > 1e-9) {
    const jt = Math.min(friction * jn, tLen / invSum)
    jtX = (-tx / tLen) * jt
    jtZ = (-tz / tLen) * jt
  }
  // Impulse on b (a receives the opposite).
  const jx = n.x * jn - jtX
  const jz = n.z * jn - jtZ

  // Contact point: midway between the two centres, pulled onto b's face.
  const cx = (a.x + b.x) / 2
  const cz = (a.z + b.z) / 2
  const rbx = cx - b.x
  const rbz = cz - b.z
  const rax = cx - a.x
  const raz = cz - a.z
  // Heading rate from a force at offset r: dω = (r.z·J.x − r.x·J.z) / I
  // (heading increases turning +z toward +x).
  const dwB = invB > 0 ? (rbz * jx - rbx * jz) / inertia(b) : 0
  const dwA = invA > 0 ? (raz * -jx - rax * -jz) / inertia(a) : 0

  return {
    normal: n,
    depth: contact.depth,
    dvA: { x: -jx * invA, z: -jz * invA },
    dvB: { x: jx * invB, z: jz * invB },
    dwA,
    dwB,
    pushA,
    pushB,
    closingSpeed: closing,
  }
}
