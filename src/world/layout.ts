/**
 * The building, as data.
 *
 * Geometry and collision are both generated from this file. That is the point:
 * when a wall moves, its collider moves with it, so the world can never grow an
 * invisible barrier or a walk-through wall. Nothing here imports three.js.
 *
 * Units are metres. +Y is up. The player enters facing -Z.
 */
import { aabb, type AABB } from '../gameplay/collision'
import {
  CITY_GROUND,
  CITY_OBSTACLES,
  STREET_TREES,
  STREET_LIGHTS,
  type CityBox,
} from './city-data'

// ── Key dimensions ───────────────────────────────────────────────────────────

export const LOBBY = {
  halfWidth: 21,
  frontZ: 0, // facade line
  backZ: -30,
  ceiling: 9.5,
} as const

export const HQ = {
  y: 180,
  halfWidth: 16,
  frontZ: 4,
  backZ: -30,
  ceiling: 4.6,
} as const

export const ENTRANCE = {
  halfWidth: 3.4,
  height: 4.4,
  z: 0,
} as const

/** Elevator alcove, recessed into the lobby's back wall. */
export const SHAFT = {
  halfWidth: 2.1,
  doorZ: -30,
  backZ: -35,
  carDepth: 4.4,
  carHeight: 3.4,
} as const

export const SPAWN = { x: -10.7, y: 0.05, z: 145 } as const

export const TOWER = { halfWidth: 26, depth: 40, height: 120 } as const

/** Visible plaza solids shared by the renderer and collision system. */
export const PLAZA_PLANTERS: readonly CityBox[] = [-9, 9].flatMap((x) =>
  [10, 18, 26].map((z) => ({
    id: `plaza-planter-${x}-${z}`,
    x,
    z,
    width: 2.4,
    depth: 2.4,
    height: 0.7,
  })),
)

export const PLAZA_BOLLARDS: readonly CityBox[] = [6, 14, 22, 30].flatMap((z) =>
  [-5, 5].map((x) => ({
    id: `plaza-bollard-${x}-${z}`,
    x,
    z,
    width: 0.22,
    depth: 0.22,
    height: 1.05,
  })),
)

export const ENTRANCE_COLUMNS: readonly CityBox[] = [-1, 1].map((side) => ({
  id: `entrance-column-${side}`,
  x: side * (ENTRANCE.halfWidth + 2),
  z: 5.1,
  width: 0.28,
  depth: 0.28,
  height: ENTRANCE.height + 1.2,
}))

// ── Interaction anchors ──────────────────────────────────────────────────────

export const RECEPTION_DESK = { x: -6.5, z: -13, w: 6.4, d: 1.5, h: 1.12 } as const
export const SECRETARY = { x: -6.5, z: -14.6 } as const
export const PANEL = {
  x: SHAFT.halfWidth - 0.14,
  y: 1.25,
  z: SHAFT.doorZ - SHAFT.carDepth / 2 + 0.9,
} as const

/** Where the six agent offices sit on floor 45. Index order is stable. */
export interface OfficeSlot {
  index: number
  x: number
  z: number
  /** Facing: +1 means the glass front faces +X, -1 faces -X. */
  side: 1 | -1
}

export const OFFICE_SLOTS: readonly OfficeSlot[] = [
  { index: 0, x: -10, z: -6, side: 1 },
  { index: 1, x: -10, z: -14, side: 1 },
  { index: 2, x: -10, z: -22, side: 1 },
  { index: 3, x: 10, z: -6, side: -1 },
  { index: 4, x: 10, z: -14, side: -1 },
  { index: 5, x: 10, z: -22, side: -1 },
]

export const OFFICE = { w: 8.4, d: 6.4, h: 3.2 } as const

// ── Colliders ────────────────────────────────────────────────────────────────

const WALL = 0.5

/**
 * Static world collision.
 *
 * The entrance and elevator openings are gaps in these walls; the doors
 * themselves are dynamic colliders supplied separately by `doorColliders`, so
 * a closed door blocks and an open one does not.
 */
export function staticColliders(): AABB[] {
  const c: AABB[] = []
  const { halfWidth: LW, backZ, ceiling } = LOBBY

  // ── Plaza and lobby floor (one continuous slab) ───────────────────────────
  c.push(
    aabb(
      CITY_GROUND.x,
      -0.5,
      CITY_GROUND.z,
      CITY_GROUND.width,
      1,
      CITY_GROUND.depth,
    ),
  )

  // City solids share their exact authored bounds with the renderer.
  for (const box of CITY_OBSTACLES) {
    c.push(aabb(box.x, box.height / 2, box.z, box.width, box.height, box.depth))
  }

  // ── Facade, split around the entrance opening ─────────────────────────────
  const eh = ENTRANCE.halfWidth
  const sideW = LW - eh
  c.push(aabb(-(eh + sideW / 2), 12, 0, sideW, 24, WALL))
  c.push(aabb(eh + sideW / 2, 12, 0, sideW, 24, WALL))
  // Lintel above the doors.
  c.push(aabb(0, ENTRANCE.height + 2.5, 0, eh * 2, 5, WALL))

  // ── Lobby side walls and ceiling ──────────────────────────────────────────
  c.push(aabb(-LW, ceiling / 2, backZ / 2, WALL, ceiling, Math.abs(backZ)))
  c.push(aabb(LW, ceiling / 2, backZ / 2, WALL, ceiling, Math.abs(backZ)))
  c.push(aabb(0, ceiling, backZ / 2, LW * 2, WALL, Math.abs(backZ)))

  // ── Lobby back wall, split around the elevator opening ────────────────────
  const sh = SHAFT.halfWidth
  const backSideW = LW - sh
  c.push(aabb(-(sh + backSideW / 2), ceiling / 2, backZ, backSideW, ceiling, WALL))
  c.push(aabb(sh + backSideW / 2, ceiling / 2, backZ, backSideW, ceiling, WALL))
  c.push(aabb(0, ceiling - 1.5, backZ, sh * 2, 6.5, WALL)) // lintel over car doors

  // ── Reception desk ────────────────────────────────────────────────────────
  c.push(
    aabb(
      RECEPTION_DESK.x,
      RECEPTION_DESK.h / 2,
      RECEPTION_DESK.z,
      RECEPTION_DESK.w,
      RECEPTION_DESK.h,
      RECEPTION_DESK.d,
    ),
  )

  // ── Lobby columns ─────────────────────────────────────────────────────────
  for (const z of [-7, -15, -23]) {
    for (const x of [-13.5, 13.5]) c.push(aabb(x, 4.75, z, 1.1, 9.5, 1.1))
  }

  // ── Planters framing the approach, so the plaza reads as designed space ───
  for (const planter of PLAZA_PLANTERS) {
    c.push(
      aabb(
        planter.x,
        planter.height / 2,
        planter.z,
        planter.width,
        planter.height,
        planter.depth,
      ),
    )
  }

  // ── Street trees — trunk colliders so you can't walk through them ────────
  for (const tree of STREET_TREES) {
    const trunkDiameter = 0.56 * tree.scale
    const trunkHeight = 2.5 * tree.scale
    c.push(aabb(tree.x, trunkHeight / 2, tree.z, trunkDiameter, trunkHeight, trunkDiameter))
  }

  // ── Street light poles — thin but solid ──────────────────────────────────
  for (const light of STREET_LIGHTS) {
    c.push(aabb(light.x, 2.3, light.z, 0.24, 4.6, 0.24))
  }

  for (const solid of [...PLAZA_BOLLARDS, ...ENTRANCE_COLUMNS]) {
    c.push(
      aabb(
        solid.x,
        solid.height / 2,
        solid.z,
        solid.width,
        solid.height,
        solid.depth,
      ),
    )
  }

  // ── Secretary (Iris) — solid body like Mira ──────────────────────────────
  c.push(aabb(SECRETARY.x, 0.9, SECRETARY.z, 0.7, 1.8, 0.7))

  return c
}

/**
 * Colliders for the elevator car at a given height.
 *
 * The car is a moving room. Its walls and floor are regenerated each frame at
 * the car's current Y so the player is carried by geometry rather than by a
 * parenting hack that would desync from what is drawn.
 */
export function carColliders(carY: number): AABB[] {
  const sh = SHAFT.halfWidth
  const zc = SHAFT.doorZ - SHAFT.carDepth / 2
  const h = SHAFT.carHeight
  return [
    aabb(0, carY - 0.15, zc, sh * 2, 0.3, SHAFT.carDepth), // floor
    aabb(0, carY + h / 2, zc, sh * 2, h, 0.3), // back wall
    aabb(-sh, carY + h / 2, zc, 0.3, h, SHAFT.carDepth), // left
    aabb(sh, carY + h / 2, zc, 0.3, h, SHAFT.carDepth), // right
    aabb(0, carY + h + 0.15, zc, sh * 2, 0.3, SHAFT.carDepth), // ceiling
  ]
}

/**
 * Collider for a pair of sliding doors.
 *
 * `openness` 0 → 1. Fully open contributes nothing, which is what makes
 * walking through an open door possible and through a shut one not.
 */
export function slidingDoorColliders(
  centerX: number,
  y: number,
  z: number,
  halfWidth: number,
  height: number,
  openness: number,
): AABB[] {
  const shut = 1 - Math.min(1, Math.max(0, openness))
  if (shut < 0.02) return []
  const leafW = halfWidth * shut
  return [
    aabb(centerX - halfWidth + leafW / 2, y + height / 2, z, leafW, height, 0.16),
    aabb(centerX + halfWidth - leafW / 2, y + height / 2, z, leafW, height, 0.16),
  ]
}

/** Floor 45's plate, walls and office shells. */
export function hqColliders(): AABB[] {
  const c: AABB[] = []
  const { y, halfWidth: W, frontZ, backZ, ceiling } = HQ
  const depth = Math.abs(backZ - frontZ)
  const midZ = (frontZ + backZ) / 2

  c.push(aabb(0, y - 0.25, midZ, W * 2, 0.5, depth)) // floor plate
  c.push(aabb(0, y + ceiling, midZ, W * 2, 0.4, depth)) // ceiling
  c.push(aabb(-W, y + ceiling / 2, midZ, 0.4, ceiling, depth)) // window wall L
  c.push(aabb(W, y + ceiling / 2, midZ, 0.4, ceiling, depth)) // window wall R
  c.push(aabb(0, y + ceiling / 2, frontZ, W * 2, ceiling, 0.4)) // far end

  // Back wall around the elevator opening.
  const sh = SHAFT.halfWidth
  const sideW = W - sh
  c.push(aabb(-(sh + sideW / 2), y + ceiling / 2, backZ, sideW, ceiling, 0.4))
  c.push(aabb(sh + sideW / 2, y + ceiling / 2, backZ, sideW, ceiling, 0.4))
  c.push(aabb(0, y + ceiling - 0.6, backZ, sh * 2, 1.2, 0.4))

  // Office shells: back wall and two side fins each. The front is glass with a
  // doorway gap, so offices are enterable.
  for (const s of OFFICE_SLOTS) {
    const backX = s.x + (s.side * OFFICE.w) / 2
    c.push(aabb(backX, y + OFFICE.h / 2, s.z, 0.3, OFFICE.h, OFFICE.d))
    for (const dz of [-OFFICE.d / 2, OFFICE.d / 2]) {
      c.push(aabb(s.x, y + OFFICE.h / 2, s.z + dz, OFFICE.w, OFFICE.h, 0.3))
    }
    const frontX = s.x - (s.side * OFFICE.w) / 2
    for (const side of [-1, 1]) {
      const panelZ = s.z + side * (OFFICE.d / 2 - OFFICE.d / 8)
      c.push(aabb(frontX, y + OFFICE.h / 2, panelZ, 0.06, OFFICE.h, OFFICE.d / 4))
    }
    // Desk inside.
    c.push(aabb(s.x + s.side * 1.6, y + 0.55, s.z, 2.6, 1.1, 1.2))
  }

  return c
}
