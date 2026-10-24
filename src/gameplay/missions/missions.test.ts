import { describe, expect, it } from 'vitest'
import {
  atMissionStart,
  idleMission,
  objectiveTarget,
  startMission,
  stepMission,
  timeRemaining,
  type MissionDef,
  type MissionEvent,
  type MissionState,
  type WorldSnapshot,
} from './missions'

const JOYRIDE: MissionDef = {
  id: 'joyride',
  title: 'Joyride',
  start: { x: 0, z: 0 },
  objectives: [
    { kind: 'enter-vehicle', text: 'Steal a car.' },
    { kind: 'drive-to', text: 'Take it to the garage.', at: { x: 100, z: 0 }, radius: 6, stopBelowKmh: 10 },
  ],
  timeLimit: 60,
  reward: 500,
}

const RACE: MissionDef = {
  id: 'race',
  title: 'Street Race',
  start: { x: 0, z: 0 },
  objectives: [
    { kind: 'checkpoints', text: 'Hit every checkpoint.', points: [{ x: 10, z: 0 }, { x: 20, z: 0 }, { x: 30, z: 0 }], radius: 4 },
  ],
  reward: 1000,
}

const HEAT: MissionDef = {
  id: 'heat',
  title: 'Heat',
  start: { x: 0, z: 0 },
  objectives: [
    { kind: 'get-wanted', text: 'Get two stars.', stars: 2 },
    { kind: 'lose-wanted', text: 'Lose the cops.' },
  ],
  failOnWanted: true,
  reward: 750,
}

const snap = (over: Partial<WorldSnapshot> = {}): WorldSnapshot => ({
  player: { x: 0, z: 0 },
  vehicleKind: null,
  speedKmh: 0,
  wantedStars: 0,
  dt: 0.1,
  ...over,
})

function drive(def: MissionDef, frames: Partial<WorldSnapshot>[]) {
  let { state, events } = startMission(def)
  const all: MissionEvent[] = [...events]
  for (const f of frames) {
    ;({ state, events } = stepMission(def, state, snap(f)))
    all.push(...events)
  }
  return { state, events: all }
}

describe('missions', () => {
  it('starts with the title and the first objective', () => {
    const { state, events } = startMission(JOYRIDE)
    expect(state.status).toBe('active')
    expect(events.map((e) => e.type)).toEqual(['started', 'objective'])
  })

  it('plays a joyride from theft to delivery and pays out', () => {
    const { state, events } = drive(JOYRIDE, [
      {},
      { vehicleKind: 'sedan' },
      { vehicleKind: 'sedan', player: { x: 100, z: 0 }, speedKmh: 60 }, // too fast to count
      { vehicleKind: 'sedan', player: { x: 101, z: 1 }, speedKmh: 4 },
    ])
    expect(state.status).toBe('passed')
    expect(events.at(-1)).toEqual({ type: 'passed', missionId: 'joyride', title: 'Joyride', reward: 500 })
  })

  it('does not count a delivery on foot', () => {
    const { state } = drive(JOYRIDE, [{ vehicleKind: 'sedan' }, { player: { x: 100, z: 0 } }])
    expect(state.status).toBe('active')
    expect(state.objective).toBe(1)
  })

  it('fails when the clock runs out', () => {
    const frames = Array.from({ length: 601 }, () => ({ dt: 0.1 }))
    const { state, events } = drive(JOYRIDE, frames)
    expect(state.status).toBe('failed')
    expect(events.at(-1)?.type).toBe('failed')
  })

  it('clears checkpoints in order, one per step', () => {
    const { state, events } = drive(RACE, [
      { player: { x: 30, z: 0 } }, // last checkpoint first: ignored
      { player: { x: 10, z: 0 } },
      { player: { x: 20, z: 0 } },
      { player: { x: 30, z: 0 } },
    ])
    expect(events.filter((e) => e.type === 'checkpoint').map((e) => (e as { index: number }).index)).toEqual([1, 2, 3])
    expect(state.status).toBe('passed')
  })

  it('points markers and GPS at the next checkpoint', () => {
    const { state } = drive(RACE, [{ player: { x: 10, z: 0 } }])
    expect(objectiveTarget(RACE, state)).toEqual({ x: 20, z: 0 })
  })

  it('lets a wanted-level objective run inside a clean job without failing it', () => {
    const { state } = drive(HEAT, [{ wantedStars: 1 }, { wantedStars: 2 }, { wantedStars: 2 }, { wantedStars: 0 }])
    expect(state.status).toBe('passed')
  })

  it('reports the remaining time only for timed missions', () => {
    const { state } = startMission(JOYRIDE)
    expect(timeRemaining(JOYRIDE, state)).toBe(60)
    expect(timeRemaining(RACE, startMission(RACE).state)).toBeNull()
  })

  it('ignores steps for idle or foreign missions', () => {
    const idle: MissionState = idleMission()
    expect(stepMission(JOYRIDE, idle, snap()).state).toBe(idle)
    const race = startMission(RACE).state
    expect(stepMission(JOYRIDE, race, snap()).state).toBe(race)
  })

  it('detects the pick-up corona', () => {
    expect(atMissionStart(JOYRIDE, { x: 1, z: 1 })).toBe(true)
    expect(atMissionStart(JOYRIDE, { x: 10, z: 0 })).toBe(false)
  })
})
