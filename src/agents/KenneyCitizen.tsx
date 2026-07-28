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

interface Props {
  motion: KenneyCitizenMotion
  skin: KenneyCitizenSkin
  animationSpeed?: number
  castShadow?: boolean
}

/** One independently animated CC0 Kenney citizen with a swappable audited skin. */
export function KenneyCitizen({
  motion,
  skin,
  animationSpeed = 1,
  castShadow = true,
}: Props) {
  const source = useGLTF(KENNEY_CITIZEN_URL)
  const texture = useTexture(KENNEY_CITIZEN_SKINS[skin])

  const { model, materials } = useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = false
    texture.needsUpdate = true

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
    return { model: instance, materials: [...owned] }
  }, [castShadow, source.scene, texture])

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

  useFrame((_, delta) => {
    mixer.update(Math.min(delta, 0.05))
  })

  return <primitive object={model} />
}

useGLTF.preload(KENNEY_CITIZEN_URL)
for (const url of Object.values(KENNEY_CITIZEN_SKINS)) useTexture.preload(url)

export { KENNEY_CITIZEN_CLIPS }
