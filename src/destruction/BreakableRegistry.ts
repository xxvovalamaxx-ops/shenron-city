/**
 * Data-driven registry of every destroyable object in the city.
 *
 * Each entry defines a world-space box with health. When the laser deals
 * enough damage, the original mesh hides and N fragments spawn with
 * physics from the impact direction.
 */
import type { Vec3 } from '../gameplay/collision'

export type BreakableType = 'column' | 'desk' | 'bollard' | 'planter' | 'sign' | 'stall' | 'monitor'

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

const COLUMNS = [
  { x: -8, z: -4 }, { x: -8, z: -11 }, { x: -8, z: -18 },
  { x: 8, z: -4 }, { x: 8, z: -11 }, { x: 8, z: -18 },
]

const BOLLARDS = [
  { x: -3, z: 18 }, { x: 3, z: 18 }, { x: -3, z: 24 }, { x: 3, z: 24 },
  { x: -3, z: 30 }, { x: 3, z: 30 }, { x: -3, z: 36 }, { x: 3, z: 36 },
  { x: -3, z: 42 }, { x: 3, z: 42 }, { x: -3, z: 48 }, { x: 3, z: 48 },
]

const PLANTERS = [
  { x: -6, z: 12 }, { x: 6, z: 12 },
]

const SIGNS = [
  { x: -2, z: 70, y: 2.5 }, { x: 2, z: 70, y: 2.5 },
  { x: 0, z: 85, y: 2.5 },
]

const STALLS = [
  { x: 10, z: 75 }, { x: 14, z: 80 },
  { x: 10, z: 90 }, { x: 14, z: 95 },
]

const OFFICE_DESKS = [
  { x: -10, z: -33 }, { x: -3, z: -33 }, { x: 4, z: -33 },
  { x: -10, z: -39 }, { x: -3, z: -39 }, { x: 4, z: -39 },
]

const OFFICE_MONITORS = [
  { x: -10, z: -31 }, { x: 4, z: -31 },
]

export const BREAKABLES: BreakableDef[] = [
  ...COLUMNS.map((c, i) => ({
    id: `col-${i}`,
    type: 'column' as BreakableType,
    pos: { x: c.x, y: 0, z: c.z },
    size: [0.35, 4.2, 0.35] as [number, number, number],
    health: 120,
    color: '#3a4049',
    innerColor: '#5a6070',
    fragments: 8,
  })),
  {
    id: 'desk-reception',
    type: 'desk',
    pos: { x: 0, y: 0.5, z: -8 },
    size: [3.2, 1.0, 0.9] as [number, number, number],
    health: 100,
    color: '#1a1f2e',
    innerColor: '#2a2f3e',
    fragments: 6,
  },
  ...BOLLARDS.map((b, i) => ({
    id: `bollard-${i}`,
    type: 'bollard' as BreakableType,
    pos: { x: b.x, y: 0.4, z: b.z },
    size: [0.15, 0.8, 0.15] as [number, number, number],
    health: 40,
    color: '#4a515c',
    innerColor: '#6a717c',
    fragments: 4,
  })),
  ...PLANTERS.map((p, i) => ({
    id: `planter-${i}`,
    type: 'planter' as BreakableType,
    pos: { x: p.x, y: 0.4, z: p.z },
    size: [1.2, 0.8, 1.2] as [number, number, number],
    health: 80,
    color: '#3a4049',
    innerColor: '#2a3020',
    fragments: 6,
  })),
  ...SIGNS.map((s, i) => ({
    id: `sign-${i}`,
    type: 'sign' as BreakableType,
    pos: { x: s.x, y: s.y, z: s.z },
    size: [1.0, 0.6, 0.08] as [number, number, number],
    health: 25,
    color: '#2dd4bf',
    innerColor: '#1a1f2e',
    fragments: 4,
  })),
  ...STALLS.map((s, i) => ({
    id: `stall-${i}`,
    type: 'stall' as BreakableType,
    pos: { x: s.x, y: 0.6, z: s.z },
    size: [1.8, 1.2, 1.4] as [number, number, number],
    health: 60,
    color: '#4a3020',
    innerColor: '#6a5030',
    fragments: 8,
  })),
  ...OFFICE_DESKS.map((d, i) => ({
    id: `off-desk-${i}`,
    type: 'desk' as BreakableType,
    pos: { x: d.x, y: 0.35, z: d.z },
    size: [1.6, 0.7, 0.8] as [number, number, number],
    health: 70,
    color: '#2a2f3e',
    innerColor: '#3a3f4e',
    fragments: 5,
  })),
  ...OFFICE_MONITORS.map((m, i) => ({
    id: `off-mon-${i}`,
    type: 'monitor' as BreakableType,
    pos: { x: m.x, y: 1.5, z: m.z },
    size: [0.8, 0.5, 0.06] as [number, number, number],
    health: 20,
    color: '#111827',
    innerColor: '#374151',
    fragments: 4,
  })),
]
