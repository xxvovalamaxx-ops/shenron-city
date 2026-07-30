import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { useAnimations } from '@react-three/drei'
import { TextureLoader, type AnimationAction, type Group, type Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { rt } from '../gameplay/runtime'
import { CAPYBARA_EXPECTED_CLIPS, CAPYBARA_MODEL_URL } from './capybara'
import { inputLocked, useHud } from '../ui/hud-store'
import { outdoorSimulationActive } from '../gameplay/zone'

export function Capybara({ shadows }: { shadows: boolean }) {
  const gltf = useLoader(GLTFLoader, CAPYBARA_MODEL_URL, (loader) => {
    // Some Chromium/WebView GPU combinations expose createImageBitmap but
    // cannot decode GLB buffer-view blobs through it. Force Three's DOM image
    // path so embedded PBR textures work consistently in browsers and the
    // desktop preview; this remains entirely same-origin.
    loader.register((parser) => {
      const textureLoader = new TextureLoader(parser.options.manager)
      textureLoader.setCrossOrigin(parser.options.crossOrigin)
      textureLoader.setRequestHeader(parser.options.requestHeader)
      parser.textureLoader = textureLoader
      return { name: 'SHENRON_texture_loader_compatibility' }
    })
  })
  const instance = useMemo(() => clone(gltf.scene), [gltf.scene])
  const root = useRef<Group>(null)
  const currentAction = useRef<AnimationAction | null>(null)
  const { actions, names, mixer } = useAnimations(gltf.animations, instance)
  const active = useHud(
    (state) => !inputLocked(state.screen) && outdoorSimulationActive(state.gameplayZone),
  )

  // Drei advances its mixer in an internal useFrame. Drive mixer timeScale
  // from the same authoritative screen state so the animal cannot animate
  // behind a menu or jump forward on resume.
  useLayoutEffect(() => {
    mixer.timeScale = active ? 1 : 0
  }, [active, mixer])

  useLayoutEffect(() => {
    instance.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = shadows
      mesh.receiveShadow = true
      mesh.frustumCulled = true
    })

    const group = root.current
    if (!group) return
    group.position.set(rt.capybara.x, 0, rt.capybara.z)
    group.rotation.y = rt.capybara.heading
    rt.refs.capybara = group
    return () => {
      if (rt.refs.capybara === group) rt.refs.capybara = null
    }
  }, [instance, shadows])

  useLayoutEffect(() => {
    if (!import.meta.env.DEV) return
    const available = new Set(names)
    const missing = CAPYBARA_EXPECTED_CLIPS.filter((clip) => !available.has(clip))
    if (missing.length > 0) console.error('Capybara GLB is missing animation clips:', missing)
  }, [names])

  useFrame(() => {
    if (rt.paused || !outdoorSimulationActive(rt.zone)) return
    const next = actions[rt.capybara.clip]
    if (!next || next === currentAction.current) return
    next.reset().fadeIn(0.22).play()
    currentAction.current?.fadeOut(0.22)
    currentAction.current = next
  })

  return (
    <group ref={root} name="ShenronCity_Capybara">
      <primitive object={instance} dispose={null} />
    </group>
  )
}
