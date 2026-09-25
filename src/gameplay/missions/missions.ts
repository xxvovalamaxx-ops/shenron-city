/**
 * Missions: an ordered list of objectives, a timer, a reward.
 *
 * Renderer-free and deterministic. A mission is plain data; `stepMission`
 * advances the active one from a snapshot of the world (where the player is,
 * whether they are driving, their wanted level) and returns the events the
 * HUD, audio and world markers react to. Nothing here reads a clock, a random
 * source or the scene graph, so a mission can be played back from a recorded
 * stream of snapshots in a unit test exactly as it plays in the game.
 */

export interface Vec2 {
  x: number
  z: number
}

export type Objective =
  /** Walk or drive into a marker. */
  | { kind: 'goto'; text: string; at: Vec2; radius: number }
  /** Get behind the wheel of any vehicle (or one of `vehicleKinds`). */
  | { kind: 'enter-vehicle'; text: string; vehicleKinds?: readonly string[] }
  /** Deliver a vehicle into a marker and come to a near stop. */
  | { kind: 'drive-to'; text: string; at: Vec2; radius: number; stopBelowKmh: number }
  /** Pass through every checkpoint in order. */
  | { kind: 'checkpoints'; text: string; points: readonly Vec2[]; radius: number }
  /** Reach at least this many stars. */
  | { kind: 'get-wanted'; text: string; stars: number }
  /** Lose the police completely. */
  | { kind: 'lose-wanted'; text: string }
  /** Stay alive and free for a while. */
  | { kind: 'survive'; text: string; seconds: number }

export interface MissionDef {
  id: string
  title: string
  /** Where the mission is picked up (the yellow corona). */
  start: Vec2
  objectives: readonly Objective[]
  /** Optional overall time limit, seconds. */
  timeLimit?: number
  /** Fail if the player gets any wanted level (a "clean" job). */
  failOnWanted?: boolean
  /** Cash on success. */
  reward: number
}

export interface WorldSnapshot {
  player: Vec2
  /** Vehicle kind the player is driving, or null on foot. */
  vehicleKind: string | null
  speedKmh: number
  wantedStars: number
  dt: number
}

export type MissionStatus = 'idle' | 'active' | 'passed' | 'failed'

export interface MissionState {
  status: MissionStatus
  missionId: string | null
  objective: number
  /** Next checkpoint index for a `checkpoints` objective. */
  checkpoint: number
  /** Seconds into the current objective. */
  objectiveTime: number
  /** Seconds into the mission. */
  elapsed: number
  failReason: string | null
}

export type MissionEvent =
  | { type: 'started'; missionId: string; title: string }
  | { type: 'objective'; text: string; index: number }
  | { type: 'checkpoint'; index: number; of: number }
  | { type: 'passed'; missionId: string; title: string; reward: number }
  | { type: 'failed'; missionId: string; title: string; reason: string }

export function idleMission(): MissionState {
  return {
    status: 'idle',
    missionId: null,
    objective: 0,
    checkpoint: 0,
    objectiveTime: 0,
    elapsed: 0,
    failReason: null,
  }
}

/** Radius of the pick-up corona players walk or drive into to start a job. */
export const START_RADIUS = 3.5

function within(a: Vec2, b: Vec2, r: number): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) <= r
}

export function startMission(def: MissionDef): { state: MissionState; events: MissionEvent[] } {
  const first = def.objectives[0]
  return {
    state: { ...idleMission(), status: 'active', missionId: def.id },
    events: [
      { type: 'started', missionId: def.id, title: def.title },
      ...(first ? [{ type: 'objective' as const, text: first.text, index: 0 }] : []),
    ],
  }
}

/** Where the active objective wants the player to go, for markers and GPS. */
export function objectiveTarget(def: MissionDef, state: MissionState): Vec2 | null {
  if (state.status !== 'active') return null
  const o = def.objectives[state.objective]
  if (!o) return null
  switch (o.kind) {
    case 'goto':
    case 'drive-to':
      return o.at
    case 'checkpoints':
      return o.points[state.checkpoint] ?? null
    default:
      return null
  }
}

/** Seconds left on the mission clock, or null when untimed. */
export function timeRemaining(def: MissionDef, state: MissionState): number | null {
  if (def.timeLimit === undefined || state.status !== 'active') return null
  return Math.max(0, def.timeLimit - state.elapsed)
}

function objectiveDone(
  o: Objective,
  state: MissionState,
  world: WorldSnapshot,
): { done: boolean; checkpoint: number; events: MissionEvent[] } {
  switch (o.kind) {
    case 'goto':
      return { done: within(world.player, o.at, o.radius), checkpoint: 0, events: [] }
    case 'enter-vehicle':
      return {
        done: world.vehicleKind !== null && (!o.vehicleKinds || o.vehicleKinds.includes(world.vehicleKind)),
        checkpoint: 0,
        events: [],
      }
    case 'drive-to':
      return {
        done: world.vehicleKind !== null && within(world.player, o.at, o.radius) && world.speedKmh <= o.stopBelowKmh,
        checkpoint: 0,
        events: [],
      }
    case 'checkpoints': {
      let next = state.checkpoint
      const events: MissionEvent[] = []
      // One per step: a checkpoint cleared this step never also clears the next.
      if (next < o.points.length && within(world.player, o.points[next], o.radius)) {
        next += 1
        events.push({ type: 'checkpoint', index: next, of: o.points.length })
      }
      return { done: next >= o.points.length, checkpoint: next, events }
    }
    case 'get-wanted':
      return { done: world.wantedStars >= o.stars, checkpoint: 0, events: [] }
    case 'lose-wanted':
      return { done: world.wantedStars === 0, checkpoint: 0, events: [] }
    case 'survive':
      return { done: state.objectiveTime + world.dt >= o.seconds, checkpoint: 0, events: [] }
  }
}

/**
 * Advance the active mission by one snapshot. Idle, passed and failed states
 * are returned unchanged (same object) with no events.
 */
export function stepMission(
  def: MissionDef,
  state: MissionState,
  world: WorldSnapshot,
): { state: MissionState; events: MissionEvent[] } {
  if (state.status !== 'active' || state.missionId !== def.id) return { state, events: [] }

  const elapsed = state.elapsed + world.dt
  const fail = (reason: string) => ({
    state: { ...state, status: 'failed' as const, elapsed, failReason: reason },
    events: [{ type: 'failed' as const, missionId: def.id, title: def.title, reason }],
  })

  if (def.timeLimit !== undefined && elapsed > def.timeLimit) return fail('Out of time.')
  const current = def.objectives[state.objective]
  const wantedIsTheJob = current?.kind === 'get-wanted' || current?.kind === 'lose-wanted'
  if (def.failOnWanted && world.wantedStars > 0 && !wantedIsTheJob) return fail('The cops got involved.')

  if (!current) {
    return {
      state: { ...state, status: 'passed', elapsed },
      events: [{ type: 'passed', missionId: def.id, title: def.title, reward: def.reward }],
    }
  }

  const result = objectiveDone(current, state, world)
  if (!result.done) {
    return {
      state: { ...state, elapsed, objectiveTime: state.objectiveTime + world.dt, checkpoint: result.checkpoint },
      events: result.events,
    }
  }

  const nextIndex = state.objective + 1
  const next = def.objectives[nextIndex]
  if (!next) {
    return {
      state: { ...state, status: 'passed', elapsed, objective: nextIndex, checkpoint: 0, objectiveTime: 0 },
      events: [...result.events, { type: 'passed', missionId: def.id, title: def.title, reward: def.reward }],
    }
  }
  return {
    state: { ...state, elapsed, objective: nextIndex, checkpoint: 0, objectiveTime: 0 },
    events: [...result.events, { type: 'objective', text: next.text, index: nextIndex }],
  }
}

/** True when the player is standing in (or driving into) a mission's pick-up. */
export function atMissionStart(def: MissionDef, player: Vec2): boolean {
  return within(player, def.start, START_RADIUS)
}
