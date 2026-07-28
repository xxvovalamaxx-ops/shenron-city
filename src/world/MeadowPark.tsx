import { lazy, Suspense } from 'react'
import type { QualitySettings } from './palette'
import { GroundCover } from './GroundCover'
import { PocketParkTerrain, SimplePocketParkTerrain } from './PocketParkTerrain'

const ScannedGroundCover = lazy(() =>
  import('./ScannedGroundCover').then((module) => ({
    default: module.ScannedGroundCover,
  })),
)

export type MeadowRuntimeMode = 'procedural' | 'scanned'

export function meadowModeForSettings(quality: QualitySettings): MeadowRuntimeMode {
  return quality.detailTrees ? 'scanned' : 'procedural'
}

export function MeadowPark({ quality }: { quality: QualitySettings }) {
  const scanned = meadowModeForSettings(quality) === 'scanned'
  return (
    <>
      {scanned ? (
        <PocketParkTerrain quality={quality} />
      ) : (
        <SimplePocketParkTerrain shadows={quality.shadows} />
      )}
      {scanned ? (
        <Suspense fallback={<GroundCover count={quality.groundCover} />}>
          <ScannedGroundCover count={quality.groundCover} />
        </Suspense>
      ) : (
        <GroundCover count={quality.groundCover} />
      )}
      {scanned && (
        <pointLight
          position={[-20, 5.5, 49]}
          color="#a9c9ff"
          intensity={46}
          distance={22}
          decay={2}
        />
      )}
    </>
  )
}
