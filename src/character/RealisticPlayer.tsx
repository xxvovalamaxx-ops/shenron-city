/**
 * The player's visible body: a realistic CC3 business man (Sketchfab,
 * `Eric_Rigged_Business_Man.glb`) driven by the Quaternius 65-joint locomotion
 * clips, retargeted once to his 89-bone skeleton by
 * `scripts/retarget/bake-retarget.py` and shipped as `player-clips.glb`.
 *
 * Retargeting happens offline in Blender (a per-frame rest-relative retarget,
 * baked), so runtime cost is one mixer and seven clips.
 *
 * All seven clips play at once and the frame sets their weights and times
 * (`locomotion-blend.ts`): a speed blend across idle/walk/jog/sprint on one
 * shared stride phase, with take-off, fall and landing layered over it. There
 * is no React state here — the body reads `playerMotion` every frame.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { rt } from '../gameplay/runtime'
import { playerMotion } from '../gameplay/player/player-motion'
import { stepDt } from '../gameplay/player/sim-step'
import {
  airLayer,
  bodyWeights,
  dominantClip,
  locomotionWeights,
  strideRate,
  type BodyClip,
  type LocomotionClip,
} from './locomotion-blend'

export const REALISTIC_PLAYER_URL = '/models/characters/player/player.glb?v=1'
export const REALISTIC_PLAYER_CLIPS_URL = '/models/characters/player/player-clips.glb?v=2'

/** Final standing height of the player, metres. */
export const PLAYER_TARGET_HEIGHT = 1.8

const BODY_CLIPS: readonly BodyClip[] = [
  'Idle_Loop',
  'Walk_Loop',
  'Jog_Fwd_Loop',
  'Sprint_Loop',
  'Jump_Start',
  'Jump_Loop',
  'Jump_Land',
]
const STRIDE_CLIPS: readonly LocomotionClip[] = ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop']

interface Props {
  castShadow?: boolean
  /** Called with the heaviest clip whenever it changes (QA readout). */
  onDominantClip?(clip: BodyClip): void
}

export function RealisticPlayer({ castShadow = true, onDominantClip }: Props) {
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
      // Skinned bounds are the bind pose's; a running pose leaves them, and a
      // culled player one frame in ten is worse than one extra draw.
      object.frustumCulled = false
    })
    return { model: instance }
  }, [source.scene, castShadow])

  // Eric is exported in centimetres (~186 m tall in Blender metres), so the
  // bind-pose height normalisation shrinks him to PLAYER_TARGET_HEIGHT.
  const scale = useMemo(() => {
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
    const bindHeight = size.y || 1.8
    return PLAYER_TARGET_HEIGHT / bindHeight
  }, [model])

  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model])

  type Entry = { action: THREE.AnimationAction; duration: number }
  const actions = useRef(new Map<BodyClip, Entry>())
  const durations = useRef<Partial<Record<LocomotionClip, number>>>({})

  // Actions are created in an effect, not a memo: StrictMode (which R3F v9
  // inherits) runs every effect's cleanup once on mount, and the cleanup
  // below uncaches the mixer — memoised actions would be dead on arrival.
  useEffect(() => {
    const byName = new Map<string, THREE.AnimationClip>()
    for (const clip of clipSource.animations) byName.set(clip.name, clip)
    const out = new Map<BodyClip, Entry>()
    for (const name of BODY_CLIPS) {
      const clip = byName.get(name)
      if (!clip) continue
      const action = mixer.clipAction(clip)
      action.setLoop(THREE.LoopRepeat, Infinity)
      // Time is driven explicitly below; the mixer only samples and blends.
      action.setEffectiveTimeScale(0)
      action.enabled = name === 'Idle_Loop'
      action.setEffectiveWeight(name === 'Idle_Loop' ? 1 : 0)
      action.play()
      out.set(name, { action, duration: Math.max(1e-3, clip.duration) })
    }
    const d: Partial<Record<LocomotionClip, number>> = {}
    for (const clip of STRIDE_CLIPS) {
      const entry = out.get(clip)
      if (entry) d[clip] = entry.duration
    }
    actions.current = out
    durations.current = d
    return () => {
      for (const { action } of out.values()) action.stop()
      actions.current = new Map()
    }
  }, [mixer, clipSource.animations])

  useEffect(
    () => () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(model)
    },
    [mixer, model],
  )

  const stride = useRef(0)
  const idleClock = useRef(0)
  const dominant = useRef<BodyClip>('Idle_Loop')
  const onDominant = useRef(onDominantClip)
  onDominant.current = onDominantClip

  useFrame((_, delta) => {
    if (rt.paused) return
    const dt = stepDt(delta, 0.05)
    const m = playerMotion
    const now = rt.clock.elapsed
    const speed = m.groundSpeed

    const air = airLayer({
      now,
      grounded: m.grounded,
      jumpedAt: m.jumpedAt,
      landedAt: m.landedAt,
      lastAirTime: m.lastAirTime,
      airborneSince: m.airborneSince,
    })
    const weights = bodyWeights(speed, air)
    stride.current = (stride.current + strideRate(speed, locomotionWeights(speed), durations.current) * dt) % 1
    idleClock.current += dt

    for (const [name, { action, duration }] of actions.current) {
      const w = weights[name]
      action.enabled = w > 1e-3
      action.setEffectiveWeight(action.enabled ? w : 0)
      if (!action.enabled) continue
      let t: number
      switch (name) {
        case 'Idle_Loop':
          t = idleClock.current % duration
          break
        case 'Jump_Start':
          t = Math.min(duration - 1e-3, air.startTime)
          break
        case 'Jump_Loop': {
          const airborne = now - m.airborneSince
          t = Number.isFinite(airborne) ? Math.max(0, airborne) % duration : 0
          break
        }
        case 'Jump_Land':
          t = Math.min(duration - 1e-3, air.landTime)
          break
        default:
          t = stride.current * duration
      }
      action.time = t
    }
    mixer.update(dt)

    const top = dominantClip(weights)
    if (top !== dominant.current) {
      dominant.current = top
      onDominant.current?.(top)
    }
  })

  return (
    <group scale={scale}>
      <primitive object={model} />
    </group>
  )
}
