/**
 * Dev-tool spawns: a tiny imperative registry of entities the dev menu drops
 * into the world (cars, pedestrians, trees). Pure data — rendering happens in
 * ui/DevSpawns.tsx, which is the only component that reads this store.
 */
import { create } from 'zustand'
import { rt } from './runtime'
import { manhattanCollision } from '../world/manhattan-collision'

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
  url: string
  scale: number
}> = [
  { kind: 'vehicle', label: 'Sedan', url: '/models/dev/sedan.glb', scale: 1 },
  { kind: 'vehicle', label: 'Taxi', url: '/models/dev/taxi.glb', scale: 1 },
  { kind: 'vehicle', label: 'Police', url: '/models/dev/police.glb', scale: 1 },
  { kind: 'vehicle', label: 'Ambulance', url: '/models/dev/ambulance.glb', scale: 1 },
  { kind: 'ped', label: 'Pedestrian', url: '/models/dev/ped.glb', scale: 1 },
  { kind: 'prop', label: 'Tree', url: '/models/dev/tree.glb', scale: 1 },
]

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
  clearSpawns: () => set({ spawns: [] }),
  removeSpawn: (id) => set((s) => ({ spawns: s.spawns.filter((x) => x.id !== id) })),
}))

/** Mirror into rt so the game loop (if it ever needs them) sees the same set. */
useDevSpawns.subscribe((state) => {
  rt.spawns = state.spawns.map((s) => ({ id: s.id, kind: s.kind, url: s.url, pos: { x: s.x, y: s.y, z: s.z }, yaw: s.yaw }))
})
