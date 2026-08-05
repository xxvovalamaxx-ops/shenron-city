/**
 * Destructible-prop simulation — renderer-free and deterministic.
 *
 * The damage step, the health map, the fragment and scorch lifecycles all
 * live here, away from React. React renders what this module says; the
 * damage is stepped from the one place the simulation advances (GameLoop),
 * with the same real `dt` the elevator, doors, traffic and player use.
 *
 * Determinism contract: `stepDestruction` is a plain function over
 * `DestructionState` — no RNG, no clocks, no renderer, no React. Two calls
 * with the same state and inputs produce the same output. Nothing in this
 * module can be double-invoked by React StrictMode, because nothing here
 * touches React at all.
 */
import type { Vec3 } from '../gameplay/collision'
import { BREAKABLES, type BreakableDef } from './BreakableRegistry'
import { LASER_CONFIG } from '../weapons/laser'

export interface BreakableHealth {
  id: string
  current: number
  max: number
}

export interface ActiveFragment {
  id: string
  def: BreakableDef
  origin: Vec3
  direction: Vec3
}

export interface Scorch {
  id: string
  position: [number, number, number]
  normal: [number, number, number]
}

/**
 * The whole destructible-prop simulation. One instance lives on the runtime
 * (`rt.destruction`) so it survives renders, StrictMode remounts and frame
 * pacing — the same reasoning that keeps the player position off React.
 */
export interface DestructionState {
  healths: Map<string, BreakableHealth>
  fragments: ActiveFragment[]
  scorches: Scorch[]
  /** Monotonic id source; bumped by the sim, read by React for re-renders. */
  idCounter: number
  /** Bumped on every state change so React can mirror cheaply. */
  revision: number
}

export function createDestructionState(): DestructionState {
  const healths = new Map<string, BreakableHealth>()
  for (const def of BREAKABLES) {
    healths.set(def.id, { id: def.id, current: def.health, max: def.health })
  }
  return { healths, fragments: [], scorches: [], idCounter: 0, revision: 0 }
}

/** Max scorch marks kept at once — beyond this the oldest are dropped. */
const MAX_SCORCHES = 20

/**
 * Apply laser damage for one frame.
 *
 * `destroyed` is the shared authority set (on `rt`) that collision and
 * rendering both consult; the sim adds to it here and never removes.
 *
 * Damage is applied to the first not-yet-destroyed breakable whose AABB
 * contains the aim point, mirroring the previous fixed-1/60 behaviour but
 * with the caller's real dt, so the time to destroy is the same at 30, 60 or
 * 120 fps.
 */
export function stepDestruction(
  state: DestructionState,
  opts: {
    aim: Vec3 | null
    dt: number
    destroyed: Set<string>
  },
): void {
  const { aim, dt, destroyed } = opts
  if (!aim || !Number.isFinite(dt) || dt <= 0) return

  for (const def of BREAKABLES) {
    if (destroyed.has(def.id)) continue

    // Fast AABB pre-check: is the aim point within tolerance of this breakable?
    const hx = def.size[0] / 2 + 0.5
    const hy = def.size[1] / 2 + 0.5
    const hz = def.size[2] / 2 + 0.5
    if (
      Math.abs(aim.x - def.pos.x) > hx ||
      Math.abs(aim.y - def.pos.y) > hy ||
      Math.abs(aim.z - def.pos.z) > hz
    ) {
      continue
    }

    const health = state.healths.get(def.id)
    if (!health) continue

    const damage = LASER_CONFIG.dps * dt
    const newHealth = health.current - damage
    if (newHealth <= 0) {
      destroyed.add(def.id)
      spawnFragments(state, def, aim)
      spawnScorch(state, aim)
    }
    health.current = Math.max(0, newHealth)
    state.revision += 1
    return
  }
}

/** Spawn the debris fragments for one destroyed breakable. */
function spawnFragments(state: DestructionState, def: BreakableDef, aim: Vec3): void {
  const dx = aim.x - def.pos.x
  const dy = aim.y - def.pos.y
  const dz = aim.z - def.pos.z
  const len = Math.hypot(dx, dy, dz) || 1
  const direction: Vec3 = { x: dx / len, y: dy / len, z: dz / len }
  const origin: Vec3 = { x: def.pos.x, y: def.pos.y, z: def.pos.z }

  const fragCount = def.fragments ?? 5
  for (let i = 0; i < fragCount; i++) {
    state.fragments.push({
      id: `frag-${state.idCounter++}`,
      def,
      origin,
      direction,
    })
  }
}

function spawnScorch(state: DestructionState, aim: Vec3): void {
  state.scorches = [
    ...state.scorches.slice(-(MAX_SCORCHES - 1)),
    {
      id: `scorch-${state.idCounter++}`,
      position: [aim.x, aim.y, aim.z],
      normal: [0, 1, 0],
    },
  ]
}

/** Remove a fragment by id; used by the presentation layer on expiry. */
export function removeFragment(state: DestructionState, id: string): void {
  const before = state.fragments.length
  state.fragments = state.fragments.filter((f) => f.id !== id)
  if (state.fragments.length !== before) state.revision += 1
}

/** Remove a scorch mark by id; used by the presentation layer on expiry. */
export function removeScorch(state: DestructionState, id: string): void {
  const before = state.scorches.length
  state.scorches = state.scorches.filter((s) => s.id !== id)
  if (state.scorches.length !== before) state.revision += 1
}

/** Rebuild the health map from scratch, applying an existing destroyed set. */
export function resetDestructionHealths(
  state: DestructionState,
  destroyed: ReadonlySet<string>,
): void {
  const healths = new Map<string, BreakableHealth>()
  for (const def of BREAKABLES) {
    healths.set(def.id, {
      id: def.id,
      current: destroyed.has(def.id) ? 0 : def.health,
      max: def.health,
    })
  }
  state.healths = healths
  state.revision += 1
}
