import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { findHumanoidBone } from './bone-map'

export type AnimName = 'idle' | 'walk_forward' | 'walk_backward' | 'walk_left' | 'walk_right' | 'run_forward' | 'run_backward' | 'sprint_forward' | 'jump' | 'crouch_forward' | 'land'

const ANIM_FILES: Record<AnimName, string> = {
  idle: '/animations/idle.fbx',
  walk_forward: '/animations/walk_forward.fbx',
  walk_backward: '/animations/walk_backward.fbx',
  walk_left: '/animations/walk_left.fbx',
  walk_right: '/animations/walk_right.fbx',
  run_forward: '/animations/run_forward.fbx',
  run_backward: '/animations/run_backward.fbx',
  sprint_forward: '/animations/sprint_forward.fbx',
  jump: '/animations/jump.fbx',
  crouch_forward: '/animations/crouch_forward.fbx',
  land: '/animations/idle.fbx',
}

interface LoadedAnim {
  clip: THREE.AnimationClip
  duration: number
}

export class AnimationController {
  private mixer: THREE.AnimationMixer
  private actions = new Map<AnimName, THREE.AnimationAction>()
  private currentAnim: AnimName | null = null
  private crossFadeDuration = 0.2
  private loaded = new Map<AnimName, LoadedAnim>()
  private loadingPromises: Promise<void>[] = []
  private ready = false

  constructor(vrmScene: THREE.Group, vrmBoneNames: Map<string, string>) {
    this.mixer = new THREE.AnimationMixer(vrmScene)
    this.loadAll(vrmBoneNames)
  }

  private async loadAll(vrmBoneNames: Map<string, string>): Promise<void> {
    const loader = new FBXLoader()
    const entries = Object.entries(ANIM_FILES) as [AnimName, string][]

    this.loadingPromises = entries.map(async ([name, url]) => {
      try {
        const fbx = await loader.loadAsync(url)
        const clip = this.retargetClip(fbx, vrmBoneNames)
        if (clip) {
          this.loaded.set(name, { clip, duration: clip.duration })
        }
      } catch (err) {
        console.warn(`[Character] Failed to load animation "${name}":`, err)
      }
    })

    await Promise.allSettled(this.loadingPromises)

    const animNames = Object.keys(ANIM_FILES) as AnimName[]
    for (const name of animNames) {
      if (!this.loaded.has(name) && name !== 'land') {
        const fallback = this.loaded.get('idle')
        if (fallback) this.loaded.set(name, fallback)
      }
    }
    if (!this.loaded.has('land') && this.loaded.has('idle')) {
      this.loaded.set('land', this.loaded.get('idle')!)
    }

    this.ready = true

    for (const [name, anim] of this.loaded) {
      const action = this.mixer.clipAction(anim.clip)
      action.setEffectiveWeight(0)
      action.play()
      this.actions.set(name, action)
    }

    if (this.actions.has('idle')) {
      this.actions.get('idle')!.setEffectiveWeight(1)
      this.currentAnim = 'idle'
    }
  }

  private retargetClip(fbx: THREE.Group, vrmBoneMap: Map<string, string>): THREE.AnimationClip | null {
    if (!fbx.animations || fbx.animations.length === 0) return null

    const srcClip = fbx.animations[0]
    const newTracks: THREE.KeyframeTrack[] = []
    let remappedCount = 0

    for (const track of srcClip.tracks) {
      const pathParts = track.name.split('.')
      if (pathParts.length < 2) continue

      const bonePart = pathParts.slice(0, -1).join('.')
      const prop = pathParts[pathParts.length - 1]
      const isQ = prop === 'quaternion'
      const isP = prop === 'position'
      const isS = prop === 'scale'

      if (!isQ && !isP && !isS) continue

      const humanoidName = findHumanoidBone(bonePart)
      if (!humanoidName) continue

      const actualVrmBone = vrmBoneMap.get(humanoidName)
      if (!actualVrmBone) continue

      const newTrackName = `${actualVrmBone}.${prop}`
      const values = track.values.slice() as Float32Array | number[]

      if (isQ) {
        for (let i = 0; i < values.length; i += 4) {
          const x = values[i], y = values[i + 1], z = values[i + 2], w = values[i + 3]
          const len = Math.sqrt(x * x + y * y + z * z + w * w)
          if (len > 0) {
            values[i] /= len; values[i + 1] /= len; values[i + 2] /= len; values[i + 3] /= len
          }
        }
      }

      const Ctor = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
      const newTrack = new Ctor(
        newTrackName,
        track.times.slice() as Float32Array,
        values as Float32Array,
      )
      newTracks.push(newTrack)
      remappedCount++
    }

    if (newTracks.length === 0) return null

    return new THREE.AnimationClip(srcClip.name, srcClip.duration, newTracks)
  }

  getMixer(): THREE.AnimationMixer {
    return this.mixer
  }

  get readyPromise(): Promise<void> {
    return Promise.allSettled(this.loadingPromises).then(() => {})
  }

  get isReady(): boolean {
    return this.ready
  }

  play(name: AnimName, fadeDuration?: number): void {
    if (!this.ready) return
    if (name === this.currentAnim) return

    const next = this.actions.get(name)
    if (!next) return

    const prev = this.currentAnim ? this.actions.get(this.currentAnim) : null
    const fade = fadeDuration ?? this.crossFadeDuration

    if (prev && prev !== next) {
      next.reset().setEffectiveWeight(1).play()
      next.crossFadeFrom(prev, fade, false)
    } else {
      next.reset().setEffectiveWeight(1).play()
    }
    this.currentAnim = name
  }

  update(dt: number): void {
    if (!this.ready) return
    this.mixer.update(dt)
  }

  dispose(): void {
    this.mixer.stopAllAction()
  }
}
