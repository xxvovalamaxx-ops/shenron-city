import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  SERVICE_ANDROID_STYLES,
  SERVICE_ANDROID_URL,
  type ServiceAndroidMotion,
  type ServiceAndroidStyle,
} from './service-android'
import { DEFAULT_CHARACTER_HEIGHT, heightScaleFor } from './character-scale'

interface Props {
  motion: ServiceAndroidMotion
  style: ServiceAndroidStyle
  animationSpeed?: number
  castShadow?: boolean
  expression?: 'neutral' | 'alert' | 'concerned'
  /** Final standing height in metres. See agents/character-scale.ts. */
  height?: number
}

/**
 * One independently animated clone of the audited CC0 service android.
 *
 * SkeletonUtils is required: Object3D.clone() shares the original skeleton and
 * makes separately animated characters corrupt one another. Geometry stays
 * shared, while the three tiny materials are cloned so each role can carry a
 * stable identity palette.
 */
export function ServiceAndroid({
  motion,
  style,
  animationSpeed = 1,
  castShadow = true,
  expression = 'neutral',
  height = DEFAULT_CHARACTER_HEIGHT,
}: Props) {
  const source = useGLTF(SERVICE_ANDROID_URL)
  const palette = SERVICE_ANDROID_STYLES[style]

  const { model, materials, face } = useMemo<{
    model: THREE.Group
    materials: THREE.Material[]
    face: THREE.Mesh | null
  }>(() => {
    // SkeletonUtils.clone copies world matrices as it finds them. If the
    // source has never been rendered its matrices are stale, and the clone
    // inherits garbage bounds — the Quaternius rig measured 0.754 m instead of
    // 1.187 m, so normalisation scaled it 2.32x and produced a 2.2 m player
    // floating half a metre off the ground. Update the source first.
    source.scene.updateMatrixWorld(true)
    const instance = cloneSkeleton(source.scene) as THREE.Group
    const ownedMaterials = new Set<THREE.Material>()
    let head: THREE.Mesh | null = null

    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = castShadow
      object.receiveShadow = castShadow
      object.frustumCulled = true

      const originals = Array.isArray(object.material) ? object.material : [object.material]
      const replacements = originals.map((original) => {
        const material = original.clone()
        ownedMaterials.add(material)
        if (material instanceof THREE.MeshStandardMaterial) {
          if (original.name === 'Main') {
            material.color.set(palette.body)
            material.roughness = 0.54
            material.metalness = 0.34
          } else if (original.name === 'Grey') {
            material.color.set(palette.accent)
            material.emissive.set(palette.accent)
            material.emissiveIntensity = 0.08
            material.roughness = 0.42
          } else if (original.name === 'Black') {
            material.color.set(palette.trim)
            material.roughness = 0.6
            material.metalness = 0.48
          }
        }
        return material
      })
      object.material = Array.isArray(object.material) ? replacements : replacements[0]

      if (object.morphTargetDictionary && object.morphTargetInfluences) head = object
    })

    return { model: instance, materials: [...ownedMaterials], face: head as THREE.Mesh | null }
  }, [castShadow, palette.accent, palette.body, palette.trim, source.scene])

  // Measured in the bind pose, before the mixer runs.
  const scale = useMemo(
    () => heightScaleFor(new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y, height),
    [model, height],
  )

  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model])

  useEffect(() => {
    const clip = THREE.AnimationClip.findByName(source.animations, motion)
    if (!clip) return
    const action = mixer.clipAction(clip)
    const oneShot = ['No', 'ThumbsUp', 'Wave', 'Yes'].includes(motion)
    action.reset().setEffectiveTimeScale(animationSpeed).setEffectiveWeight(1)
    action.clampWhenFinished = oneShot
    action.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity)
    action.fadeIn(0.22).play()
    return () => {
      action.fadeOut(0.18)
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

  useFrame((_, delta) => {
    mixer.update(Math.min(delta, 0.05))
    if (!face?.morphTargetDictionary || !face.morphTargetInfluences) return
    const target = expression === 'alert' ? 'Surprised' : expression === 'concerned' ? 'Sad' : null
    for (const [name, index] of Object.entries(face.morphTargetDictionary)) {
      face.morphTargetInfluences[index] = name === target ? 0.42 : 0
    }
  })

  return (
    <group scale={scale}>
      <primitive object={model} />
    </group>
  )
}

useGLTF.preload(SERVICE_ANDROID_URL)
