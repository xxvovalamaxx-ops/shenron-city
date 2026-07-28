import { useEffect, useMemo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  QUATERNIUS_HERO_URL,
  type QuaterniusHeroMotion,
} from './quaternius-hero'
import { DEFAULT_CHARACTER_HEIGHT, heightScaleFor } from './character-scale'

interface Props {
  motion: QuaterniusHeroMotion
  animationSpeed?: number
  castShadow?: boolean
  /** Stable contemporary-clothing tint variant; skin material is never tinted. */
  appearance?: number
  /** Deterministic normalized start offset so crowds do not move in lockstep. */
  phase?: number
  /** Final standing height in metres. See agents/character-scale.ts. */
  height?: number
}

const APPAREL_TINTS = [
  '#d5d8dc',
  '#24364a',
  '#654336',
  '#2e463d',
  '#51405f',
  '#9b8a6b',
  '#6b2525',
  '#34404b',
] as const

/** Higher-detail CC0 hero using Quaternius' matching 65-joint motion library. */
export function QuaterniusHero({
  motion,
  animationSpeed = 1,
  castShadow = true,
  appearance = 0,
  phase = 0,
  height = DEFAULT_CHARACTER_HEIGHT,
}: Props) {
  const source = useLoader(GLTFLoader, QUATERNIUS_HERO_URL, (loader) => {
    // Match the capybara's browser-safe path for embedded GLB textures.
    // Some Chromium/WebView GPU combinations advertise createImageBitmap but
    // fail to decode buffer-view images through it.
    loader.register((parser) => {
      const textureLoader = new THREE.TextureLoader(parser.options.manager)
      textureLoader.setCrossOrigin(parser.options.crossOrigin)
      textureLoader.setRequestHeader(parser.options.requestHeader)
      parser.textureLoader = textureLoader
      return { name: 'SHENRON_texture_loader_compatibility' }
    })
  })
  const { model, materials } = useMemo(() => {
    // SkeletonUtils.clone copies world matrices as it finds them. If the
    // source has never been rendered its matrices are stale, and the clone
    // inherits garbage bounds — the Quaternius rig measured 0.754 m instead of
    // 1.187 m, so normalisation scaled it 2.32x and produced a 2.2 m player
    // floating half a metre off the ground. Update the source first.
    source.scene.updateMatrixWorld(true)
    const instance = cloneSkeleton(source.scene) as THREE.Group
    const ownedMaterials = new Set<THREE.Material>()
    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = castShadow
      object.receiveShadow = castShadow
      object.frustumCulled = true
      const originals = Array.isArray(object.material) ? object.material : [object.material]
      const replacements = originals.map((original) => {
        if (
          !(original instanceof THREE.MeshStandardMaterial) ||
          !original.name.startsWith('MI_Ranger')
        ) {
          return original
        }
        const material = original.clone()
        material.color.set(APPAREL_TINTS[Math.abs(appearance) % APPAREL_TINTS.length])
        material.roughness = Math.max(0.48, material.roughness)
        ownedMaterials.add(material)
        return material
      })
      object.material = Array.isArray(object.material) ? replacements : replacements[0]
    })
    return { model: instance, materials: [...ownedMaterials] }
  }, [appearance, castShadow, source.scene])

  // Measured in the bind pose, before the mixer runs: the reference is the
  // model, not whichever animation frame happened to be up.
  const scale = useMemo(
    () => heightScaleFor(new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y, height),
    [model, height],
  )
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model])

  useEffect(() => {
    const clip = THREE.AnimationClip.findByName(source.animations, motion)
    if (!clip) return
    const action = mixer.clipAction(clip)
    const loops = motion.endsWith('_Loop')
    action.reset().setEffectiveTimeScale(animationSpeed).setEffectiveWeight(1)
    action.time = Math.max(0, Math.min(0.999, phase)) * clip.duration
    action.clampWhenFinished = !loops
    action.setLoop(loops ? THREE.LoopRepeat : THREE.LoopOnce, loops ? Infinity : 1)
    action.fadeIn(0.2).play()
    return () => {
      action.fadeOut(0.16)
    }
  }, [animationSpeed, mixer, motion, phase, source.animations])

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

  return (
    <group scale={scale}>
      <primitive object={model} />
    </group>
  )
}
