/** Exterior hero district assembled from authored production assets. */
import type { QualitySettings } from './palette'
import { ProductionExterior } from './ProductionScene'

export function Exterior({ quality }: { quality: QualitySettings }) {
  return <ProductionExterior quality={quality} />
}
