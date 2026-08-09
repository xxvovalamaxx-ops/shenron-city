/**
 * What is shared between cars, and what is not.
 *
 * The primitive rig never had to answer this: every car built its own boxes and
 * its own materials. An authored asset shared across the fleet does, and the
 * failure modes are asymmetric — sharing geometry is the whole point, sharing a
 * brake material means every car in Manhattan lights up when one of them slows
 * down.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  SPORTBACK_LODS,
  VehicleAssetPool,
  type GltfSource,
} from './vehicle-asset-pool'

/** A template shaped like the real export: named materials, four wheels. */
function template(): THREE.Group {
  const root = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ name: 'VEH_paint' })
  const tyre = new THREE.MeshStandardMaterial({ name: 'VEH_tyre' })
  const head = new THREE.MeshStandardMaterial({ name: 'VEH_lamp_head' })
  const brake = new THREE.MeshStandardMaterial({ name: 'VEH_lamp_brake' })

  const body = new THREE.Mesh(new THREE.BufferGeometry(), paint)
  body.name = 'VEH_body'
  root.add(body)
  for (const [slot, x, z] of [
    ['fl', -0.8, 1.37],
    ['fr', 0.8, 1.37],
    ['rl', -0.8, -1.37],
    ['rr', 0.8, -1.37],
  ] as const) {
    const wheel = new THREE.Mesh(new THREE.BufferGeometry(), tyre)
    wheel.name = `VEH_wheel_${slot}`
    wheel.position.set(x, 0.34, z)
    root.add(wheel)
  }
  const h = new THREE.Mesh(new THREE.BufferGeometry(), head)
  h.name = 'VEH_light_head'
  root.add(h)
  const b = new THREE.Mesh(new THREE.BufferGeometry(), brake)
  b.name = 'VEH_light_brake'
  root.add(b)
  return root
}

function loader(scene: THREE.Group = template(), fail?: string): GltfSource {
  return {
    async loadAsync(url: string) {
      if (fail) throw new Error(fail)
      void url
      return { scene }
    },
  }
}

/** Every distinct material in a subtree. */
function materialsOf(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = []
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && !out.includes(m)) out.push(m)
    }
  })
  return out
}

function named(root: THREE.Object3D, name: string): THREE.MeshStandardMaterial {
  return materialsOf(root).find((m) => m.name === name) as THREE.MeshStandardMaterial
}

describe('loading once', () => {
  let pool: VehicleAssetPool
  beforeEach(() => {
    pool = new VehicleAssetPool()
  })

  it('is not ready before the asset arrives', () => {
    expect(pool.ready).toBe(false)
    expect(pool.acquire('sedan')).toBeNull()
  })

  it('is ready after a successful load', async () => {
    await pool.load(loader())
    expect(pool.ready).toBe(true)
    expect(pool.error).toBeNull()
  })

  it('fetches each tier once however many callers ask', async () => {
    // Called from React effects that can overlap, so a second four-tier fetch
    // is the bug this prevents.
    let fetches = 0
    const counting: GltfSource = {
      async loadAsync() {
        fetches++
        return { scene: template() }
      },
    }
    await Promise.all([pool.load(counting), pool.load(counting), pool.load(counting)])
    expect(fetches).toBe(SPORTBACK_LODS.length)
  })

  it('records a fetch failure instead of throwing into the frame loop', async () => {
    await pool.load(loader(template(), '404'))
    expect(pool.ready).toBe(false)
    expect(pool.error).toMatch(/404/)
    expect(pool.acquire('sedan')).toBeNull()
  })

  it('refuses an asset that does not satisfy the contract, naming what is wrong', async () => {
    // Validated on arrival, next to the URL that produced it — rather than
    // silently giving every car three wheels.
    const broken = template()
    broken.getObjectByName('VEH_wheel_rr')!.removeFromParent()
    await pool.load(loader(broken))
    expect(pool.ready).toBe(false)
    expect(pool.error).toMatch(/missing wheel rr/)
  })
})

describe('what an instance owns', () => {
  let pool: VehicleAssetPool
  beforeEach(async () => {
    pool = new VehicleAssetPool()
    await pool.load(loader())
  })

  it('shares geometry between cars, which is the reason a pool exists', () => {
    const a = pool.acquire('sedan')!
    const b = pool.acquire('taxi')!
    const geoA = (a.group.getObjectByName('VEH_body') as THREE.Mesh).geometry
    const geoB = (b.group.getObjectByName('VEH_body') as THREE.Mesh).geometry
    expect(geoA).toBe(geoB)
  })

  it('gives each car its own brake material', () => {
    // Shared, one car braking lights the whole fleet.
    const a = pool.acquire('sedan')!
    const b = pool.acquire('sedan')!
    expect(named(a.group, 'VEH_lamp_brake')).not.toBe(named(b.group, 'VEH_lamp_brake'))
  })

  it('keeps braking independent in practice, not just by identity', () => {
    const a = pool.acquire('sedan')!
    const b = pool.acquire('sedan')!
    named(a.group, 'VEH_lamp_brake').emissiveIntensity = 1.6
    expect(named(b.group, 'VEH_lamp_brake').emissiveIntensity).toBe(0)
  })

  it('paints by kind, so a taxi and a police car are not the same instance', () => {
    const taxi = pool.acquire('taxi')!
    const police = pool.acquire('police')!
    expect(named(taxi.group, 'VEH_paint')).not.toBe(named(police.group, 'VEH_paint'))
    expect(named(taxi.group, 'VEH_paint').color.getHexString()).toBe('f2b632')
    expect(named(police.group, 'VEH_paint').color.getHexString()).toBe('24344f')
  })

  it('falls back to the sedan colour for a kind it does not know', () => {
    expect(named(pool.acquire('monorail')!.group, 'VEH_paint').color.getHexString()).toBe('c8c4b8')
  })

  it('shares the materials that have no per-car state', () => {
    // Tyres are the same black on every car; cloning them per instance would
    // be pure waste.
    const a = pool.acquire('sedan')!
    const b = pool.acquire('taxi')!
    expect(named(a.group, 'VEH_tyre')).toBe(named(b.group, 'VEH_tyre'))
  })

  it('owns exactly the materials it cloned', () => {
    const car = pool.acquire('sedan')!
    const names = car.owned.map((m) => m.name).sort()
    expect(names).toEqual(
      SPORTBACK_LODS.flatMap(() => ['VEH_lamp_brake', 'VEH_lamp_head', 'VEH_paint']).sort(),
    )
  })

  it('starts with its lights off', () => {
    const car = pool.acquire('sedan')!
    expect(named(car.group, 'VEH_lamp_head').emissiveIntensity).toBe(0)
    expect(named(car.group, 'VEH_lamp_brake').emissiveIntensity).toBe(0)
  })

  it('binds the runtime contract on every instance', () => {
    const car = pool.acquire('sedan')!
    expect(car.bound.wheels.map((w) => w.slot)).toEqual(['fl', 'fr', 'rl', 'rr'])
    expect(car.bound.wheels.filter((w) => w.steers).map((w) => w.slot)).toEqual(['fl', 'fr'])
    expect(car.bound.brakeMaterials).toHaveLength(1)
  })

  it('assembles every authored tier into one distance-driven LOD', () => {
    const car = pool.acquire('sedan')!
    expect(car.group).toBeInstanceOf(THREE.LOD)
    expect(car.group.levels.map((level) => level.distance)).toEqual(
      SPORTBACK_LODS.map((tier) => tier.distance),
    )
    expect(car.group.levels.map((level) => level.object.name)).toEqual([
      'VEH_sedan_LOD0',
      'VEH_sedan_LOD1',
      'VEH_sedan_LOD2',
      'VEH_sedan_LOD3',
    ])
    expect(car.bindings).toHaveLength(SPORTBACK_LODS.length)
  })
})

describe('giving a car back', () => {
  let pool: VehicleAssetPool
  beforeEach(async () => {
    pool = new VehicleAssetPool()
    await pool.load(loader())
  })

  it('disposes what the instance owned', () => {
    const car = pool.acquire('sedan')!
    const brake = named(car.group, 'VEH_lamp_brake')
    let disposed = false
    brake.addEventListener('dispose', () => {
      disposed = true
    })
    pool.release(car)
    expect(disposed).toBe(true)
  })

  it('leaves the shared materials alone, so the rest of the fleet survives', () => {
    // Disposing a borrowed material blanks every other car — the failure this
    // ownership split exists to prevent.
    const a = pool.acquire('sedan')!
    const b = pool.acquire('taxi')!
    const sharedTyre = named(b.group, 'VEH_tyre')
    let disposed = false
    sharedTyre.addEventListener('dispose', () => {
      disposed = true
    })
    pool.release(a)
    expect(disposed).toBe(false)
    expect(named(b.group, 'VEH_tyre')).toBe(sharedTyre)
  })

  it('detaches the group from the scene', () => {
    const parent = new THREE.Group()
    const car = pool.acquire('sedan')!
    parent.add(car.group)
    pool.release(car)
    expect(parent.children).toHaveLength(0)
  })

  it('can still dress new cars after one is released', () => {
    const a = pool.acquire('sedan')!
    pool.release(a)
    expect(pool.acquire('taxi')).not.toBeNull()
  })
})
