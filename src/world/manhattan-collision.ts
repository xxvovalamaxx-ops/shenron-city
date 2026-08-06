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

interface BvhEntry {
  mesh: THREE.Mesh
  bvh: MeshBVH
}

const GROUND_RAY_START_Y = 320
const INSIDE_PROBE_Y = 6

/** three-mesh-bvh raycastFirst signature: (ray, materialOrSide, near, far). */
function raycastFirst(bvh: MeshBVH, ray: THREE.Ray, far: number) {
  return bvh.raycastFirst(ray, THREE.FrontSide, 0, far)
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
    this.baseReady = false
  }

  private groundRay = new THREE.Ray()
  private down = new THREE.Vector3(0, -1, 0)

  /**
   * Height of the island surface below (x, z), or null over water / outside
   * the loaded base. Streets and building plinths sit on this surface.
   */
  groundHeightAt(x: number, z: number): number | null {
    if (this.groundMeshes.length === 0) return null
    let best: number | null = null
    this.groundRay.origin.set(x, GROUND_RAY_START_Y, z)
    this.groundRay.direction.copy(this.down)
    for (const mesh of this.groundMeshes) {
      const bvh = mesh.geometry.boundsTree
      if (!bvh) continue
      const hit = raycastFirst(bvh, this.groundRay, GROUND_RAY_START_Y + 100)
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
   * legal position. Ground height is applied by the caller.
   */
  move(from: Vec3, dx: number, dz: number): Vec3 {
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
      // Slide: consume the legal prefix, then retry the remaining axis.
      const ratio = Math.max(0, closest - PLAYER_RADIUS - 0.02) / length
      out.x += mx * ratio
      out.z += mz * ratio
      origin.x = out.x
      origin.z = out.z
      return false
    }

    attempt(dx, dz)
    return out
  }
}

export const manhattanCollision = new ManhattanCollision()

/**
 * Spawn candidates, ordered by desirability. The first one that resolves to
 * solid ground outside a building wins; every coordinate is on a midtown
 * street.
 */
export const MANHATTAN_SPAWN_CANDIDATES: Array<readonly [number, number]> = [
  [400, 400],
  [0, 0],
  [200, -200],
  [800, 400],
  [400, 900],
  [-400, 300],
  [1200, 700],
  [0, 300],
  [-200, -400],
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
  { id: 'times-square', label: 'Times Square', x: 300, z: 100 },
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
  if (!col.baseReady) {
    return { x: MANHATTAN_SPAWN_CANDIDATES[0][0], y: 12.4, z: MANHATTAN_SPAWN_CANDIDATES[0][1] }
  }
  for (const [cx, cz] of MANHATTAN_SPAWN_CANDIDATES) {
    const ground = col.groundHeightAt(cx, cz)
    if (ground === null) continue
    if (col.isInsideBuilding(cx, ground, cz)) continue
    return { x: cx, y: ground, z: cz }
  }
  return { x: MANHATTAN_SPAWN_CANDIDATES[0][0], y: 12.4, z: MANHATTAN_SPAWN_CANDIDATES[0][1] }
}
