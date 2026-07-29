/**
 * Drives the scene from the clock and the weather.
 *
 * One component owns the sun, the sky, the fog and the wetness so they cannot
 * disagree — a sunset sky over a midnight key light is the kind of thing that
 * looks like a bug without ever being one thing you can point at.
 *
 * The clock lives on `rt` rather than in React state: it changes every frame,
 * and putting it in state would re-render the tree sixty times a second.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../gameplay/runtime'
import { skyAt, stepWeather, sunAt } from './daycycle'
import type { QualitySettings } from './palette'

/** Sun distance. Far enough that its shadow frustum covers the hero district. */
const SUN_DISTANCE = 260

/** Real seconds per in-game hour. A full day in eight minutes. */
export const SECONDS_PER_HOUR = 20

export function SkyRig({ quality }: { quality: QualitySettings }) {
  const key = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const ambient = useRef<THREE.AmbientLight>(null)
  const fog = useRef<THREE.Fog>(null)

  const colours = useMemo(
    () => ({ key: new THREE.Color(), horizon: new THREE.Color(), zenith: new THREE.Color() }),
    [],
  )

  // Rain comes and goes on its own schedule rather than following the clock,
  // so the city is not reliably wet at the same hour every day.
  const nextChange = useRef(45)

  useEffect(() => {
    // Start at dusk: it is the best-looking hour and the one the references
    // are mostly shot at, so the first thing the player sees is the city at
    // its best rather than 4 am.
    if (rt.clock.hour === 0) rt.clock.hour = 18.4
  }, [])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)

    rt.clock.hour = (rt.clock.hour + dt / SECONDS_PER_HOUR) % 24

    nextChange.current -= dt
    if (nextChange.current <= 0) {
      // Dry most of the time; a downpour is an event, not the default.
      rt.clock.rainTarget = Math.random() < 0.35 ? 0.55 + Math.random() * 0.45 : 0
      nextChange.current = 60 + Math.random() * 120
    }
    rt.clock.weather = stepWeather(rt.clock.weather, rt.clock.rainTarget, dt)

    const sun = sunAt(rt.clock.hour)
    const sky = skyAt(rt.clock.hour, rt.clock.weather)

    if (key.current) {
      key.current.position.set(
        sun.x * SUN_DISTANCE,
        // Never let the key drop below the ground, or it lights the city from
        // underneath through the pavement.
        Math.max(12, sun.y * SUN_DISTANCE),
        sun.z * SUN_DISTANCE,
      )
      key.current.intensity = sky.keyIntensity
      key.current.color.set(colours.key.set(sky.keyColour))
    }
    if (hemi.current) {
      hemi.current.intensity = sky.fillIntensity
      hemi.current.color.set(colours.horizon.set(sky.horizon))
      hemi.current.groundColor.set(colours.zenith.set(sky.zenith))
    }
    if (ambient.current) ambient.current.intensity = sky.fillIntensity * 0.32

    // Background and fog track the horizon, so the far city dissolves into the
    // sky instead of ending at a hard line against it.
    const horizon = colours.horizon.set(sky.horizon)
    if (state.scene.background instanceof THREE.Color) state.scene.background.copy(horizon)
    if (fog.current) fog.current.color.copy(horizon)
  })

  return (
    <>
      <fog ref={fog} attach="fog" args={['#0b1626', 160, 1500]} />
      <hemisphereLight ref={hemi} args={['#0b1626', '#0d1420', 0.2]} />
      <ambientLight ref={ambient} intensity={0.07} />
      <directionalLight
        ref={key}
        position={[38, 60, 34]}
        intensity={1.12}
        castShadow={quality.shadows}
        shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
        shadow-camera-near={1}
        shadow-camera-far={620}
        shadow-camera-left={-180}
        shadow-camera-right={180}
        shadow-camera-top={180}
        shadow-camera-bottom={-180}
        shadow-bias={-0.0006}
      />
    </>
  )
}
