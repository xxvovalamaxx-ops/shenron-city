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
  ToneMapping,
} from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

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
        intensity={0.38}
        luminanceThreshold={1.05}
        luminanceSmoothing={0.22}
        mipmapBlur
      />
      <Vignette offset={0.34} darkness={0.48} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
    </EffectComposer>
  )
}
