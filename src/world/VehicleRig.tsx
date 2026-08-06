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
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { vehicleSim } from '../gameplay/vehicles/vehicle-session'
import { vehicleSpec } from '../gameplay/vehicles/vehicle-specs'
import type { VehicleEntity } from '../gameplay/vehicles/vehicle-entities'

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

interface WheelRig {
  pivot: THREE.Group
  wheel: THREE.Mesh
}

interface VehicleRigEntry {
  group: THREE.Group
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
    wheels,
    brakeLights,
    headlights,
    brakeMaterial,
    headMaterial,
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
  }
}

export function VehicleRig() {
  const root = useRef<THREE.Group>(null)
  const entries = useRef(new Map<number, VehicleRigEntry>())
  const pedMeshes = useRef<THREE.Mesh[]>([])

  useEffect(
    () => () => {
      for (const entry of entries.current.values()) {
        entry.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose()
            const material = obj.material
            if (Array.isArray(material)) material.forEach((m) => m.dispose())
            else material.dispose()
          }
        })
        entry.group.removeFromParent()
      }
      entries.current.clear()
      for (const mesh of pedMeshes.current) {
        mesh.geometry.dispose()
        const material = mesh.material
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material.dispose()
      }
      pedMeshes.current = []
    },
    [],
  )

  useFrame(() => {
    const rigRoot = root.current
    if (!rigRoot) return

    // Keep a rig per vehicle, created and destroyed with the entity.
    const seen = new Set<number>()
    for (const entity of vehicleSim.registry.vehicles.values()) {
      seen.add(entity.id)
      let entry = entries.current.get(entity.id)
      if (!entry) {
        entry = buildVehicleRig(entity)
        rigRoot.add(entry.group)
        entries.current.set(entity.id, entry)
      }

      entry.group.position.set(entity.pose.pos.x, entity.pose.pos.y, entity.pose.pos.z)
      entry.group.rotation.y = entity.pose.heading

      entry.forward.set(Math.sin(entity.pose.heading), 0, Math.cos(entity.pose.heading))
      entry.right.set(-entry.forward.z, 0, entry.forward.x)
      const spin = entity.motion.wheelSpin
      const steer = entity.motion.steerAngle
      for (const wheel of entry.wheels) {
        wheel.wheel.rotation.x = spin
      }
      entry.wheels[0].pivot.rotation.y = steer
      entry.wheels[1].pivot.rotation.y = steer

      const braking = entity.motion.braking || entity.state === 'PARKED'
      entry.brakeMaterial.emissiveIntensity = braking ? 1.6 : 0
      entry.headMaterial.emissiveIntensity = vehicleSim.headlightsOn ? 1.6 : 0
    }
    for (const id of [...entries.current.keys()]) {
      if (!seen.has(id)) {
        const entry = entries.current.get(id)!
        entry.group.removeFromParent()
        entries.current.delete(id)
      }
    }

    // Pedestrians: one small box per crosser.
    const pedGeometry = new THREE.BoxGeometry(0.42, 1.7, 0.26)
    const pedMaterial = new THREE.MeshStandardMaterial({ color: '#4a5a6a', roughness: 0.8 })
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
      mesh.removeFromParent()
      mesh.geometry.dispose()
      const material = mesh.material
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material.dispose()
    }
  })

  return <group name="vehicle-rig" ref={root} />
}
