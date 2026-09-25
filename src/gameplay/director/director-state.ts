/**
 * The gameplay director's state: wanted level, the job board and the active
 * job. Module-level like `rt` and `vehicleSim` — there is one game — and
 * mutated only by GameDirector's frame step, so React never re-renders at
 * frame rate. The HUD sees it through `useHud` mirrors.
 */
import { createWanted, setStars, type Observer, type WantedState } from '../wanted/wanted'
import { createDispatch, type DispatchState } from '../wanted/police-dispatch'
import type { MissionDef, MissionState } from '../missions/missions'
import type { SimEvent } from '../vehicles/vehicle-control'

export interface ActiveMission {
  def: MissionDef
  state: MissionState
}

export interface DirectorState {
  wanted: WantedState
  /** Police units on the road. */
  dispatch: DispatchState
  catalog: MissionDef[]
  active: ActiveMission | null
  completed: Set<string>
  /** Seconds before a failed job's pick-up accepts the player again. */
  retryCooldown: number
  /** Vehicle-sim events queued by the game loop since the last director step. */
  inbox: SimEvent[]
  /** Current objective line for the mission HUD, or null. */
  objectiveText: string | null
  /** Seconds left on the job clock, or null when untimed/no job. */
  timeLeft: number | null
  /** Increments whenever objectiveText/timeLeft change (MissionHud polls it). */
  revision: number
}

export const director: DirectorState = {
  wanted: createWanted(),
  dispatch: createDispatch(),
  catalog: [],
  active: null,
  completed: new Set(),
  retryCooldown: 0,
  inbox: [],
  objectiveText: null,
  timeLeft: null,
  revision: 0,
}

/** Called by the game loop with the vehicle events of each frame. */
export function reportVehicleEvents(events: readonly SimEvent[]): void {
  if (events.length === 0) return
  // Bounded: a paused director must not let the queue grow without limit.
  for (const event of events) if (director.inbox.length < 256) director.inbox.push(event)
}

/**
 * Where police officers are and which way they face. The police system
 * registers a provider; until then nobody is watching (crimes are still
 * phoned in by civilians).
 */
let policeProvider: () => readonly Observer[] = () => []

export function setPoliceProvider(provider: () => readonly Observer[]): void {
  policeProvider = provider
}

export function policeObservers(): readonly Observer[] {
  return policeProvider()
}

// Dev-only handle, like `__rt` and `__hud`: inspect or drive the director
// from the console or a capture script.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __director: DirectorState }).__director = director
  ;(globalThis as unknown as { __forceWanted: typeof forceWanted }).__forceWanted = (stars, at) => forceWanted(stars, at)
}

/** Force the wanted level (dev tools, capture scripts). 0 clears it. */
export function forceWanted(stars: number, at: { x: number; z: number }): void {
  director.wanted = stars <= 0 ? createWanted() : setStars(director.wanted, stars, at)
}
