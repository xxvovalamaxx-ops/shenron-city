import type { Vec3 } from './collision'
import { MARKET_KEEPER, PLAZA_WARDEN } from '../world/city-data'
import { HQ, SHAFT, SPAWN } from '../world/layout'

export type DevViewpoint =
  | 'city-entry'
  | 'hero-boulevard'
  | 'night-market-wide'
  | 'night-market-close'
  | 'kai-conversation'
  | 'city-boulevard'
  | 'night-market'
  | 'hq-exterior'
  | 'hq-entrance'
  | 'hq-lobby'
  | 'secretary-close'
  | 'elevator-interior'
  | 'floor45-arrival'
  | 'agent-workstation'
  // Earlier inspection links remain valid while evidence migrates to the
  // canonical production-camera names above.
  | 'elevator'
  | 'floor-45'
  | 'aegis-office'
  // Compatibility aliases retained for existing review links.
  | 'market'
  | 'park'
  | 'plaza'
  | 'lobby'
  | 'hq'

export interface DevInspectionView {
  position: Vec3
  target: Vec3
}

const EYE = SPAWN.y + 1.66

const VIEWS: Readonly<Record<DevViewpoint, DevInspectionView>> = {
  'city-entry': {
    position: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
    target: { x: -2, y: EYE, z: 104 },
  },
  'hero-boulevard': {
    position: { x: -5.8, y: SPAWN.y, z: 123 },
    target: { x: 0, y: 2.2, z: 68 },
  },
  'night-market-wide': {
    position: { x: 5.4, y: SPAWN.y, z: 113 },
    target: { x: 15.4, y: 2.0, z: 88 },
  },
  'night-market-close': {
    position: { x: 13.85, y: SPAWN.y, z: 91.2 },
    target: { x: 13.85, y: 1.42, z: 86 },
  },
  'kai-conversation': {
    position: { x: PLAZA_WARDEN.x + 0.25, y: SPAWN.y, z: PLAZA_WARDEN.z + 2.35 },
    target: { x: PLAZA_WARDEN.x, y: 1.57, z: PLAZA_WARDEN.z },
  },
  'city-boulevard': {
    position: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
    target: { x: 0, y: EYE, z: 88 },
  },
  'night-market': {
    position: { x: 15.8, y: SPAWN.y, z: 110.5 },
    target: { x: 13.1, y: 1.45, z: 88 },
  },
  'hq-exterior': {
    position: { x: 11.5, y: SPAWN.y, z: 36 },
    target: { x: 0, y: 8.5, z: 0 },
  },
  'hq-entrance': {
    position: { x: -3.7, y: SPAWN.y, z: 12.8 },
    target: { x: 0, y: 2.3, z: 0.4 },
  },
  'hq-lobby': {
    position: { x: 6.4, y: SPAWN.y, z: -4 },
    target: { x: -6.5, y: 1.35, z: -13.8 },
  },
  'secretary-close': {
    position: { x: -6.4, y: SPAWN.y, z: -10.6 },
    target: { x: -6.5, y: 1.48, z: -13.8 },
  },
  'elevator-interior': {
    position: { x: 0, y: SPAWN.y, z: SHAFT.doorZ - SHAFT.carDepth / 2 },
    target: { x: 1.25, y: 1.48, z: -31.2 },
  },
  'floor45-arrival': {
    position: { x: 0, y: HQ.y + SPAWN.y, z: -1.5 },
    target: { x: 0, y: HQ.y + 1.58, z: -22 },
  },
  'agent-workstation': {
    position: { x: 3.7, y: HQ.y + SPAWN.y, z: -6 },
    target: { x: 9.2, y: HQ.y + 1.35, z: -6 },
  },
  elevator: {
    position: { x: 5.2, y: SPAWN.y, z: -24.2 },
    target: { x: 0, y: 1.55, z: -30.5 },
  },
  'floor-45': {
    position: { x: 0, y: HQ.y + SPAWN.y, z: 1.8 },
    target: { x: 0, y: HQ.y + 1.55, z: -22 },
  },
  'aegis-office': {
    position: { x: 3.7, y: HQ.y + SPAWN.y, z: -6 },
    target: { x: 9.2, y: HQ.y + 1.35, z: -6 },
  },
  market: {
    position: { x: MARKET_KEEPER.x, y: SPAWN.y, z: MARKET_KEEPER.z + 2.7 },
    target: { x: MARKET_KEEPER.x, y: 1.35, z: MARKET_KEEPER.z },
  },
  park: {
    position: { x: -14.2, y: SPAWN.y, z: 50 },
    target: { x: -19.6, y: 0.85, z: 50.4 },
  },
  plaza: {
    position: { x: PLAZA_WARDEN.x, y: SPAWN.y, z: PLAZA_WARDEN.z + 3.2 },
    target: { x: PLAZA_WARDEN.x, y: 1.4, z: PLAZA_WARDEN.z },
  },
  lobby: {
    position: { x: 0, y: SPAWN.y, z: -5 },
    target: { x: -6.5, y: 1.35, z: -14 },
  },
  hq: {
    position: { x: 0, y: HQ.y + SPAWN.y, z: 0 },
    target: { x: 0, y: HQ.y + 1.55, z: -18 },
  },
}

/**
 * Named, development-only camera views for repeatable visual inspection.
 * Arbitrary coordinates are deliberately unsupported.
 */
export function debugInspectionView(search: string, isDev: boolean): DevInspectionView | null {
  if (!isDev) return null
  const spawn = new URLSearchParams(search).get('spawn') as DevViewpoint | null
  return spawn && spawn in VIEWS ? VIEWS[spawn] : null
}

export function debugSpawnPosition(search: string, isDev: boolean): Vec3 | null {
  return debugInspectionView(search, isDev)?.position ?? null
}

/** Bypass pointer lock only for automated visual review in a Vite dev build. */
export function isDevInspection(search: string, isDev: boolean): boolean {
  return isDev && new URLSearchParams(search).get('inspect') === '1'
}
