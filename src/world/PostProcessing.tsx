/**
 * High/medium-quality post-processing for GTA6-level visuals.
 *
 * Low quality never downloads or initializes this graph.
 *
 * Includes: SSAO for depth/contact shadows, enhanced bloom for city glow,
 * chromatic aberration for cinematic feel, vignette, color grading via
 * hue/saturation, filmic tone mapping, and SMAA anti-aliasing.
 */
import {
  Bloom,
  EffectComposer,
  SMAA,
  Vignette,
  ToneMapping,
  SSAO,
  HueSaturation,
  ChromaticAberration,
} from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Vector2, Color } from 'three'

export default function PostProcessing() {
  return (
    <EffectComposer multisampling={0}>
      <SSAO
        intensity={25}
        radius={0.15}
        luminanceInfluence={0.6}
        color={new Color('#1a2a3a')}
      />
      <Bloom
        intensity={0.45}
        luminanceThreshold={0.9}
        luminanceSmoothing={0.3}
        mipmapBlur
      />
      <ChromaticAberration
        offset={new Vector2(0.0008, 0.0008)}
        radialModulation={true}
        modulationOffset={0.5}
      />
      <HueSaturation
        hue={0}
        saturation={0.12}
      />
      <Vignette offset={0.3} darkness={0.55} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
    </EffectComposer>
  )
}
