/**
 * Yuka-powered NPC AI with steering behaviors.
 *
 * Each NPC has a yuka Vehicle with:
 * - Path following along its authored route
 * - Obstacle avoidance (other NPCs)
 * - Smooth steering with max speed and max force
 *
 * This replaces the purely visual AmbientCrowd with AI-driven agents.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Vehicle, Path, FollowPathBehavior, ObstacleAvoidanceBehavior, Vector3 as YukaVector3 } from 'yuka'
import { AMBIENT_ROUTES, type RoutePoint } from '../world/city-data'

const NPC_SPEED = 2.0
const NPC_MAX_FORCE = 5.0

interface NPCState {
  vehicle: Vehicle
  mesh: THREE.Object3D
  avoidBehavior: ObstacleAvoidanceBehavior
}

function createPath(points: readonly RoutePoint[]): Path {
  const path = new Path()
  for (const p of points) {
    path.add(new YukaVector3(p.x, 0, p.z))
  }
  path.loop = true
  return path
}

function createNPC(index: number): NPCState {
  const route = AMBIENT_ROUTES[index % AMBIENT_ROUTES.length]
  const path = createPath(route.points)
  const vehicle = new Vehicle()

  vehicle.maxSpeed = NPC_SPEED + (index % 5) * 0.15
  vehicle.maxForce = NPC_MAX_FORCE
  vehicle.boundingRadius = 0.26

  const followBehavior = new FollowPathBehavior(path)
  followBehavior.nextWaypointDistance = 0.5
  vehicle.steering.add(followBehavior)

  const avoidBehavior = new ObstacleAvoidanceBehavior()
  avoidBehavior.dBoxMinLength = 2
  vehicle.steering.add(avoidBehavior)

  const startPos = path.current()
  if (startPos) vehicle.position.copy(startPos)

  const mesh = new THREE.Object3D()
  mesh.position.copy(vehicle.position)

  return { vehicle, mesh, avoidBehavior }
}

const NPC_COUNT = AMBIENT_ROUTES.length * 3

export function YukaCrowd() {
  const npcs = useRef<NPCState[]>([])
  const bodies = useRef<THREE.InstancedMesh>(null)
  const heads = useRef<THREE.InstancedMesh>(null)
  const transform = useRef(new THREE.Object3D())

  if (npcs.current.length === 0) {
    for (let i = 0; i < NPC_COUNT; i++) {
      npcs.current.push(createNPC(i))
    }
  }

  useFrame((state, dt) => {
    const bodyMesh = bodies.current
    const headMesh = heads.current
    if (!bodyMesh || !headMesh) return

    const t = transform.current

    for (let i = 0; i < npcs.current.length; i++) {
      const npc = npcs.current[i]

      const nearby: Vehicle[] = []
      for (let j = 0; j < npcs.current.length; j++) {
        if (j !== i) nearby.push(npcs.current[j].vehicle)
      }
      npc.avoidBehavior.obstacles = nearby

      npc.vehicle.update(dt)

      npc.mesh.position.copy(npc.vehicle.position)
    }

    for (let i = 0; i < NPC_COUNT; i++) {
      const npc = npcs.current[i]
      const bob = Math.sin(state.clock.elapsedTime * 7 + i) * 0.025

      t.position.set(npc.mesh.position.x, 0.92 + bob, npc.mesh.position.z)
      t.quaternion.identity()
      t.scale.set(0.26, 0.38, 0.26)
      t.updateMatrix()
      bodyMesh.setMatrixAt(i, t.matrix)

      t.position.set(npc.mesh.position.x, 1.65 + bob, npc.mesh.position.z)
      t.scale.setScalar(0.2)
      t.updateMatrix()
      headMesh.setMatrixAt(i, t.matrix)
    }

    bodyMesh.instanceMatrix.needsUpdate = true
    headMesh.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={bodies} args={[undefined, undefined, NPC_COUNT]} frustumCulled={false}>
        <capsuleGeometry args={[1, 1, 4, 8]} />
        <meshStandardMaterial roughness={0.78} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, NPC_COUNT]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial roughness={0.72} />
      </instancedMesh>
    </>
  )
}
