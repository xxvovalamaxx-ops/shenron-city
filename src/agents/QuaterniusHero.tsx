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
  /** Final standing height in metres. See agents/character-scale.ts. */
  height?: number
}

/** Higher-detail CC0 hero using Quaternius' matching 65-joint motion library. */
export function QuaterniusHero({
  motion,
  animationSpeed = 1,
  castShadow = true,
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
  const model = useMemo(() => {
    const instance = cloneSkeleton(source.scene) as THREE.Group
    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = castShadow
      object.receiveShadow = castShadow
      object.frustumCulled = true
    })
    return instance
  }, [castShadow, source.scene])

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
    action.clampWhenFinished = !loops
    action.setLoop(loops ? THREE.LoopRepeat : THREE.LoopOnce, loops ? Infinity : 1)
    action.fadeIn(0.2).play()
    return () => {
      action.fadeOut(0.16)
    }
  }, [animationSpeed, mixer, motion, source.animations])

  useEffect(
    () => () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(model)
    },
    [mixer, model],
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
