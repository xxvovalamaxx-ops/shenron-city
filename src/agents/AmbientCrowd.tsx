/**
 * Lightweight ambient pedestrians following deterministic authored loops.
 *
 * They are visual life, not autonomous agents: no navigation service, model,
 * network or host integration is involved. Two instanced meshes render the
 * entire crowd.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ambientPedestrianPose } from './ambient-routes'

const CLOTHING = ['#4f6f8f', '#934f65', '#3c7668', '#8b6a42', '#69568f', '#556270']

export function AmbientCrowd({ count }: { count: number }) {
  const bodies = useRef<THREE.InstancedMesh>(null)
  const heads = useRef<THREE.InstancedMesh>(null)
  const transform = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])

  useLayoutEffect(() => {
    const bodyMesh = bodies.current
    const headMesh = heads.current
    if (!bodyMesh || !headMesh) return

    for (let i = 0; i < count; i++) {
      color.setStyle(CLOTHING[i % CLOTHING.length])
      bodyMesh.setColorAt(i, color)
      color.setStyle(i % 3 === 0 ? '#c99573' : i % 3 === 1 ? '#8e654f' : '#d8b08f')
      headMesh.setColorAt(i, color)
    }
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true
    if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true
  }, [color, count])

  useFrame((state) => {
    const bodyMesh = bodies.current
    const headMesh = heads.current
    if (!bodyMesh || !headMesh) return

    const elapsed = state.clock.elapsedTime
    for (let i = 0; i < count; i++) {
      const sample = ambientPedestrianPose(i, elapsed)
      const bob = Math.sin(elapsed * 7 + i) * 0.025

      transform.position.set(sample.x, 0.92 + bob, sample.z)
      transform.rotation.set(0, sample.heading, 0)
      transform.scale.set(0.26, 0.38, 0.26)
      transform.updateMatrix()
      bodyMesh.setMatrixAt(i, transform.matrix)

      transform.position.set(sample.x, 1.65 + bob, sample.z)
      transform.scale.setScalar(0.2)
      transform.updateMatrix()
      headMesh.setMatrixAt(i, transform.matrix)
    }
    bodyMesh.instanceMatrix.needsUpdate = true
    headMesh.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={bodies} args={[undefined, undefined, count]} frustumCulled={false}>
        <capsuleGeometry args={[1, 1, 4, 8]} />
        <meshStandardMaterial roughness={0.78} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial roughness={0.72} />
      </instancedMesh>
    </>
  )
}
