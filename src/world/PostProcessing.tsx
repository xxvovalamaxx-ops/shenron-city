/**
 * Optional high/medium-quality effects in a separate production chunk.
 *
 * Low quality never downloads or initializes this graph, keeping the fallback
 * useful on integrated GPUs instead of merely hiding the effects after load.
 *
 * Cyberpunk night-city look: bloom for neon, vignette for focus, AO for depth,
 * chromatic aberration for that CRT/glitch feel.
 */
import {
  Bloom,
  EffectComposer,
  SMAA,
  Vignette,
  N8AO,
  ChromaticAberration,
  ToneMapping,
} from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Vector2 } from 'three'

export default function PostProcessing() {
  return (
    <EffectComposer>
      <N8AO
        aoRadius={0.8}
        intensity={1.5}
        aoSamples={6}
        denoiseSamples={4}
      />
      <Bloom
        intensity={0.8}
        luminanceThreshold={0.5}
        luminanceSmoothing={0.3}
        mipmapBlur
      />
      <ChromaticAberration
        offset={new Vector2(0.0008, 0.0008)}
        radialModulation={true}
        modulationOffset={0.5}
      />
      <Vignette offset={0.3} darkness={0.75} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
    </EffectComposer>
  )
}
