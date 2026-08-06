/**
 * Renders everything the dev menu has spawned. Each unique URL is loaded once
 * (useLoader caches) and instanced in place; entities are immutable once
 * placed, so the scene re-renders only when the spawn list changes.
 */
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useDevSpawns, type DevSpawn } from '../gameplay/dev-spawns'

function SpawnedModel({ spawn }: { spawn: DevSpawn }) {
  const gltf = useLoader(GLTFLoader, spawn.url)
  return (
    <group position={[spawn.x, spawn.y, spawn.z]} rotation={[0, spawn.yaw, 0]} scale={spawn.scale}>
      <primitive object={gltf.scene.clone(true)} />
    </group>
  )
}

export function DevSpawns() {
  const spawns = useDevSpawns((s) => s.spawns)
  return (
    <group name="dev-spawns">
      {spawns.map((spawn) => (
        <SpawnedModel key={spawn.id} spawn={spawn} />
      ))}
    </group>
  )
}

export function spawnBounds(spawn: DevSpawn): THREE.Box3 | null {
  void spawn
  return null
}
