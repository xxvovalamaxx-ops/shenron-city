/**
 * Authored destructible props.
 *
 * These are unique game props, not duplicate versions of walls, stalls,
 * office furniture, or route furniture rendered elsewhere. Every definition
 * is consumed by both DestructionSystem and the collision authority.
 */
import type { Vec3 } from '../gameplay/collision'

export type BreakableType = 'crate' | 'desk'

export interface BreakableDef {
  id: string
  type: BreakableType
  pos: Vec3
  size: [number, number, number]
  health: number
  color: string
  innerColor?: string
  fragments?: number
}

export const BREAKABLES: readonly BreakableDef[] = [
  {
    id: 'lobby-security-desk',
    type: 'desk',
    // Side bay, deliberately outside the door-to-elevator sight line.
    pos: { x: 12, y: 0.5, z: -18 },
    size: [3.2, 1, 0.9],
    health: 100,
    color: '#1a1f2e',
    innerColor: '#2a2f3e',
    fragments: 6,
  },
  {
    id: 'plaza-supply-west',
    type: 'crate',
    pos: { x: -12, y: 0.45, z: 20 },
    size: [0.9, 0.9, 0.9],
    health: 55,
    color: '#4b3526',
    innerColor: '#74543a',
    fragments: 7,
  },
  {
    id: 'plaza-supply-east',
    type: 'crate',
    pos: { x: 12, y: 0.45, z: 26 },
    size: [0.9, 0.9, 0.9],
    health: 55,
    color: '#4b3526',
    innerColor: '#74543a',
    fragments: 7,
  },
  {
    id: 'market-supply-tea',
    type: 'crate',
    pos: { x: 19, y: 0.45, z: 82 },
    size: [0.9, 0.9, 0.9],
    health: 55,
    color: '#51392a',
    innerColor: '#7b5b40',
    fragments: 7,
  },
  {
    id: 'market-supply-flowers',
    type: 'crate',
    pos: { x: 19, y: 0.45, z: 90 },
    size: [0.9, 0.9, 0.9],
    health: 55,
    color: '#51392a',
    innerColor: '#7b5b40',
    fragments: 7,
  },
  {
    id: 'market-supply-books',
    type: 'crate',
    pos: { x: 19, y: 0.45, z: 98 },
    size: [0.9, 0.9, 0.9],
    health: 55,
    color: '#51392a',
    innerColor: '#7b5b40',
    fragments: 7,
  },
] as const
