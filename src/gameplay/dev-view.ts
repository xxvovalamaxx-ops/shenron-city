import type { Vec3 } from './collision'
import { MARKET_KEEPER, PLAZA_WARDEN } from '../world/city-data'
import { HQ, SPAWN } from '../world/layout'

export type DevSpawn = 'market' | 'park' | 'plaza' | 'lobby' | 'hq'

/**
 * Named, development-only camera anchors for repeatable visual inspection.
 * Arbitrary coordinates are deliberately unsupported.
 */
export function debugSpawnPosition(search: string, isDev: boolean): Vec3 | null {
  if (!isDev) return null
  const spawn = new URLSearchParams(search).get('spawn') as DevSpawn | null

  switch (spawn) {
    case 'market':
      return { x: MARKET_KEEPER.x, y: SPAWN.y, z: MARKET_KEEPER.z + 2.7 }
    case 'park':
      return { x: -14.2, y: SPAWN.y, z: 50 }
    case 'plaza':
      return { x: PLAZA_WARDEN.x, y: SPAWN.y, z: PLAZA_WARDEN.z + 3.2 }
    case 'lobby':
      return { x: 0, y: SPAWN.y, z: -5 }
    case 'hq':
      return { x: 0, y: HQ.y + SPAWN.y, z: 0 }
    default:
      return null
  }
}

/** Bypass pointer lock only for automated visual review in a Vite dev build. */
export function isDevInspection(search: string, isDev: boolean): boolean {
  return isDev && new URLSearchParams(search).get('inspect') === '1'
}
