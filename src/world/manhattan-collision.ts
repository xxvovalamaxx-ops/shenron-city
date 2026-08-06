/**
 * Collision and navigation support for the streamed Manhattan island.
 *
 * The exported city is a handful of large merged meshes per tile
 * (BLD_lowrise/midrise/towers, ROAD, TREE, plus the base's LAND_* ground).
 * Precise per-building boxes are impossible without cutting the meshes, so we
 * use a BVH per building mesh: ground height comes from downward raycasts
 * against the LAND_* islands, and movement is swept against the BLD_* BVHs.
 *
 * Everything here is imperative on purpose — the tile loader registers and
 * unregisters meshes as they stream in, and the game loop queries it at frame
 * rate without touching React.
 */
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { PLAYER_RADIUS } from '../gameplay/collision'
import type { Vec3 } from '../gameplay/collision'
import { cityWorld } from '../city/registry.js'

interface BvhEntry {
  mesh: THREE.Mesh
  bvh: MeshBVH
}

const GROUND_RAY_START_Y = 320
const INSIDE_PROBE_Y = 6

/** three-mesh-bvh raycastFirst signature: (ray, materialOrSide, near, far). */
function raycastFirst(bvh: MeshBVH, ray: THREE.Ray, far: number, side: THREE.Side = THREE.FrontSide) {
  return bvh.raycastFirst(ray, side, 0, far)
}

class ManhattanCollision {
  /** LAND_* island meshes from the base GLB. Used for height raycasts. */
  readonly groundMeshes: THREE.Mesh[] = []
  /** BLD_* meshes from every loaded tile, each with a built BVH. */
  readonly buildingBvhs: BvhEntry[] = []
  baseReady = false

  registerGround(mesh: THREE.Mesh): void {
    if (this.groundMeshes.includes(mesh)) return
    this.groundMeshes.push(mesh)
  }

  unregisterGround(mesh: THREE.Mesh): void {
    const i = this.groundMeshes.indexOf(mesh)
    if (i >= 0) this.groundMeshes.splice(i, 1)
  }

  registerTileBuildings(root: THREE.Group): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const name = object.name.toUpperCase()
      if (!name.startsWith('BLD_')) return
      const geometry = object.geometry
      if (!geometry.attributes.position || geometry.attributes.position.count < 3) return
      const bvh = new MeshBVH(geometry, { strategy: 2 })
      this.buildingBvhs.push({ mesh: object, bvh })
    })
  }

  unregisterTileBuildings(root: THREE.Group): void {
    const doomed = new Set<THREE.Mesh>()
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) doomed.add(object)
    })
    for (let i = this.buildingBvhs.length - 1; i >= 0; i--) {
      if (doomed.has(this.buildingBvhs[i].mesh)) this.buildingBvhs.splice(i, 1)
    }
  }

  clearBase(): void {
    this.groundMeshes.length = 0
    this.buildingBvhs.length = 0
    this.baseReady = false
  }

  private groundRay = new THREE.Ray()
  private down = new THREE.Vector3(0, -1, 0)

  /**
   * Height of the island surface below (x, z), or null over water / outside
   * the loaded base. Streets and building plinths sit on this surface.
   *
   * The base landmass is one very coarse mesh (a few thousand triangles over
   * the whole island), and the exporter's winding is not consistent across
   * it — front-facing only casts miss whole districts. For a ground
   * height-field the back face is still the surface, so both sides count.
   */
  groundHeightAt(x: number, z: number): number | null {
    if (this.groundMeshes.length === 0) return null
    let best: number | null = null
    this.groundRay.origin.set(x, GROUND_RAY_START_Y, z)
    this.groundRay.direction.copy(this.down)
    for (const mesh of this.groundMeshes) {
      const bvh = mesh.geometry.boundsTree
      if (!bvh) continue
      const hit = raycastFirst(bvh, this.groundRay, GROUND_RAY_START_Y + 100, THREE.DoubleSide)
      if (hit) {
        const y = hit.point.y
        // Sane surface band: the island sits at 11.5-12 and the seabed above
        // 0; a hit below the seabed or above any terrain is geometry noise
        // (partially-decoded meshes, backfaces of coarse LODs) — never a
        // surface the player can stand on.
        if (y < 0 || y > 60) continue
        if (best === null || y > best) best = y
      }
    }
    return best
  }

  /**
   * Highest building surface below (x, z), or null when no building covers
   * the point. Used by fly mode so a descent lands on a roof instead of
   * dropping through it into the tower.
   */
  buildingTopAt(x: number, z: number): number | null {
    if (this.buildingBvhs.length === 0) return null
    let best: number | null = null
    this.groundRay.origin.set(x, GROUND_RAY_START_Y, z)
    this.groundRay.direction.copy(this.down)
    for (const { bvh } of this.buildingBvhs) {
      const hit = raycastFirst(bvh, this.groundRay, GROUND_RAY_START_Y + 100, THREE.DoubleSide)
      if (hit) {
        const y = hit.point.y
        if (best === null || y > best) best = y
      }
    }
    return best
  }

  /**
   * Is the point's horizontal slice inside any building? Used to reject spawn
   * candidates that landed under a tower.
   */
  isInsideBuilding(x: number, groundY: number, z: number): boolean {
    this.groundRay.origin.set(x, groundY + 0.2, z)
    this.groundRay.direction.set(0, 1, 0)
    for (const { bvh } of this.buildingBvhs) {
      const hit = raycastFirst(bvh, this.groundRay, INSIDE_PROBE_Y)
      if (hit && hit.point.y - groundY < INSIDE_PROBE_Y) return true
    }
    return false
  }

  private moveRay = new THREE.Ray()
  private moveDir = new THREE.Vector3()

  /**
   * Sweep a horizontal move from `from` by (dx, dz) against buildings,
   * sliding along walls by resolving axes independently. Returns the furthest
   * legal position. Ground height is applied by the caller. The radius is
   * the footprint of whoever is moving — the player capsule by default,
   * vehicles pass their own half-width.
   */
  move(from: Vec3, dx: number, dz: number, radius: number = PLAYER_RADIUS): Vec3 {
    const out = { x: from.x, y: from.y, z: from.z }
    const origin = new THREE.Vector3(from.x, from.y + 0.5, from.z)

    const attempt = (mx: number, mz: number): boolean => {
      const length = Math.hypot(mx, mz)
      if (length < 1e-5) return true
      this.moveDir.set(mx, 0, mz).normalize()
      this.moveRay.origin.copy(origin)
      this.moveRay.direction.copy(this.moveDir)
      let closest = length
      for (const { bvh } of this.buildingBvhs) {
        const hit = raycastFirst(bvh, this.moveRay, length)
        if (hit && hit.distance < closest && hit.distance > 0.001) closest = hit.distance
      }
      if (closest >= length) {
        out.x += mx
        out.z += mz
        origin.x = out.x
        origin.z = out.z
        return true
      }
      // Consume the legal prefix only; the caller retries the remaining
      // displacement on the other axis so diagonal contact slides along the
      // wall instead of stopping.
      const ratio = Math.max(0, closest - radius - 0.02) / length
      out.x += mx * ratio
      out.z += mz * ratio
      origin.x = out.x
      origin.z = out.z
      return false
    }

    // Axis-separated resolution: each axis is swept on its own, so movement
    // into a wall at an angle keeps the tangential component (sliding), and
    // corner contact resolves one axis at a time.
    attempt(dx, 0)
    attempt(0, dz)
    return out
  }

  private castRay = new THREE.Ray()

  /**
   * Distance along `direction` from `origin` to the first building hit,
   * capped at `maxDistance`. Used by the vehicle chase camera boom so the
   * camera pulls in before geometry, exactly like the walk boom's colliders.
   */
  castDistance(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    startYOffset = 0.5,
  ): number {
    this.castRay.origin.set(origin.x, origin.y + startYOffset, origin.z)
    this.castRay.direction.copy(this.moveDir.set(direction.x, direction.y, direction.z).normalize())
    let closest = maxDistance
    for (const { bvh } of this.buildingBvhs) {
      const hit = raycastFirst(bvh, this.castRay, maxDistance)
      if (hit && hit.distance > 0.001 && hit.distance < closest) closest = hit.distance
    }
    return closest
  }
}

export const manhattanCollision = new ManhattanCollision()

/**
 * The one true spawn: 36th Street at Lexington Avenue, Midtown East — the
 * densest cell of the Phase 2 city data (buildings, props, subway, traffic,
 * crowd all present). The Phase 2 source data has a genuine hole in the
 * midtown-west band (no buildings, props or subway kiosks west of 6th
 * Avenue — the Times Square plaza included), so the hero spawn sits where
 * the full living city is. Everything that needs "where the player starts"
 * reads this — the spawn resolver, the vehicle world layout, the teleport
 * landmarks.
 */
export const MANHATTAN_SPAWN_POINT: Readonly<{ x: number; z: number }> = {
  x: 1000,
  z: -3000,
}

/**
 * Spawn candidates, ordered by desirability. The first one that resolves to
 * solid ground outside a building wins; every coordinate is on a midtown
 * street. Times Square is the hero location (locations.cjs spec P2-075);
 * the rest are fallbacks in case it is ever obstructed.
 */
export const MANHATTAN_SPAWN_CANDIDATES: Array<readonly [number, number]> = [
  [MANHATTAN_SPAWN_POINT.x, MANHATTAN_SPAWN_POINT.z],
  [-1400, -2300],
  [-1550, -2500],
  [-1476, -2000],
  [-1200, -2600],
  [-1000, -1500],
  [-2000, -2800],
  [-500, -1000],
  [400, 400],
]

/**
 * Named Manhattan landmarks for the dev teleport menu. Coordinates are world
 * units; heights are resolved against the island surface at teleport time.
 */
export const MANHATTAN_LANDMARKS: ReadonlyArray<{
  id: string
  label: string
  x: number
  z: number
}> = [
  { id: 'times-square', label: 'Times Square', x: -1476, z: -2433 },
  { id: 'central-park', label: 'Central Park', x: 0, z: 3000 },
  { id: 'empire-state', label: 'Empire State', x: 400, z: -1500 },
  { id: 'financial', label: 'Financial District', x: -500, z: -4000 },
  { id: 'statue', label: 'Statue of Liberty', x: -6447, z: -10034 },
  { id: 'soho', label: 'SoHo', x: -1200, z: -1000 },
  { id: 'midtown-east', label: 'Midtown East', x: 1500, z: 300 },
  { id: 'brooklyn-bridge', label: 'Brooklyn Bridge', x: 3200, z: 5200 },
  { id: 'harbor', label: 'Harbor Islands', x: 3000, z: -6000 },
]

export function resolveManhattanSpawn(): Vec3 {
  const col = manhattanCollision
  const [px, pz] = MANHATTAN_SPAWN_CANDIDATES[0]
  const ground = col.groundHeightAt(px, pz)
  if (ground !== null) {
    if (!col.isInsideBuilding(px, ground, pz)) return { x: px, y: ground, z: pz }
    // The preferred point is genuinely inside a building: take the first
    // nearby alternate that resolves to open ground.
    for (const [cx, cz] of MANHATTAN_SPAWN_CANDIDATES.slice(1)) {
      const g = col.groundHeightAt(cx, cz)
      if (g === null) continue
      if (col.isInsideBuilding(cx, g, cz)) continue
      return { x: cx, y: g, z: cz }
    }
  }
  // No probed surface yet. The street tiles stream toward the camera, so at
  // the moment the base registers they may not have reached the spawn — the
  // preferred point is a known intersection, so stand on the data height and
  // let the game loop snap to the real surface the instant the tiles arrive.
  const land = (cityWorld.city?.meta?.land_level_m as number | undefined) ?? 12
  return { x: px, y: land + 0.4, z: pz }
}
