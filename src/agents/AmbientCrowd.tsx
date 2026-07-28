/**
 * Lightweight ambient pedestrians following deterministic authored loops.
 *
 * They are visual life, not autonomous agents: no navigation service, model,
 * network, or host integration is involved. Seven instanced meshes render the
 * articulated crowd: torso, head, hair, paired arms, and paired legs.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ambientPedestrianPose, pedestrianGait } from './ambient-routes'

const CLOTHING = ['#4f6f8f', '#934f65', '#3c7668', '#8b6a42', '#69568f', '#556270']
const TROUSERS = ['#1f2937', '#2f3542', '#31343b', '#243447']
const HAIR = ['#17120f', '#3b2a20', '#5b4636', '#25201d', '#6b4a2e']
const SKIN = ['#c99573', '#8e654f', '#d8b08f', '#6f4a3a', '#e0ba98']

export function AmbientCrowd({ count }: { count: number }) {
  const torsos = useRef<THREE.InstancedMesh>(null)
  const heads = useRef<THREE.InstancedMesh>(null)
  const hair = useRef<THREE.InstancedMesh>(null)
  const leftArms = useRef<THREE.InstancedMesh>(null)
  const rightArms = useRef<THREE.InstancedMesh>(null)
  const leftLegs = useRef<THREE.InstancedMesh>(null)
  const rightLegs = useRef<THREE.InstancedMesh>(null)
  const transform = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])

  useLayoutEffect(() => {
    const meshes = {
      torso: torsos.current,
      head: heads.current,
      hair: hair.current,
      leftArm: leftArms.current,
      rightArm: rightArms.current,
      leftLeg: leftLegs.current,
      rightLeg: rightLegs.current,
    }
    if (Object.values(meshes).some((mesh) => !mesh)) return

    for (let i = 0; i < count; i++) {
      meshes.torso!.setColorAt(i, color.setStyle(CLOTHING[i % CLOTHING.length]))
      color.setStyle(SKIN[i % SKIN.length])
      meshes.head!.setColorAt(i, color)
      meshes.leftArm!.setColorAt(i, color)
      meshes.rightArm!.setColorAt(i, color)
      meshes.hair!.setColorAt(i, color.setStyle(HAIR[i % HAIR.length]))
      color.setStyle(TROUSERS[i % TROUSERS.length])
      meshes.leftLeg!.setColorAt(i, color)
      meshes.rightLeg!.setColorAt(i, color)
    }
    for (const mesh of Object.values(meshes)) {
      if (mesh!.instanceColor) mesh!.instanceColor!.needsUpdate = true
    }
  }, [color, count])

  useFrame((state) => {
    const meshes = [
      torsos.current,
      heads.current,
      hair.current,
      leftArms.current,
      rightArms.current,
      leftLegs.current,
      rightLegs.current,
    ]
    if (meshes.some((mesh) => !mesh)) return

    const elapsed = state.clock.elapsedTime
    for (let i = 0; i < count; i++) {
      const sample = ambientPedestrianPose(i, elapsed)
      const gait = pedestrianGait(i, elapsed)
      const size = 0.94 + (i % 5) * 0.025
      const sideX = Math.cos(sample.heading)
      const sideZ = -Math.sin(sample.heading)

      transform.position.set(sample.x, 1.18 * size + gait.bob, sample.z)
      transform.rotation.set(0, sample.heading, gait.sway)
      transform.scale.setScalar(size)
      transform.updateMatrix()
      torsos.current!.setMatrixAt(i, transform.matrix)

      transform.position.set(sample.x, 1.73 * size + gait.bob, sample.z)
      transform.rotation.set(0, sample.heading, 0)
      transform.scale.setScalar(size)
      transform.updateMatrix()
      heads.current!.setMatrixAt(i, transform.matrix)

      transform.position.set(sample.x, 1.82 * size + gait.bob, sample.z - 0.01)
      transform.scale.set(size, size * 0.52, size)
      transform.updateMatrix()
      hair.current!.setMatrixAt(i, transform.matrix)

      for (const side of [-1, 1] as const) {
        const armX = sample.x + sideX * side * 0.34 * size
        const armZ = sample.z + sideZ * side * 0.34 * size
        transform.position.set(armX, 1.18 * size + gait.bob, armZ)
        transform.rotation.set(side * gait.stride, sample.heading, side * -0.08)
        transform.scale.setScalar(size)
        transform.updateMatrix()
        ;(side < 0 ? leftArms.current! : rightArms.current!).setMatrixAt(i, transform.matrix)

        const legX = sample.x + sideX * side * 0.13 * size
        const legZ = sample.z + sideZ * side * 0.13 * size
        transform.position.set(legX, 0.46 * size + gait.bob, legZ)
        transform.rotation.set(side * -gait.stride, sample.heading, 0)
        transform.scale.setScalar(size)
        transform.updateMatrix()
        ;(side < 0 ? leftLegs.current! : rightLegs.current!).setMatrixAt(i, transform.matrix)
      }
    }
    for (const mesh of meshes) mesh!.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={torsos} args={[undefined, undefined, count]} frustumCulled={false}>
        <capsuleGeometry args={[0.25, 0.54, 6, 10]} />
        <meshStandardMaterial roughness={0.78} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.2, 12, 9]} />
        <meshStandardMaterial roughness={0.72} />
      </instancedMesh>
      <instancedMesh ref={hair} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.205, 12, 8]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={leftArms} args={[undefined, undefined, count]} frustumCulled={false}>
        <capsuleGeometry args={[0.075, 0.48, 5, 8]} />
        <meshStandardMaterial roughness={0.76} />
      </instancedMesh>
      <instancedMesh ref={rightArms} args={[undefined, undefined, count]} frustumCulled={false}>
        <capsuleGeometry args={[0.075, 0.48, 5, 8]} />
        <meshStandardMaterial roughness={0.76} />
      </instancedMesh>
      <instancedMesh ref={leftLegs} args={[undefined, undefined, count]} frustumCulled={false}>
        <capsuleGeometry args={[0.09, 0.56, 5, 8]} />
        <meshStandardMaterial roughness={0.84} />
      </instancedMesh>
      <instancedMesh ref={rightLegs} args={[undefined, undefined, count]} frustumCulled={false}>
        <capsuleGeometry args={[0.09, 0.56, 5, 8]} />
        <meshStandardMaterial roughness={0.84} />
      </instancedMesh>
    </>
  )
}
