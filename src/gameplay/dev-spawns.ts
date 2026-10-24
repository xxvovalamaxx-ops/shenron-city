/**
 * Dev-tool spawns: a tiny imperative registry of entities the dev menu drops
 * into the world. Cars go straight into the vehicle session as parked,
 * enterable cars (drawn by world/VehicleRig.tsx with the production models);
 * pedestrians and props stay pure data here and are rendered by
 * ui/DevSpawns.tsx, the only component that reads this store.
 */
import { create } from 'zustand'
import { rt } from './runtime'
import { manhattanCollision } from '../world/manhattan-collision'
import { vehicleDevClock, vehicleSim } from './vehicles/vehicle-session'
import { placeParkedCar } from './vehicles/vehicle-control'
import { STREET_PAINT, vehicleSpec } from './vehicles/vehicle-specs'

export interface DevSpawn {
  id: number
  kind: 'vehicle' | 'ped' | 'prop'
  url: string
  x: number
  y: number
  z: number
  yaw: number
  scale: number
}

export const DEV_SPAWN_CATALOG: ReadonlyArray<{
  kind: DevSpawn['kind']
  label: string
  /** Model URL for GLB spawns; a `vehicle:<kind>` key for session cars. */
  url: string
  scale: number
  /** Session vehicle kind, for car spawns. */
  vehicleKind?: string
}> = [
  { kind: 'vehicle', label: 'Sedan', url: 'vehicle:sedan', scale: 1, vehicleKind: 'sedan' },
  { kind: 'vehicle', label: 'Taxi', url: 'vehicle:taxi', scale: 1, vehicleKind: 'taxi' },
  { kind: 'vehicle', label: 'Police', url: 'vehicle:police', scale: 1, vehicleKind: 'police' },
  { kind: 'vehicle', label: 'SUV', url: 'vehicle:suv', scale: 1, vehicleKind: 'suv' },
  { kind: 'vehicle', label: 'Van', url: 'vehicle:van', scale: 1, vehicleKind: 'van' },
  { kind: 'vehicle', label: 'Coupe', url: 'vehicle:coupe', scale: 1, vehicleKind: 'coupe' },
  { kind: 'ped', label: 'Pedestrian', url: '/models/dev/ped.glb', scale: 1 },
  { kind: 'prop', label: 'Tree', url: '/models/dev/tree.glb', scale: 1 },
]

let paintCursor = 5

/**
 * Park a session car of `kind` at a world pose (ground snapped). Used by the
 * dev menu and by the capture tooling (`window.__vehicleDev.spawn`).
 */
export function spawnDevVehicle(kind: string, x: number, z: number, heading: number, paint?: number): number {
  const ground = manhattanCollision.groundHeightAt(x, z) ?? rt.player.pos.y
  const colour = paint ?? STREET_PAINT[paintCursor++ % STREET_PAINT.length]
  const entity = placeParkedCar(vehicleSim, kind, { pos: { x, y: ground, z }, heading }, kind === 'taxi' || kind === 'police' ? null : colour, {
    origin: 'spawn',
  })
  return entity.id
}

/** Remove every dev-spawned car nobody is sitting in. */
export function clearDevVehicles(): void {
  for (const [id, entity] of [...vehicleSim.registry.vehicles]) {
    if (entity.origin === 'spawn' && entity.state === 'PARKED') vehicleSim.registry.vehicles.delete(id)
  }
}

interface DevSpawnState {
  spawns: DevSpawn[]
  addSpawn(catalogIndex: number): void
  clearSpawns(): void
  removeSpawn(id: number): void
}

let nextId = 1

export const useDevSpawns = create<DevSpawnState>((set) => ({
  spawns: [],
  addSpawn: (catalogIndex) => {
    const entry = DEV_SPAWN_CATALOG[catalogIndex]
    if (!entry) return
    const p = rt.player.pos
    const ground = manhattanCollision.groundHeightAt(p.x, p.z) ?? p.y
    const yaw = Math.atan2(rt.player.forward.x, rt.player.forward.z)
    if (entry.vehicleKind) {
      // Broadside, a couple of metres clear of the player, so it reads whole.
      const spec = vehicleSpec(entry.vehicleKind)
      const reach = spec.halfWidth + 2.6
      spawnDevVehicle(entry.vehicleKind, p.x + Math.sin(yaw) * reach, p.z + Math.cos(yaw) * reach, yaw + Math.PI / 2)
      return
    }
    const spawn: DevSpawn = {
      id: nextId++,
      kind: entry.kind,
      url: entry.url,
      x: p.x + Math.sin(yaw) * 2.4,
      y: ground,
      z: p.z + Math.cos(yaw) * 2.4,
      yaw,
      scale: entry.scale,
    }
    set((s) => ({ spawns: [...s.spawns, spawn] }))
  },
  clearSpawns: () => {
    clearDevVehicles()
    set({ spawns: [] })
  },
  removeSpawn: (id) => set((s) => ({ spawns: s.spawns.filter((x) => x.id !== id) })),
}))

/** Mirror into rt so the game loop (if it ever needs them) sees the same set. */
useDevSpawns.subscribe((state) => {
  rt.spawns = state.spawns.map((s) => ({ id: s.id, kind: s.kind, url: s.url, pos: { x: s.x, y: s.y, z: s.z }, yaw: s.yaw }))
})

/** Dev: stand the player at a world point (ground snapped). */
function teleportPlayer(x: number, z: number, faceX?: number, faceZ?: number): void {
  const ground = manhattanCollision.groundHeightAt(x, z)
  rt.player.pos = { x, y: ground ?? rt.player.pos.y, z }
  rt.player.velocityY = 0
  if (faceX !== undefined && faceZ !== undefined) {
    const len = Math.hypot(faceX - x, faceZ - z) || 1
    rt.player.forward = { x: (faceX - x) / len, z: (faceZ - z) / len }
  }
}

// Capture tooling hook (dev builds only): park a car, move the player, or
// read the session from a puppeteer EVAL.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __vehicleDev: unknown }).__vehicleDev = {
    spawn: spawnDevVehicle,
    clear: clearDevVehicles,
    teleport: teleportPlayer,
    player: () => ({ ...rt.player.pos }),
    sim: vehicleSim,
    clock: vehicleDevClock,
  }
}
