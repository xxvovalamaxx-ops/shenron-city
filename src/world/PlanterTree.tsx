/**
 * The cheap tree.
 *
 * Two jobs: it is the whole tree on the low preset, and it is what stands in
 * the planter while the detailed tree chunk downloads. Both jobs need it to
 * read as a tree from ten metres away, not to survive close inspection.
 *
 * Colours match the instanced street trees in CityDistrict deliberately — a
 * planter tree and a street tree twenty metres apart should look like the same
 * species, and the swap to the detailed mesh should not change the palette.
 *
 * Trees are sized in **metres of final height**, never by a raw scale factor.
 * The two implementations have completely different natural sizes — ez-tree
 * generates a ~98 m tree at scale 1 — so a shared `scale` prop meant the
 * fallback and the detailed mesh disagreed by a factor of twenty. Height is
 * the one number that means the same thing to both.
 */
import { useMemo } from 'react'

export const TRUNK_COLOR = '#4a3427'
export const FOLIAGE_COLOR = '#173c2c'

/** A mature street tree at a building entrance. The doorway is ~4 m. */
export const DEFAULT_TREE_HEIGHT = 7

export interface TreeProps {
  position: [number, number, number]
  seed?: number
  /** Final height in metres, ground to highest leaf. */
  height?: number
  variant?: 'oak' | 'pine' | 'birch' | 'willow'
  shadows?: boolean
}

/** Crown blob in natural units: offset from the trunk base, and radius. */
export interface Blob {
  offset: [number, number, number]
  radius: number
}

export interface CrownShape {
  blobs: Blob[]
  /** Highest point of the natural-unit model, used to normalise to metres. */
  naturalHeight: number
}

/**
 * Deterministic per-seed crown in natural units. Identical input must give an
 * identical tree — a planter that reshuffles its leaves between the fallback
 * and the detailed mesh reads as a glitch rather than as loading.
 */
export function crownFor(seed: number, variant: string): CrownShape {
  let a = seed | 0
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // Conifers are a narrow stack; broadleaves are a wider, messier cluster.
  const conifer = variant === 'pine'
  const count = conifer ? 4 : 3
  const blobs: Blob[] = []

  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1)
    blobs.push({
      offset: [
        (rand() - 0.5) * (conifer ? 0.18 : 0.62),
        (conifer ? 2.05 : 2.35) + t * (conifer ? 1.5 : 0.95),
        (rand() - 0.5) * (conifer ? 0.18 : 0.62),
      ],
      radius: conifer ? 0.92 - t * 0.5 : (1.02 - t * 0.24) * (0.86 + rand() * 0.3),
    })
  }

  const naturalHeight = blobs.reduce((max, b) => Math.max(max, b.offset[1] + b.radius), 0)
  return { blobs, naturalHeight }
}

export function PlanterTree({
  position,
  seed = 42,
  height = DEFAULT_TREE_HEIGHT,
  variant = 'oak',
  shadows = true,
}: TreeProps) {
  const { blobs, naturalHeight } = useMemo(() => crownFor(seed, variant), [seed, variant])
  // Birch trunks are pale; the others share the street-tree bark.
  const trunk = variant === 'birch' ? '#8d8578' : TRUNK_COLOR

  return (
    <group position={position} scale={height / naturalHeight}>
      <mesh position={[0, 1.1, 0]} castShadow={shadows} receiveShadow={shadows}>
        <cylinderGeometry args={[0.16, 0.26, 2.2, 7]} />
        <meshStandardMaterial color={trunk} roughness={1} />
      </mesh>
      {blobs.map((blob, i) => (
        <mesh key={i} position={blob.offset} castShadow={shadows}>
          <icosahedronGeometry args={[blob.radius, 1]} />
          <meshStandardMaterial color={FOLIAGE_COLOR} roughness={0.95} flatShading />
        </mesh>
      ))}
    </group>
  )
}
