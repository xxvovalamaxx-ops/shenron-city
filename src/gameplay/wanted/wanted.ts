/**
 * The wanted level: crimes → heat → stars → police response → evasion.
 *
 * Renderer-free and deterministic, like the rest of the simulation. The game
 * loop reports crimes and whether any police unit can currently see the
 * player; this module owns everything else. The model follows the GTA V/VI
 * rules players already know:
 *
 *   - A crime adds heat. Heat thresholds map to 1–5 stars, and the level only
 *     ever rises while the police have eyes on you.
 *   - While a unit sees you, the stars are solid and the last-known position
 *     tracks you.
 *   - Lose line of sight and the stars flash: the police search a circle
 *     around your last-known position. Get outside that circle and stay
 *     unseen for the escape time and the whole level clears at once.
 *   - Being spotted again (or committing a crime while hidden) re-centres the
 *     search on you and cancels the escape.
 *
 * Nothing here reads a clock or a random source: `stepWanted` is a pure
 * function of (state, sighting, player position, dt).
 */

export interface Vec2 {
  x: number
  z: number
}

export type Crime =
  /** Took a parked or abandoned car that was not the player's. */
  | 'vehicle-theft'
  /** Pulled a driver out of a car in traffic. */
  | 'carjack'
  /** Ran into a pedestrian with a vehicle. */
  | 'hit-pedestrian'
  /** Rammed a civilian vehicle. */
  | 'hit-vehicle'
  /** Rammed a police vehicle. */
  | 'hit-police-vehicle'
  /** Struck a pedestrian on foot. */
  | 'assault'
  /** Struck or rammed a police officer. */
  | 'assault-police'

/**
 * Heat a crime adds when the police witness it. Civilian reports land at
 * {@link CIVILIAN_REPORT_FACTOR} of this. Tuned against {@link STAR_HEAT} so
 * a single witnessed carjack is one star, running someone over is one star
 * edging toward two, and ramming a cruiser is an immediate two.
 */
export const CRIME_HEAT: Readonly<Record<Crime, number>> = {
  'vehicle-theft': 12,
  carjack: 20,
  'hit-pedestrian': 30,
  'hit-vehicle': 6,
  'hit-police-vehicle': 45,
  assault: 18,
  'assault-police': 60,
}

/** Minimum heat for 1..5 stars. Index 0 is one star. */
export const STAR_HEAT: readonly number[] = [10, 45, 110, 220, 380]

/** Unwitnessed crimes still get reported, at a fraction of the heat. */
export const CIVILIAN_REPORT_FACTOR = 0.55

/** Radius of the search circle around the last-known position, by stars. */
export const SEARCH_RADIUS: readonly number[] = [0, 120, 170, 230, 300, 380]

/** Seconds outside the circle, unseen, to lose the level, by stars. */
export const ESCAPE_TIME: readonly number[] = [0, 7, 11, 16, 22, 30]

/** Police cars the dispatcher tries to keep in play, by stars. */
export const POLICE_UNITS: readonly number[] = [0, 1, 2, 4, 6, 8]

export const MAX_STARS = 5

export interface WantedState {
  /** Accumulated heat; decides the star level. Reset when the level clears. */
  heat: number
  /** 0..5. */
  stars: number
  /** True while at least one unit had eyes on the player this step. */
  seen: boolean
  /** Where the police last saw (or were told about) the player. */
  lastKnown: Vec2 | null
  /** Seconds since the police last saw the player. */
  unseenFor: number
  /** Seconds spent outside the search circle while unseen. */
  escapeProgress: number
  /** Total seconds with a non-zero level this episode (for mission scoring). */
  episodeTime: number
}

export function createWanted(): WantedState {
  return {
    heat: 0,
    stars: 0,
    seen: false,
    lastKnown: null,
    unseenFor: 0,
    escapeProgress: 0,
    episodeTime: 0,
  }
}

/** Stars for a heat value, before the "never drops while seen" rule. */
export function starsForHeat(heat: number): number {
  let stars = 0
  for (let i = 0; i < STAR_HEAT.length; i++) {
    if (heat >= STAR_HEAT[i]) stars = i + 1
  }
  return stars
}

export interface CrimeReport {
  crime: Crime
  at: Vec2
  /** True if a police unit saw it happen. */
  witnessedByPolice: boolean
}

/**
 * Register a crime. Returns a new state; the input is not mutated.
 *
 * A witnessed crime pins the last-known position on the scene; a reported
 * one does too (the caller phoned it in), which is what makes committing a
 * crime while hiding such a bad idea.
 */
export function reportCrime(state: WantedState, report: CrimeReport): WantedState {
  const base = CRIME_HEAT[report.crime]
  const heat = state.heat + (report.witnessedByPolice ? base : base * CIVILIAN_REPORT_FACTOR)
  const stars = Math.min(MAX_STARS, Math.max(state.stars, starsForHeat(heat)))
  return {
    ...state,
    heat,
    stars,
    lastKnown: stars > 0 ? { x: report.at.x, z: report.at.z } : state.lastKnown,
    unseenFor: report.witnessedByPolice ? 0 : state.unseenFor,
    escapeProgress: 0,
  }
}

/** Force a level (dev tools, scripted mission beats). */
export function setStars(state: WantedState, stars: number, at: Vec2): WantedState {
  const clamped = Math.max(0, Math.min(MAX_STARS, Math.round(stars)))
  if (clamped === 0) return createWanted()
  return {
    ...state,
    stars: clamped,
    heat: Math.max(state.heat, STAR_HEAT[clamped - 1]),
    lastKnown: { x: at.x, z: at.z },
    escapeProgress: 0,
  }
}

export interface WantedStep {
  /** Any police unit has line of sight to the player this step. */
  spotted: boolean
  player: Vec2
  dt: number
}

/**
 * Advance the wanted level by one step.
 *
 * Returns the same object when nothing can change (no level), so callers can
 * cheaply compare by reference before mirroring to the HUD.
 */
export function stepWanted(state: WantedState, step: WantedStep): WantedState {
  if (state.stars === 0) return state

  const dt = Math.max(0, step.dt)
  if (step.spotted) {
    return {
      ...state,
      seen: true,
      lastKnown: { x: step.player.x, z: step.player.z },
      unseenFor: 0,
      escapeProgress: 0,
      episodeTime: state.episodeTime + dt,
    }
  }

  const centre = state.lastKnown ?? step.player
  const outside = Math.hypot(step.player.x - centre.x, step.player.z - centre.z) > SEARCH_RADIUS[state.stars]
  // Inside the circle the escape clock holds rather than resetting: slipping
  // back in for a moment should cost time, not the whole run.
  const escapeProgress = outside ? state.escapeProgress + dt : state.escapeProgress
  if (escapeProgress >= ESCAPE_TIME[state.stars]) return createWanted()

  return {
    ...state,
    seen: false,
    unseenFor: state.unseenFor + dt,
    escapeProgress,
    episodeTime: state.episodeTime + dt,
  }
}

/** True while the HUD should flash the stars (police searching, not seeing). */
export function isSearching(state: WantedState): boolean {
  return state.stars > 0 && !state.seen && state.lastKnown !== null
}

/** 0..1 progress toward losing the level, for a HUD ring or audio cue. */
export function escapeFraction(state: WantedState): number {
  if (state.stars === 0) return 0
  return Math.min(1, state.escapeProgress / ESCAPE_TIME[state.stars])
}

// ── Sight ────────────────────────────────────────────────────────────────────

/** How far an officer in a car can see the player, metres. */
export const SIGHT_RANGE = 85
/** Within this range the player is noticed regardless of occlusion. */
export const HEARING_RANGE = 14
/** Half-angle of an officer's forward field of view, radians. */
export const SIGHT_HALF_ANGLE = (75 * Math.PI) / 180

export interface Observer {
  pos: Vec2
  /** Facing, unit vector on the ground plane. */
  forward: Vec2
}

/**
 * Can this observer see the player? `occluded(a, b)` answers whether solid
 * world blocks the segment — the caller supplies it (a BVH ray in game, AABBs
 * in tests), which keeps this module free of the renderer.
 */
export function canSee(
  observer: Observer,
  player: Vec2,
  occluded: (from: Vec2, to: Vec2) => boolean,
): boolean {
  const dx = player.x - observer.pos.x
  const dz = player.z - observer.pos.z
  const distance = Math.hypot(dx, dz)
  if (distance <= HEARING_RANGE) return true
  if (distance > SIGHT_RANGE) return false
  const facing = (dx * observer.forward.x + dz * observer.forward.z) / distance
  if (facing < Math.cos(SIGHT_HALF_ANGLE)) return false
  return !occluded(observer.pos, player)
}
