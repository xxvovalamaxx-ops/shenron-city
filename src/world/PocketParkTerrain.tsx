import { WorldText as Text } from '../ui/WorldText'
import type { QualitySettings } from './palette'
import { useParkGroundMaterial, useParkPathMaterial } from './PBRMaterials'

/**
 * Collision-aligned runtime transfer of the Blender meadow's two macro layers.
 *
 * The browser keeps the authored flat walk surface. Height and displacement
 * stay in the material response so the render never promises terrain the
 * capsule cannot actually follow.
 */
export function PocketParkTerrain({ quality }: { quality: QualitySettings }) {
  const groundMaterial = useParkGroundMaterial(quality)
  const pathMaterial = useParkPathMaterial(quality)

  return (
    <group name="dragon-pocket-park-terrain">
      <mesh position={[-20, 0.055, 49]} receiveShadow={quality.shadows}>
        <boxGeometry args={[15.5, 0.1, 20]} />
        <primitive object={groundMaterial} attach="material" />
      </mesh>
      <mesh position={[-20, 0.12, 49]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[4.4, 5.1, 64]} />
        <primitive object={pathMaterial} attach="material" />
      </mesh>
      <Text
        position={[-20, 0.2, 59.2]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.5}
        color="#8fbea1"
      >
        DRAGON POCKET PARK
      </Text>
    </group>
  )
}

/** Zero-download fallback for low quality and scanned-asset loading gaps. */
export function SimplePocketParkTerrain({ shadows }: { shadows: boolean }) {
  return (
    <group name="dragon-pocket-park-terrain-fallback">
      <mesh position={[-20, 0.055, 49]} receiveShadow={shadows}>
        <boxGeometry args={[15.5, 0.1, 20]} />
        <meshStandardMaterial color="#14291f" roughness={1} />
      </mesh>
      <mesh position={[-20, 0.12, 49]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[4.4, 5.1, 32]} />
        <meshStandardMaterial color="#8b8172" roughness={0.95} />
      </mesh>
      <Text
        position={[-20, 0.2, 59.2]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.5}
        color="#75a98c"
      >
        DRAGON POCKET PARK
      </Text>
    </group>
  )
}
