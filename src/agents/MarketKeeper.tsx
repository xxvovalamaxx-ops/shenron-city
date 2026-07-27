import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { MARKET_KEEPER } from '../world/city-data'
import { WorldText as Text } from '../ui/WorldText'

export function MarketKeeper() {
  const body = useRef<Group>(null)

  useFrame((state) => {
    if (!body.current) return
    const t = state.clock.elapsedTime
    body.current.rotation.y = -Math.PI / 2 + Math.sin(t * 0.55) * 0.08
    body.current.position.y = Math.sin(t * 1.1) * 0.015
  })

  return (
    <group position={[MARKET_KEEPER.x, 0, MARKET_KEEPER.z]}>
      <group ref={body}>
        <mesh position={[0, 0.92, 0]} castShadow>
          <capsuleGeometry args={[0.25, 0.78, 6, 14]} />
          <meshStandardMaterial color="#654760" roughness={0.75} />
        </mesh>
        <mesh position={[0, 1.62, 0]} castShadow>
          <sphereGeometry args={[0.19, 16, 12]} />
          <meshStandardMaterial color="#b98569" roughness={0.78} />
        </mesh>
        <mesh position={[0, 1.78, -0.02]} rotation={[0.08, 0, 0]}>
          <cylinderGeometry args={[0.3, 0.22, 0.16, 16]} />
          <meshStandardMaterial color="#1e2831" roughness={0.82} />
        </mesh>
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[0.32, 0.46, 24]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.4} toneMapped={false} />
      </mesh>
      <Text
        position={[-0.02, 2.25, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        fontSize={0.22}
        color="#fbbf24"
      >
        MIRA
      </Text>
      <Text
        position={[-0.02, 2.02, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        fontSize={0.1}
        color="#d3b989"
      >
        NIGHT MARKET
      </Text>
    </group>
  )
}
