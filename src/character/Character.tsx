import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { rt } from '../gameplay/runtime'
import { AnimationController, type AnimName } from './animation-system'

const VRM_PATH = '/avatar.vrm'
const WALK_SPEED_THRESHOLD = 5.0

function getMovementAnim(
  hSpeed: number,
  sprint: boolean,
  jumping: boolean,
  falling: boolean,
  moveDx: number,
  moveDz: number,
  fwdX: number,
  fwdZ: number,
): AnimName {
  if (jumping || falling) return 'jump'
  if (hSpeed < 0.5) return 'idle'

  if (sprint) return 'sprint_forward'

  const dot = moveDx * fwdX + moveDz * fwdZ
  const cross = moveDx * fwdZ - moveDz * fwdX

  if (Math.abs(cross) > 0.5) {
    return cross > 0 ? 'walk_right' : 'walk_left'
  }
  return dot > 0 ? 'walk_forward' : 'walk_backward'
}

export function Character() {
  const groupRef = useRef<THREE.Group>(null)
  const vrmRef = useRef<VRM | null>(null)
  const animRef = useRef<AnimationController | null>(null)
  const vrmSceneRef = useRef<THREE.Group | null>(null)
  const [ready, setReady] = useState(false)
  const prevPos = useRef({ x: 0, z: 0 })

  useEffect(() => {
    // Standalone manager so this 15 MB load does not pollute
    // THREE.DefaultLoadingManager and block the loading gate.
    const vrmManager = new THREE.LoadingManager()
    const loader = new GLTFLoader(vrmManager)
    loader.register((parser) => new VRMLoaderPlugin(parser))

    let disposed = false

    loader.load(
      VRM_PATH,
      (gltf) => {
        if (disposed) return
        const vrm = gltf.userData.vrm as VRM
        if (!vrm) return

        VRMUtils.rotateVRM0(vrm)
        vrmRef.current = vrm
        vrm.scene.scale.set(1, 1, 1)

        const boneMap = new Map<string, string>()
        const bones = vrm.humanoid?.humanBones
        if (bones) {
          for (const [humanBoneName, humanBone] of Object.entries(bones)) {
            if (humanBone?.node) {
              boneMap.set(humanBoneName, humanBone.node.name)
            }
          }
        }

        const animController = new AnimationController(vrm.scene, boneMap)
        animRef.current = animController
        vrmSceneRef.current = vrm.scene
        setReady(true)
      },
      undefined,
      (err) => {
        console.warn('[Character] Could not load VRM:', err)
      },
    )

    return () => {
      disposed = true
      const c = animRef.current
      if (c) c.dispose()
      animRef.current = null
      vrmRef.current = null
      vrmSceneRef.current = null
    }
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const vrm = vrmRef.current
    const anim = animRef.current
    const group = groupRef.current

    if (!vrm || !anim || !group) {
      if (group && rt.player) {
        group.position.set(rt.player.pos.x, rt.player.pos.y, rt.player.pos.z)
      }
      return
    }

    const p = rt.player
    if (!p) return

    const { pos, velocityY, grounded, forward } = p

    const dx = pos.x - prevPos.current.x
    const dz = pos.z - prevPos.current.z
    const hSpeed = Math.hypot(dz, dx) / Math.max(dt, 0.001)
    prevPos.current = { x: pos.x, z: pos.z }

    group.position.set(pos.x, pos.y, pos.z)

    if (hSpeed > 0.05) {
      const targetAngle = Math.atan2(dx, dz)
      let currentAngle = group.rotation.y
      let diff = targetAngle - currentAngle
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      group.rotation.y += diff * Math.min(1, dt * 12)
    }

    if (anim.isReady) {
      const sprint = rt.keys.sprint && hSpeed > WALK_SPEED_THRESHOLD
      const isJumping = velocityY > 0.2 && !grounded
      const isFalling = !grounded && velocityY <= 0.2 && hSpeed < 0.5

      const len = Math.hypot(dx, dz) || 1
      const animName = getMovementAnim(
        hSpeed, sprint, isJumping, isFalling,
        dx / len, dz / len,
        forward.x, forward.z,
      )
      anim.play(animName)
    }

    vrm.update(dt)
    anim.update(dt)
  })

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {ready && vrmSceneRef.current && (
        <primitive object={vrmSceneRef.current} castShadow receiveShadow />
      )}
    </group>
  )
}
