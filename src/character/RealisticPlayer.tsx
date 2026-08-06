/**
 * The player's visible body: a realistic CC3 business man (Sketchfab,
 * `Eric_Rigged_Business_Man.glb`) driven by the Quaternius 65-joint locomotion
 * clips, retargeted once to his 89-bone skeleton by
 * `scripts/retarget/bake-retarget.py` and shipped as `player-clips.glb`.
 *
 * Retargeting happens offline in Blender (world-space copy-rotation, baked),
 * so runtime cost is identical to any skinned mesh: one mixer, five clips.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { rt } from '../gameplay/runtime'
import type { PlayerMotion } from './player-locomotion'

export const REALISTIC_PLAYER_URL = '/models/characters/player/player.glb?v=1'
export const REALISTIC_PLAYER_CLIPS_URL = '/models/characters/player/player-clips.glb?v=1'

/** Final standing height of the player, metres. */
export const PLAYER_TARGET_HEIGHT = 1.8

interface Props {
  motion: PlayerMotion
  animationSpeed?: number
  castShadow?: boolean
}

export function RealisticPlayer({ motion, animationSpeed = 1, castShadow = true }: Props) {
  const source = useLoader(GLTFLoader, REALISTIC_PLAYER_URL, (loader) => {
    // Match the hero's browser-safe path for embedded GLB textures: some
    // Chromium/WebView GPU combinations advertise createImageBitmap but fail
    // to decode buffer-view images through it.
    loader.register((parser) => {
      const textureLoader = new THREE.TextureLoader(parser.options.manager)
      textureLoader.setCrossOrigin(parser.options.crossOrigin)
      textureLoader.setRequestHeader(parser.options.requestHeader)
      parser.textureLoader = textureLoader
      return { name: 'SHENRON_texture_loader_compatibility' }
    })
  })
  const clipSource = useLoader(GLTFLoader, REALISTIC_PLAYER_CLIPS_URL)

  const { model } = useMemo(() => {
    source.scene.updateMatrixWorld(true)
    const instance = cloneSkeleton(source.scene) as THREE.Group
    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = castShadow
      object.receiveShadow = castShadow
      object.frustumCulled = true
    })
    return { model: instance }
  }, [source.scene, castShadow])

  // Eric is exported in centimetres (~186 m tall in Blender metres), so the
  // bind-pose height normalisation shrinks him to PLAYER_TARGET_HEIGHT.
  const scale = useMemo(() => {
    const size = new THREE.Box3()
      .setFromObject(model)
      .getSize(new THREE.Vector3())
    const bindHeight = size.y || 1.8
    return PLAYER_TARGET_HEIGHT / bindHeight
  }, [model])

  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model])

  const clips = useMemo(() => {
    const byName = new Map<string, THREE.AnimationClip>()
    for (const clip of clipSource.animations) byName.set(clip.name, clip)
    return byName
  }, [clipSource.animations])

  useEffect(() => {
    const clip = clips.get(motion)
    if (!clip) return
    const action = mixer.clipAction(clip)
    const loops = motion.endsWith('_Loop')
    action.reset().setEffectiveWeight(1)
    action.clampWhenFinished = !loops
    action.setLoop(loops ? THREE.LoopRepeat : THREE.LoopOnce, loops ? Infinity : 1)
    action.fadeIn(0.18).play()
    return () => {
      action.fadeOut(0.14)
    }
  }, [mixer, motion, clips])

  useEffect(() => {
    const clip = clips.get(motion)
    if (!clip) return
    mixer.clipAction(clip).setEffectiveTimeScale(animationSpeed)
  }, [animationSpeed, mixer, motion, clips])

  useEffect(
    () => () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(model)
    },
    [mixer, model],
  )

  useFrame((_, delta) => {
    if (rt.paused) return
    mixer.update(Math.min(delta, 0.05))
  })

  return (
    <group scale={scale}>
      <primitive object={model} />
    </group>
  )
}
