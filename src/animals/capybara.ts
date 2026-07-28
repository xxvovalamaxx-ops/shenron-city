import { aabb, type AABB } from '../gameplay/collision'

export const CAPYBARA_MODEL_URL = '/models/animals/capybara/capybara.glb?v=67d2e94e'

export const CAPYBARA_ROUTE = [
  { x: -17.6, z: 49.2 },
  { x: -17.2, z: 51.3 },
  { x: -18.2, z: 52.1 },
  { x: -20.6, z: 52.0 },
  { x: -21.6, z: 51.0 },
  { x: -21.4, z: 49.3 },
  { x: -20.5, z: 48.7 },
  { x: -18.6, z: 48.7 },
] as const

export const CAPYBARA_EXPECTED_CLIPS = [
  'capybara_alert_startle',
  'capybara_drink',
  'capybara_ear_flick_l',
  'capybara_ear_flick_r',
  'capybara_graze',
  'capybara_idle_breathe',
  'capybara_idle_shift',
  'capybara_lie_down',
  'capybara_run',
  'capybara_sit_down',
  'capybara_sit_idle',
  'capybara_sleep',
  'capybara_sniff',
  'capybara_stand_up',
  'capybara_swim',
  'capybara_trot',
  'capybara_turn_l_90',
  'capybara_turn_r_90',
  'capybara_vocalize',
  'capybara_wake_up',
  'capybara_walk',
] as const

export type CapybaraClip = (typeof CAPYBARA_EXPECTED_CLIPS)[number]

export interface CapybaraPose {
  x: number
  z: number
  heading: number
  clip: CapybaraClip
  moving: boolean
}

const WALK_SPEED = 0.55
const START_DWELL = 3.5
const DWELL_BY_POINT: Partial<Record<number, { duration: number; clip: CapybaraClip }>> = {
  2: { duration: 6, clip: 'capybara_graze' },
  5: { duration: 2.5, clip: 'capybara_sniff' },
}

function segmentLength(index: number): number {
  const from = CAPYBARA_ROUTE[index]
  const to = CAPYBARA_ROUTE[(index + 1) % CAPYBARA_ROUTE.length]
  return Math.hypot(to.x - from.x, to.z - from.z)
}

function segmentHeading(index: number): number {
  const from = CAPYBARA_ROUTE[index]
  const to = CAPYBARA_ROUTE[(index + 1) % CAPYBARA_ROUTE.length]
  return Math.atan2(to.x - from.x, to.z - from.z)
}

export const CAPYBARA_CYCLE_SECONDS =
  START_DWELL +
  CAPYBARA_ROUTE.reduce((total, _, index) => total + segmentLength(index) / WALK_SPEED, 0) +
  Object.values(DWELL_BY_POINT).reduce((total, dwell) => total + (dwell?.duration ?? 0), 0)

export const CAPYBARA_INITIAL_POSE: CapybaraPose = {
  ...CAPYBARA_ROUTE[0],
  heading: segmentHeading(0),
  clip: 'capybara_idle_breathe',
  moving: false,
}

/** Deterministic route and behaviour state used by both rendering and collision. */
export function capybaraPose(elapsed: number): CapybaraPose {
  let remaining = ((elapsed % CAPYBARA_CYCLE_SECONDS) + CAPYBARA_CYCLE_SECONDS) %
    CAPYBARA_CYCLE_SECONDS

  if (remaining < START_DWELL) return { ...CAPYBARA_INITIAL_POSE }
  remaining -= START_DWELL

  for (let index = 0; index < CAPYBARA_ROUTE.length; index++) {
    const from = CAPYBARA_ROUTE[index]
    const nextIndex = (index + 1) % CAPYBARA_ROUTE.length
    const to = CAPYBARA_ROUTE[nextIndex]
    const duration = segmentLength(index) / WALK_SPEED
    const heading = segmentHeading(index)

    if (remaining < duration) {
      const t = remaining / duration
      return {
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
        heading,
        clip: 'capybara_walk',
        moving: true,
      }
    }
    remaining -= duration

    const dwell = DWELL_BY_POINT[nextIndex]
    if (dwell && remaining < dwell.duration) {
      return {
        ...to,
        heading,
        clip: dwell.clip,
        moving: false,
      }
    }
    if (dwell) remaining -= dwell.duration
  }

  return { ...CAPYBARA_INITIAL_POSE }
}

const HALF_WIDTH = 0.23
const HALF_LENGTH = 0.62
const COLLISION_PADDING = 0.04
const HEIGHT = 0.58

/** Conservative yaw-aware box matching the visible animal's world transform. */
export function capybaraCollider(pose: CapybaraPose): AABB {
  const sin = Math.abs(Math.sin(pose.heading))
  const cos = Math.abs(Math.cos(pose.heading))
  const halfX = cos * HALF_WIDTH + sin * HALF_LENGTH + COLLISION_PADDING
  const halfZ = sin * HALF_WIDTH + cos * HALF_LENGTH + COLLISION_PADDING
  return aabb(pose.x, HEIGHT / 2, pose.z, halfX * 2, HEIGHT, halfZ * 2)
}
