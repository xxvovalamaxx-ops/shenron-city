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
  DOOR_SLOTS,
  DOOR_OPEN_RADIANS,
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

  it('survives three.js stripping the dot out of that suffix', () => {
    // GLTFLoader sanitizes node names because a dot is reserved in animation
    // property paths, so `VEH_wheel_fl.001` arrives as `VEH_wheel_fl001`.
    //
    // Handling only the dotted form was a real bug and an asymmetric one: the
    // light slots match by prefix so they survived, while the wheel slots
    // compare the whole slot and `fl001` matched nothing. A LOD tier bound its
    // lights and lost all four wheels.
    expect(classifyVehicleNode('VEH_wheel_fl001')).toEqual({ kind: 'wheel', slot: 'fl' })
    expect(classifyVehicleNode('VEH_wheel_rr003')).toEqual({ kind: 'wheel', slot: 'rr' })
    expect(classifyVehicleNode('VEH_light_head002')).toEqual({ kind: 'head' })
    expect(classifyVehicleNode('VEH_glass001')).toEqual({ kind: 'glass' })
  })

  it('knows the cabin fittings, so they are not reported as strays', () => {
    // The cockpit camera sits inside the car; these are part of the asset even
    // though the runtime does not drive them.
    expect(classifyVehicleNode('VEH_interior')).toEqual({ kind: 'interior' })
    expect(classifyVehicleNode('VEH_steering')).toEqual({ kind: 'interior' })
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

describe('doors swing outward, from the geometry rather than a lookup', () => {
  /** A car with two front doors hinged at their front edges. */
  function withDoors() {
    const root = completeCar()
    for (const [slot, x] of [
      ['fl', 0.86],
      ['fr', -0.86],
    ] as const) {
      const door = mesh(`VEH_door_${slot}`)
      // Hinge at the front edge of the aperture; the panel extends backward.
      door.position.set(x, 0.75, 0.42)
      root.add(door)
    }
    return root
  }

  it('binds both front doors', () => {
    const bound = bindVehicleAsset(withDoors())
    expect(bound.doors.map((d) => d.slot)).toEqual(['fl', 'fr'])
    expect(DOOR_SLOTS).toEqual(['fl', 'fr'])
  })

  it('gives the left door a negative swing and the right a positive one', () => {
    // glTF +X is the car's left, and a front-hinged door swings its rear edge
    // outward — so left opens negative about Y and right opens positive.
    const bound = bindVehicleAsset(withDoors())
    expect(bound.doors.find((d) => d.slot === 'fl')!.openSign).toBe(-1)
    expect(bound.doors.find((d) => d.slot === 'fr')!.openSign).toBe(1)
  })

  it('reads the side off the hinge, so a mirrored asset still opens outward', () => {
    // The direction is derived, not looked up by slot name. An asset whose
    // doors are mirrored or named the other way round would otherwise fold
    // them into the cabin.
    const root = completeCar()
    const swapped = mesh('VEH_door_fl')
    swapped.position.set(-0.86, 0.75, 0.42) // named left, built on the right
    root.add(swapped)
    expect(bindVehicleAsset(root).doors[0].openSign).toBe(1)
  })

  it('actually swings the rear edge away from the car', () => {
    // The property the sign exists for, stated as a measurement rather than
    // as a claim about which way is positive.
    const root = withDoors()
    const bound = bindVehicleAsset(root)
    const left = bound.doors.find((d) => d.slot === 'fl')!
    // A point on the door's trailing edge, one metre behind the hinge.
    const trailing = new THREE.Object3D()
    trailing.position.set(0, 0, -1)
    left.node.add(trailing)

    root.updateMatrixWorld(true)
    const shut = new THREE.Vector3()
    trailing.getWorldPosition(shut)

    applyVehicleState(bound, {
      wheelSpin: 0, steerAngle: 0, braking: false, headlights: false, doorOpen: 1,
    })
    root.updateMatrixWorld(true)
    const open = new THREE.Vector3()
    trailing.getWorldPosition(open)

    // Outward for a left-hand door is +X.
    expect(open.x).toBeGreaterThan(shut.x + 0.5)
  })

  it('opens to the full angle and shuts flush', () => {
    const bound = bindVehicleAsset(withDoors())
    const left = bound.doors.find((d) => d.slot === 'fl')!
    applyVehicleState(bound, {
      wheelSpin: 0, steerAngle: 0, braking: false, headlights: false, doorOpen: 1,
    })
    expect(left.node.rotation.y).toBeCloseTo(-DOOR_OPEN_RADIANS, 6)
    applyVehicleState(bound, {
      wheelSpin: 0, steerAngle: 0, braking: false, headlights: false, doorOpen: 0,
    })
    expect(left.node.rotation.y).toBe(-0)
  })

  it('clamps, so a transition overshoot cannot fold a door through the sill', () => {
    const bound = bindVehicleAsset(withDoors())
    const left = bound.doors.find((d) => d.slot === 'fl')!
    applyVehicleState(bound, {
      wheelSpin: 0, steerAngle: 0, braking: false, headlights: false, doorOpen: 2.5,
    })
    expect(left.node.rotation.y).toBeCloseTo(-DOOR_OPEN_RADIANS, 6)
    applyVehicleState(bound, {
      wheelSpin: 0, steerAngle: 0, braking: false, headlights: false, doorOpen: -3,
    })
    expect(left.node.rotation.y).toBe(-0)
  })

  it('treats a missing doorOpen as shut, so an asset with doors is not born open', () => {
    const bound = bindVehicleAsset(withDoors())
    applyVehicleState(bound, {
      wheelSpin: 0, steerAngle: 0, braking: false, headlights: false,
    })
    expect(bound.doors.every((d) => d.node.rotation.y === 0 || Object.is(d.node.rotation.y, -0)))
      .toBe(true)
  })

  it('complains about a hinge on the centreline, which has no side to swing from', () => {
    const root = completeCar()
    const door = mesh('VEH_door_fl')
    door.position.set(0, 0.75, 0.42)
    root.add(door)
    const problems = validateVehicleAsset(bindVehicleAsset(root)).map((p) => p.problem)
    expect(problems.some((p) => /centreline/.test(p))).toBe(true)
  })

  it('is fine on a car with no doors at all — the far tiers have none', () => {
    const bound = bindVehicleAsset(completeCar())
    expect(bound.doors).toEqual([])
    expect(validateVehicleAsset(bound)).toEqual([])
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
