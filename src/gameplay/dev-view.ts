/**
 * Manhattan viewpoints for dev inspection via `?spawn=<id>`.
 */
import type { Vec3 } from './collision'

export type DevViewpoint =
  | 'midtown-street'
  | 'times-square'
  | 'central-park'
  | 'skyline-south'
  | 'statue-of-liberty'
  | 'financial'
  | 'soho'
  | 'midtown-east'
  | 'harbor'
  | 'aerial-midtown'

export interface DevInspectionView {
  position: Vec3
  target: Vec3
}

const GROUND = 12.4

const VIEWS: Readonly<Record<DevViewpoint, DevInspectionView>> = {
  'midtown-street': {
    position: { x: 400, y: GROUND + 1.7, z: 400 },
    target: { x: 300, y: GROUND + 1.5, z: 200 },
  },
  'times-square': {
    position: { x: 300, y: GROUND + 1.7, z: 100 },
    target: { x: 100, y: GROUND + 1.5, z: -200 },
  },
  'central-park': {
    position: { x: 0, y: GROUND + 1.7, z: 3000 },
    target: { x: 0, y: GROUND + 1.5, z: 2700 },
  },
  'skyline-south': {
    position: { x: 600, y: GROUND + 90, z: -4500 },
    target: { x: 0, y: GROUND + 40, z: -2000 },
  },
  'statue-of-liberty': {
    position: { x: -6447, y: GROUND + 1.7, z: -10034 },
    target: { x: -6410, y: GROUND + 12, z: -10010 },
  },
  financial: {
    position: { x: -500, y: GROUND + 1.7, z: -4000 },
    target: { x: -800, y: GROUND + 1.5, z: -4300 },
  },
  soho: {
    position: { x: -1200, y: GROUND + 1.7, z: -1000 },
    target: { x: -1500, y: GROUND + 1.5, z: -1300 },
  },
  'midtown-east': {
    position: { x: 1500, y: GROUND + 1.7, z: 300 },
    target: { x: 1200, y: GROUND + 1.5, z: 0 },
  },
  harbor: {
    position: { x: 3000, y: GROUND + 2, z: -6000 },
    target: { x: 2600, y: GROUND + 1.5, z: -6300 },
  },
  'aerial-midtown': {
    position: { x: 0, y: GROUND + 320, z: 900 },
    target: { x: 0, y: GROUND + 8, z: -300 },
  },
}

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
