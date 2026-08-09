/**
 * The vehicle asset contract, tested before any art is authored to it.
 *
 * The point of writing these first: the convention is what the modelling has to
 * satisfy, and discovering it is wrong after the car is built means building
 * the car twice.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  applyVehicleState,
  bindVehicleAsset,
  classifyVehicleNode,
  validateVehicleAsset,
  STEERING_SLOTS,
  WHEEL_SLOTS,
} from './vehicle-asset'

function mesh(name: string, material?: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BufferGeometry(),
    material ?? new THREE.MeshStandardMaterial(),
  )
  m.name = name
  return m
}

/** A minimal asset that satisfies the whole convention. */
function completeCar() {
  const root = new THREE.Group()
  root.name = 'VEH_sportback'
  root.add(mesh('VEH_body'))
  for (const [slot, x, z] of [
    ['fl', -0.8, 1.3],
    ['fr', 0.8, 1.3],
    ['rl', -0.8, -1.3],
    ['rr', 0.8, -1.3],
  ] as const) {
    const w = mesh(`VEH_wheel_${slot}`)
    w.position.set(x, 0.34, z)
    root.add(w)
  }
  root.add(mesh('VEH_light_head'))
  root.add(mesh('VEH_light_brake'))
  return root
}

describe('the node convention', () => {
  it('recognises every slot the runtime drives', () => {
    expect(classifyVehicleNode('VEH_body')).toEqual({ kind: 'body' })
    expect(classifyVehicleNode('VEH_wheel_fl')).toEqual({ kind: 'wheel', slot: 'fl' })
    expect(classifyVehicleNode('VEH_light_head')).toEqual({ kind: 'head' })
    expect(classifyVehicleNode('VEH_light_brake')).toEqual({ kind: 'brake' })
    expect(classifyVehicleNode('VEH_glass')).toEqual({ kind: 'glass' })
  })

  it('survives an exporter numbering duplicates', () => {
    // Blender appends .001 to the second object with a name. Treating that as a
    // different node would silently drop half an asset.
    expect(classifyVehicleNode('VEH_wheel_rr.003')).toEqual({ kind: 'wheel', slot: 'rr' })
    expect(classifyVehicleNode('VEH_light_brake.001')).toEqual({ kind: 'brake' })
  })

  it('is case-insensitive, because exporters disagree about case', () => {
    expect(classifyVehicleNode('veh_wheel_fr')).toEqual({ kind: 'wheel', slot: 'fr' })
  })

  it('ignores nodes outside the convention', () => {
    for (const name of ['Cube', 'Armature', 'wheel_fl', 'VEH_', 'VEH_wheel_zz']) {
      expect(classifyVehicleNode(name), name).toBeNull()
    }
  })

  it('names the front pair as the steering pair, matching the sim indices', () => {
    // VehicleRig writes steer to wheels[0] and wheels[1].
    expect(STEERING_SLOTS).toEqual(['fl', 'fr'])
    expect(WHEEL_SLOTS.slice(0, 2)).toEqual(['fl', 'fr'])
  })
})

describe('binding an asset', () => {
  it('finds all four wheels and both light sets', () => {
    const bound = bindVehicleAsset(completeCar())
    expect(bound.wheels.map((w) => w.slot)).toEqual(['fl', 'fr', 'rl', 'rr'])
    expect(bound.headMaterials).toHaveLength(1)
    expect(bound.brakeMaterials).toHaveLength(1)
    expect(validateVehicleAsset(bound)).toEqual([])
  })

  it('gives a steering wheel a pivot at its own hub, not at the car centre', () => {
    // The failure this prevents is unmistakable once seen: the wheel swings
    // through an arc around the car's centre instead of turning on the spot.
    const bound = bindVehicleAsset(completeCar())
    const fl = bound.wheels.find((w) => w.slot === 'fl')!
    expect(fl.pivot).not.toBe(fl.wheel)
    expect(fl.pivot.position.toArray()).toEqual([-0.8, 0.34, 1.3])
    // The wheel is zeroed inside the pivot, so the pivot's rotation is the
    // wheel's steering axis.
    expect(fl.wheel.position.toArray()).toEqual([0, 0, 0])
    expect(fl.wheel.parent).toBe(fl.pivot)
  })

  it('leaves a rear wheel alone, because it does not steer', () => {
    const bound = bindVehicleAsset(completeCar())
    const rl = bound.wheels.find((w) => w.slot === 'rl')!
    expect(rl.pivot).toBe(rl.wheel)
    expect(rl.steers).toBe(false)
    expect(rl.wheel.position.z).toBe(-1.3)
  })

  it('keeps the wheel in the same world position after binding', () => {
    // Inserting a pivot must not move the car. A silent 0.8 m shift per front
    // wheel would read as a modelling error.
    const root = completeCar()
    root.updateMatrixWorld(true)
    const before = new THREE.Vector3()
    root.getObjectByName('VEH_wheel_fl')!.getWorldPosition(before)
    const bound = bindVehicleAsset(root)
    bound.root.updateMatrixWorld(true)
    const after = new THREE.Vector3()
    bound.wheels.find((w) => w.slot === 'fl')!.wheel.getWorldPosition(after)
    expect(after.distanceTo(before)).toBeLessThan(1e-9)
  })

  it('reports meshes that match nothing, rather than absorbing them', () => {
    const root = completeCar()
    root.add(mesh('Cube.007'))
    const bound = bindVehicleAsset(root)
    expect(bound.unmatched).toContain('Cube.007')
  })

  it('collects glass separately so collision can skip it', () => {
    const root = completeCar()
    root.add(mesh('VEH_glass'))
    expect(bindVehicleAsset(root).glass).toHaveLength(1)
  })
})

describe('validation names what is missing', () => {
  it('says which wheel is absent', () => {
    const root = completeCar()
    root.getObjectByName('VEH_wheel_rr')!.removeFromParent()
    const problems = validateVehicleAsset(bindVehicleAsset(root))
    expect(problems.map((p) => p.problem)).toContain('missing wheel rr')
  })

  it('says when the lights are not bindable', () => {
    const root = new THREE.Group()
    root.add(mesh('VEH_body'))
    for (const slot of WHEEL_SLOTS) root.add(mesh(`VEH_wheel_${slot}`))
    const problems = validateVehicleAsset(bindVehicleAsset(root)).map((p) => p.problem)
    expect(problems).toContain('no headlight material')
    expect(problems).toContain('no brake light material')
  })

  it('says when the asset has no geometry at all', () => {
    const empty = new THREE.Group()
    const problems = validateVehicleAsset(bindVehicleAsset(empty)).map((p) => p.problem)
    expect(problems).toContain('asset contains no meshes')
  })

  it('lists every problem, not the first', () => {
    const root = new THREE.Group()
    root.add(mesh('VEH_body'))
    expect(validateVehicleAsset(bindVehicleAsset(root)).length).toBeGreaterThan(4)
  })
})

describe('driving a bound vehicle', () => {
  it('rolls every wheel and steers only the front pair', () => {
    const bound = bindVehicleAsset(completeCar())
    applyVehicleState(bound, {
      wheelSpin: 1.25,
      steerAngle: 0.4,
      braking: false,
      headlights: false,
    })
    for (const w of bound.wheels) expect(w.wheel.rotation.x).toBeCloseTo(1.25, 9)
    for (const w of bound.wheels) {
      expect(w.pivot.rotation.y).toBeCloseTo(w.steers ? 0.4 : 0, 9)
    }
  })

  it('lights the brakes only when braking', () => {
    const bound = bindVehicleAsset(completeCar())
    const brake = bound.brakeMaterials[0] as THREE.MeshStandardMaterial
    applyVehicleState(bound, { wheelSpin: 0, steerAngle: 0, braking: true, headlights: false })
    expect(brake.emissiveIntensity).toBeGreaterThan(0)
    applyVehicleState(bound, { wheelSpin: 0, steerAngle: 0, braking: false, headlights: false })
    expect(brake.emissiveIntensity).toBe(0)
  })

  it('lights the headlights independently of the brakes', () => {
    const bound = bindVehicleAsset(completeCar())
    const head = bound.headMaterials[0] as THREE.MeshStandardMaterial
    const brake = bound.brakeMaterials[0] as THREE.MeshStandardMaterial
    applyVehicleState(bound, { wheelSpin: 0, steerAngle: 0, braking: false, headlights: true })
    expect(head.emissiveIntensity).toBeGreaterThan(0)
    expect(brake.emissiveIntensity).toBe(0)
  })

  it('does nothing alarming on an asset that bound nothing', () => {
    const bound = bindVehicleAsset(new THREE.Group())
    expect(() =>
      applyVehicleState(bound, {
        wheelSpin: 1,
        steerAngle: 1,
        braking: true,
        headlights: true,
      }),
    ).not.toThrow()
  })
})
