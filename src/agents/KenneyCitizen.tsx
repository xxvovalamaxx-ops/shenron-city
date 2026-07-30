import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  KENNEY_CITIZEN_CLIPS,
  KENNEY_CITIZEN_SKINS,
  KENNEY_CITIZEN_URL,
  type KenneyCitizenMotion,
  type KenneyCitizenSkin,
} from './kenney-citizen'
import { DEFAULT_CHARACTER_HEIGHT, heightScaleFor } from './character-scale'
import { dropArms, LEFT_ARM_BONE, RIGHT_ARM_BONE } from './arm-pose'
import { rt } from '../gameplay/runtime'

interface Props {
  motion: KenneyCitizenMotion
  skin: KenneyCitizenSkin
  animationSpeed?: number
  castShadow?: boolean
  /** Final standing height in metres. See agents/character-scale.ts. */
  height?: number
}

/** One independently animated CC0 Kenney citizen with a swappable audited skin. */
export function KenneyCitizen({
  motion,
  skin,
  animationSpeed = 1,
  castShadow = true,
  height = DEFAULT_CHARACTER_HEIGHT,
}: Props) {
  const source = useGLTF(KENNEY_CITIZEN_URL)
  const texture = useTexture(KENNEY_CITIZEN_SKINS[skin])

  const { model, materials, naturalHeight } = useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = false
    texture.needsUpdate = true
    // SkeletonUtils.clone copies world matrices as it finds them. If the
    // source has never been rendered its matrices are stale, and the clone
    // inherits garbage bounds — the Quaternius rig measured 0.754 m instead of
    // 1.187 m, so normalisation scaled it 2.32x and produced a 2.2 m player
    // floating half a metre off the ground. Update the source first.
    source.scene.updateMatrixWorld(true)

    const instance = cloneSkeleton(source.scene) as THREE.Group
    const owned = new Set<THREE.Material>()
    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = castShadow
      object.receiveShadow = castShadow
      object.frustumCulled = true

      const originals = Array.isArray(object.material) ? object.material : [object.material]
      const replacements = originals.map((original) => {
        const material = original.clone()
        owned.add(material)
        if (material instanceof THREE.MeshStandardMaterial) {
          material.map = texture
          material.color.set('#ffffff')
          material.roughness = 0.66
          material.metalness = 0
          material.needsUpdate = true
        }
        return material
      })
      object.material = Array.isArray(object.material) ? replacements : replacements[0]
    })

    // Measured in the bind pose, before the mixer runs, so the reference is the
    // model itself rather than whichever animation frame happened to be up.
    const measured = new THREE.Box3().setFromObject(instance).getSize(new THREE.Vector3()).y
    return { model: instance, materials: [...owned], naturalHeight: measured }
  }, [castShadow, source.scene, texture])

  const scale = heightScaleFor(naturalHeight, height)

  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model])

  useEffect(() => {
    const clip = THREE.AnimationClip.findByName(source.animations, motion)
    if (!clip) return
    const action = mixer.clipAction(clip)
    const oneShot = motion === 'Jump'
    action.reset().setEffectiveTimeScale(animationSpeed).setEffectiveWeight(1)
    action.clampWhenFinished = oneShot
    action.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity)
    action.fadeIn(0.2).play()
    return () => {
      action.fadeOut(0.16)
    }
  }, [animationSpeed, mixer, motion, source.animations])

  useEffect(
    () => () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(model)
      for (const material of materials) material.dispose()
    },
    [materials, mixer, model],
  )

  // Looked up once: a name search per bone per frame across a whole crowd is
  // not free, and the rig never changes after the clone.
  const arms = useMemo(
    () => ({
      left: model.getObjectByName(LEFT_ARM_BONE) ?? null,
      right: model.getObjectByName(RIGHT_ARM_BONE) ?? null,
    }),
    [model],
  )

  useFrame((_, delta) => {
    if (rt.paused) return
    mixer.update(Math.min(delta, 0.05))
    // After the mixer, never before: it overwrites bone rotation wholesale
    // each frame, which is what keeps this additive rather than accumulating.
    dropArms(arms.left, arms.right)
  })

  return (
    <group scale={scale}>
      <primitive object={model} />
    </group>
  )
}

useGLTF.preload(KENNEY_CITIZEN_URL)
for (const url of Object.values(KENNEY_CITIZEN_SKINS)) useTexture.preload(url)

export { KENNEY_CITIZEN_CLIPS }
