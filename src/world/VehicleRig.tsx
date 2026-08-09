/**
 * The vehicle world's visual layer.
 *
 * The simulation lives in renderer-free modules; this component is the only
 * place a vehicle's wheels actually turn. Bodies are procedural boxes —
 * placeholders until the production vehicle families land — so the sim's
 * pose, wheel spin, front-wheel steering, brake lights, headlights and the
 * pedestrian crossings are all visible and all read from the same state the
 * game loop steps. React re-renders never happen per frame: the rig owns
 * THREE objects and mutates them in useFrame.
 */
import { useEffect, useRef } from 'react'
import { useSimulationStage } from '../gameplay/useSimulationStage'
import * as THREE from 'three'
import { vehicleSim } from '../gameplay/vehicles/vehicle-session'
import { vehicleSpec } from '../gameplay/vehicles/vehicle-specs'
import type { VehicleEntity } from '../gameplay/vehicles/vehicle-entities'
import {
  adoptAuthoredPedestrian,
  disposeOwned,
  disposePedestrianResources,
  pedestrianResources,
  PEDESTRIAN_LOD0,
} from './rig-resources'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { applyVehicleState } from './vehicle-asset'
import { vehicleAssetPool, type VehicleInstance } from './vehicle-asset-pool'

const KIND_COLOR: Record<string, string> = {
  sedan: '#c8c4b8',
  taxi: '#f2b632',
  police: '#24344f',
  ambulance: '#e9eef2',
}

const ACCENT: Record<string, string> = {
  sedan: '#1c1c1c',
  taxi: '#14100a',
  police: '#e8eef2',
  ambulance: '#c0392b',
}

/**
 * A loader for the vehicle asset, made once.
 *
 * Separate from ManhattanCity's shared loader on purpose: that one carries a
 * Draco decoder for the compressed city tiles, and the vehicle GLBs are
 * uncompressed. Reusing it would work and would tie this component's lifetime
 * to the city pipeline's, which it does not otherwise depend on.
 */
let vehicleLoader: GLTFLoader | null = null
function getVehicleGltfLoader(): GLTFLoader {
  if (!vehicleLoader) vehicleLoader = new GLTFLoader()
  return vehicleLoader
}

interface WheelRig {
  pivot: THREE.Group
  wheel: THREE.Mesh
}

interface VehicleRigEntry {
  group: THREE.Object3D
  /**
   * The authored sportback, when the asset has loaded.
   *
   * Null means this car is still wearing the procedural fallback — see the
   * note at the rig creation site. The two are never both present.
   */
  authored: VehicleInstance | null
  wheels: WheelRig[]
  brakeLights: THREE.Mesh[]
  headlights: THREE.Mesh[]
  brakeMaterial: THREE.MeshStandardMaterial
  headMaterial: THREE.MeshStandardMaterial
  forward: THREE.Vector3
  right: THREE.Vector3
}

function makeWheel(radius: number, color: string): WheelRig {
  const geometry = new THREE.CylinderGeometry(radius, radius, 0.26, 14)
  geometry.rotateZ(Math.PI / 2)
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
  const pivot = new THREE.Group()
  const wheel = new THREE.Mesh(geometry, material)
  wheel.castShadow = true
  pivot.add(wheel)
  return { pivot, wheel }
}

function buildVehicleRig(entity: VehicleEntity): VehicleRigEntry {
  const spec = vehicleSpec(entity.kind)
  const bodyColor = KIND_COLOR[entity.kind] ?? KIND_COLOR.sedan
  const accent = ACCENT[entity.kind] ?? ACCENT.sedan

  const group = new THREE.Group()
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.42, metalness: 0.5 })
  const glassMaterial = new THREE.MeshStandardMaterial({ color: '#10161f', roughness: 0.12, metalness: 0.6 })
  const accentMaterial = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 })

  const body = new THREE.Mesh(new THREE.BoxGeometry(spec.halfWidth * 2, spec.height * 0.55, spec.halfLength * 2), bodyMaterial)
  body.position.y = spec.height * 0.42
  body.castShadow = true
  group.add(body)

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(spec.halfWidth * 1.7, spec.height * 0.5, spec.halfLength * 0.85),
    glassMaterial,
  )
  cabin.position.set(0, spec.height * 0.82, -spec.halfLength * 0.18)
  cabin.castShadow = true
  group.add(cabin)

  // Wheels: front pair steer, all four spin.
  const wheels: WheelRig[] = []
  const wheelColor = '#16161a'
  for (const [side, front] of [
    [1, true],
    [-1, true],
    [1, false],
    [-1, false],
  ] as const) {
    const rig = makeWheel(spec.wheelRadius, wheelColor)
    rig.pivot.position.set(side * (spec.halfWidth + 0.06), spec.wheelRadius, front ? spec.wheelbase / 2 : -spec.wheelbase / 2)
    group.add(rig.pivot)
    wheels.push(rig)
  }

  // Brake and head lights: emissive strips that dim on the simulation's flags.
  const brakeMaterial = new THREE.MeshStandardMaterial({
    color: '#7f1d1d',
    emissive: '#ff2222',
    emissiveIntensity: 0,
  })
  const brakeGeometry = new THREE.BoxGeometry(spec.halfWidth * 1.5, 0.14, 0.05)
  const brakeLights = []
  for (const side of [1, -1]) {
    const light = new THREE.Mesh(brakeGeometry, brakeMaterial)
    light.position.set(side * spec.halfWidth * 0.45, 0.62, -spec.halfLength)
    group.add(light)
    brakeLights.push(light)
  }

  const headMaterial = new THREE.MeshStandardMaterial({
    color: '#f5f0e0',
    emissive: '#ffe9b0',
    emissiveIntensity: 0,
  })
  const headGeometry = new THREE.BoxGeometry(0.5, 0.18, 0.05)
  const headlights = []
  for (const side of [1, -1]) {
    const light = new THREE.Mesh(headGeometry, headMaterial)
    light.position.set(side * spec.halfWidth * 0.55, 0.66, spec.halfLength)
    group.add(light)
    headlights.push(light)
  }

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, spec.halfLength * 2), accentMaterial)
  stripe.position.y = 0.75
  group.add(stripe)

  return {
    group,
    authored: null,
    wheels,
    brakeLights,
    headlights,
    brakeMaterial,
    headMaterial,
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
  }
}

/**
 * Dress a car in the authored sportback, or return null if it has not loaded.
 *
 * The returned entry keeps the primitive-rig fields so the two paths share one
 * type, but they are never both live: `authored` is what the frame loop
 * branches on, and an authored entry's wheel and light fields are empty.
 */
function buildAuthoredRig(entity: VehicleEntity): VehicleRigEntry | null {
  const instance = vehicleAssetPool.acquire(entity.kind)
  if (!instance) return null
  return {
    group: instance.group,
    authored: instance,
    wheels: [],
    brakeLights: [],
    headlights: [],
    // Unused on this path; the bound materials are driven through
    // applyVehicleState instead. Kept non-null so the type stays simple.
    brakeMaterial: instance.bound.brakeMaterials[0] as THREE.MeshStandardMaterial,
    headMaterial: instance.bound.headMaterials[0] as THREE.MeshStandardMaterial,
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
  }
}

/** Release an entry, by whichever route owns it. */
function releaseEntry(entry: VehicleRigEntry): void {
  if (entry.authored) {
    // The pool owns the geometry and the shared materials; only the per-car
    // clones are disposed. disposeOwned would take the shared buffers with it
    // and blank every other car.
    vehicleAssetPool.release(entry.authored)
    return
  }
  disposeOwned(entry.group)
  entry.group.removeFromParent()
}

export function VehicleRig() {
  const root = useRef<THREE.Group>(null)
  const entries = useRef(new Map<number, VehicleRigEntry>())
  const pedMeshes = useRef<THREE.Mesh[]>([])

  // Fetch the authored pedestrian once, on mount.
  //
  // Crossers already in the scene hold the fallback geometry by reference, so
  // swapping the module-level variable is not enough — each existing mesh is
  // re-pointed here. Without that, only pedestrians spawned after the fetch
  // would improve and the ones on screen would stay boxes indefinitely.
  useEffect(() => {
    let cancelled = false
    getVehicleGltfLoader()
      .loadAsync(PEDESTRIAN_LOD0)
      .then(({ scene }) => {
        if (cancelled) return
        let geometry: THREE.BufferGeometry | null = null
        let material: THREE.MeshStandardMaterial | undefined
        scene.traverse((object) => {
          if (geometry || !(object instanceof THREE.Mesh)) return
          geometry = object.geometry
          if (object.material instanceof THREE.MeshStandardMaterial) material = object.material
        })
        if (!geometry) {
          console.error('[pedestrians] authored figure has no mesh —', PEDESTRIAN_LOD0)
          return
        }
        // No lift. The figure is authored standing on the ground with its
        // origin at the feet, and a crosser's mesh is placed at ped.pos with
        // y = 0 — so it already lands on the pavement.
        //
        // The first version added +0.875 here, reasoning from the fallback
        // box's centre origin. Measured, that left the figure floating 0.88 m
        // above the ground. Worth recording that the box was the one that was
        // wrong: centre-origin at y = 0 meant every crosser was half buried,
        // which nobody noticed because a small dark box in a street reads as
        // a shadow.
        const { previous } = adoptAuthoredPedestrian(geometry, material)
        const next = pedestrianResources()
        for (const mesh of pedMeshes.current) {
          mesh.geometry = next.geometry
          mesh.material = next.material
        }
        // Disposed only after every mesh has been re-pointed off it.
        previous?.dispose()
      })
      .catch((err: unknown) => {
        console.error('[pedestrians] authored figure unavailable —', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch the authored asset once, on mount. Cars render with the procedural
  // fallback until it lands and are upgraded in place.
  useEffect(() => {
    vehicleAssetPool.load(getVehicleGltfLoader()).then((scene) => {
      if (!scene && vehicleAssetPool.error) {
        // Loud: the visible symptom is a fleet of boxes, which reads as
        // "the hero vehicle was never made" rather than "it failed to load".
        console.error('[vehicles] authored asset unavailable —', vehicleAssetPool.error)
      }
    })
  }, [])

  useEffect(
    () => () => {
      for (const entry of entries.current.values()) releaseEntry(entry)
      entries.current.clear()
      // The pedestrian boxes share one geometry and one material, so the
      // meshes are only detached here. The shared pair is released once,
      // after every mesh referencing it is gone.
      for (const mesh of pedMeshes.current) mesh.removeFromParent()
      pedMeshes.current = []
      disposePedestrianResources()
    },
    [],
  )

  // Presentation: mirrors the vehicle registry into THREE objects. The
  // `vehicles` stage has already integrated every pose this frame, so the
  // transforms copied here are current rather than one frame stale — which is
  // what an undeclared priority could not guarantee.
  useSimulationStage('vehicle-rig', 'presentation', () => {
    const rigRoot = root.current
    if (!rigRoot) return

    // Keep a rig per vehicle, created and destroyed with the entity.
    const seen = new Set<number>()
    for (const entity of vehicleSim.registry.vehicles.values()) {
      seen.add(entity.id)
      let entry = entries.current.get(entity.id)
      if (!entry) {
        entry = buildAuthoredRig(entity) ?? buildVehicleRig(entity)
        rigRoot.add(entry.group)
        entries.current.set(entity.id, entry)
      } else if (!entry.authored) {
        // Upgrade a fallback car once the asset finishes loading.
        //
        // The fallback is deliberate, not a leftover: the GLB fetch is async
        // and cars exist from the first frame, so the choice is procedural
        // geometry for a second or an invisible fleet. It is also the honest
        // failure mode — if the asset never arrives the boxes stay and
        // placeholdercheck fails, which is exactly what should happen.
        const upgraded = buildAuthoredRig(entity)
        if (upgraded) {
          disposeOwned(entry.group)
          entry.group.removeFromParent()
          rigRoot.add(upgraded.group)
          entries.current.set(entity.id, upgraded)
          entry = upgraded
        }
      }

      entry.group.position.set(entity.pose.pos.x, entity.pose.pos.y, entity.pose.pos.z)
      entry.group.rotation.y = entity.pose.heading

      entry.forward.set(Math.sin(entity.pose.heading), 0, Math.cos(entity.pose.heading))
      entry.right.set(-entry.forward.z, 0, entry.forward.x)
      const spin = entity.motion.wheelSpin
      const steer = entity.motion.steerAngle
      const braking = entity.motion.braking || entity.state === 'PARKED'

      if (entry.authored) {
        // Keep the animated parts coherent across a distance transition. LOD2
        // has wheels but no light lenses; LOD3 is a static silhouette, so the
        // same call naturally becomes a no-op for the parts a tier omits.
        for (const bound of entry.authored.bindings) {
          applyVehicleState(bound, {
            wheelSpin: spin,
            steerAngle: steer,
            braking,
            headlights: vehicleSim.headlightsOn,
          })
        }
      } else {
        for (const wheel of entry.wheels) {
          wheel.wheel.rotation.x = spin
        }
        entry.wheels[0].pivot.rotation.y = steer
        entry.wheels[1].pivot.rotation.y = steer
        entry.brakeMaterial.emissiveIntensity = braking ? 1.6 : 0
        entry.headMaterial.emissiveIntensity = vehicleSim.headlightsOn ? 1.6 : 0
      }
    }
    for (const id of [...entries.current.keys()]) {
      if (!seen.has(id)) {
        const entry = entries.current.get(id)!
        // Despawning used to be removeFromParent() alone. A rig is roughly
        // eight geometries and six materials; every car that left the world
        // leaked all of them for the rest of the session.
        releaseEntry(entry)
        entries.current.delete(id)
      }
    }

    // Pedestrians: one small box per crosser, off one shared geometry and one
    // shared material. These were built inside this callback — two THREE
    // objects constructed and thrown away 60-100 times a second, and every
    // pedestrian added on the same frame shared an instance that the shrink
    // loop below then disposed per mesh, killing the survivors' buffers.
    const { geometry: pedGeometry, material: pedMaterial } = pedestrianResources()
    while (pedMeshes.current.length < vehicleSim.pedestrians.length) {
      const mesh = new THREE.Mesh(pedGeometry, pedMaterial)
      mesh.castShadow = true
      rigRoot.add(mesh)
      pedMeshes.current.push(mesh)
    }
    for (let i = 0; i < pedMeshes.current.length; i++) {
      const ped = vehicleSim.pedestrians[i]
      const mesh = pedMeshes.current[i]
      if (!ped) {
        mesh.visible = false
        continue
      }
      mesh.visible = true
      mesh.position.set(ped.pos.x, ped.pos.y, ped.pos.z)
      mesh.rotation.y = Math.atan2(ped.dir.x, ped.dir.z)
    }
    while (pedMeshes.current.length > vehicleSim.pedestrians.length) {
      const mesh = pedMeshes.current.pop()!
      // Detach only. The geometry and material are shared with every other
      // pedestrian; disposing them here is what removed one crosser and left
      // the rest drawing from a dead buffer.
      mesh.removeFromParent()
    }
  })

  return <group name="vehicle-rig" ref={root} />
}
