/**
 * Optional high/medium-quality effects in a separate production chunk.
 *
 * Low quality never downloads or initializes this graph, keeping the fallback
 * useful on integrated GPUs instead of merely hiding the effects after load.
 */
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing'

export default function PostProcessing() {
  return (
    <EffectComposer>
      <Bloom intensity={0.62} luminanceThreshold={0.62} luminanceSmoothing={0.28} mipmapBlur />
      <Vignette offset={0.28} darkness={0.72} />
      <SMAA />
    </EffectComposer>
  )
}
