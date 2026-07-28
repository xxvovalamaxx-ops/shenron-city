/**
 * Optional high/medium-quality effects in a separate production chunk.
 *
 * Low quality never downloads or initializes this graph, keeping the fallback
 * useful on integrated GPUs instead of merely hiding the effects after load.
 *
 * Grounded night-city finish: production shadows and PBR surface detail,
 * selective bloom for real emitters, a restrained vignette, filmic tone
 * mapping, and SMAA. Full-screen AO was measured as an expensive additional
 * scene replay at the target ultrawide resolution and is omitted.
 */
import {
  Bloom,
  EffectComposer,
  SMAA,
  Vignette,
  ToneMapping,
} from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

export default function PostProcessing() {
  return (
    // SMAA already handles edge cleanup. Keeping the composer's separate 8x
    // multisample target would shade every full-resolution pass repeatedly.
    <EffectComposer multisampling={0}>
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
