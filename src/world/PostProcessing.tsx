/**
 * Optional high/medium-quality effects in a separate production chunk.
 *
 * Low quality never downloads or initializes this graph, keeping the fallback
 * useful on integrated GPUs instead of merely hiding the effects after load.
 * (Low still gets the sky, IBL, height fog and ACES from the renderer.)
 *
 * The chain, in order:
 *   N8AO (high only)     half-resolution ground-truth-style AO: contact
 *                        shadow where facades meet the pavement, under cars
 *                        and awnings. The one effect that most makes IBL read
 *                        as real light rather than a flat ambient.
 *   Bloom                mipmap bloom on HDR luminance; threshold and strength
 *                        follow the practicals, so windows, neon, lamp heads
 *                        and headlights glow at night while the day stays clean.
 *   ToneMapping          ACES filmic, fed by the time-of-day exposure the
 *                        weather writes to the renderer (same curve the low
 *                        preset gets on screen, so presets agree).
 *   Grade                lift/gamma/gain, teal-orange split, saturation and
 *                        a whisper of grain, driven by the atmosphere.
 *   Vignette
 *   Chromatic aberration (high only) radial, edges only.
 *   SMAA
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  ChromaticAberration,
  EffectComposer,
  N8AO,
  SMAA,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing'
import { BlendFunction, BloomEffect, ToneMappingMode } from 'postprocessing'
import { rt } from '../gameplay/runtime'
import type { QualityPreset } from './palette'
import { atmosphere } from './atmosphere/lighting-state'
import { CinematicGradeEffect } from './atmosphere/grade-effect'
import { gradeFor } from './atmosphere/grade'

export default function PostProcessing({ quality = 'high' }: { quality?: QualityPreset }) {
  const grade = useMemo(() => new CinematicGradeEffect(), [])
  // Built here rather than through the <Bloom> wrapper: the wrapper keys its
  // memo on JSON.stringify(props), and under React 19 a ref is a prop, so a
  // ref on it serialises the effect and throws on its circular graph.
  const bloom = useMemo(
    () =>
      new BloomEffect({
        blendFunction: BlendFunction.ADD,
        intensity: 0.3,
        luminanceThreshold: 1.0,
        luminanceSmoothing: 0.3,
        mipmapBlur: true,
        radius: 0.72,
      }),
    [],
  )
  useEffect(
    () => () => {
      bloom.dispose()
      grade.dispose()
    },
    [bloom, grade],
  )
  const version = useRef(-1)
  const caOffset = useMemo(() => new THREE.Vector2(0.0009, 0.0009), [])
  const high = quality === 'high'

  useFrame(() => {
    grade.animateGrain = !rt.captureFrozen
    if (version.current === atmosphere.version) return
    version.current = atmosphere.version
    const s = atmosphere.state
    grade.setParams(gradeFor(s))
    bloom.intensity = s.bloomIntensity
    bloom.luminanceMaterial.threshold = s.bloomThreshold
  })

  return (
    // SMAA already handles edge cleanup. Keeping the composer's separate 8x
    // multisample target would shade every full-resolution pass repeatedly.
    <EffectComposer multisampling={0}>
      {high ? (
        <N8AO
          halfRes
          quality="performance"
          aoRadius={3.2}
          distanceFalloff={1.2}
          intensity={2.4}
          color="#0a0c10"
        />
      ) : (
        <></>
      )}
      <primitive object={bloom} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <primitive object={grade} />
      <Vignette offset={0.3} darkness={0.5} />
      {high ? (
        <ChromaticAberration offset={caOffset} radialModulation modulationOffset={0.45} />
      ) : (
        <></>
      )}
      <SMAA />
    </EffectComposer>
  )
}
