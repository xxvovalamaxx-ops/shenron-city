/**
 * Shenron City's first walkable exterior district.
 *
 * Authored CC0 shells now establish the commercial blocks and vegetation.
 * Repeated windows, lights and lane markings remain instanced so the street
 * adds density without adding hundreds of draw calls.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { WorldText as Text } from '../ui/WorldText'
import {
  BOULEVARD,
  MARKET_STALLS,
  PARK_NATURE,
  STOREFRONTS,
  STREET_LIGHTS,
  STREET_TREES,
  type MarketStall,
  type Storefront,
} from './city-data'
import { PALETTE, type QualitySettings } from './palette'
import { useRoadMaterial, useSidewalkMaterial, useWoodMaterial } from './PBRMaterials'
import { marketDisplayFor, type MarketDisplay } from './market-display'
import { buildingAssetFor, CITY_NATURE_ASSETS } from './city-assets'
import { StaticCityModel } from './StaticCityModel'

function StorefrontBuilding({
  store,
  shadows,
}: {
  store: Storefront
  shadows: boolean
}) {
  const facesEast = store.x < 0
  const frontX = (facesEast ? 1 : -1) * (store.width / 2 + 0.03)
  const frontRotation: [number, number, number] = [0, facesEast ? Math.PI / 2 : -Math.PI / 2, 0]

  return (
    <group position={[store.x, 0, store.z]}>
      <StaticCityModel
        url={buildingAssetFor(store.id)}
        dimensions={[store.width, store.height, store.depth]}
        rotationY={facesEast ? Math.PI / 2 : -Math.PI / 2}
        shadows={shadows}
      />

      {/* A bright ground-floor shopfront faces the boulevard. */}
      <mesh position={[frontX, 1.65, 0]} rotation={frontRotation}>
        <boxGeometry args={[store.depth - 2.4, 2.8, 0.1]} />
        <meshStandardMaterial
          color="#b9d7e9"
          emissive={store.accent}
          emissiveIntensity={0.28}
          roughness={0.12}
          metalness={0.15}
        />
      </mesh>
      <mesh position={[frontX * 1.015, 3.25, 0]} rotation={frontRotation}>
        <boxGeometry args={[store.depth - 1.6, 0.2, 0.36]} />
        <meshBasicMaterial color={store.accent} toneMapped={false} />
      </mesh>
      <Text
        position={[frontX * 1.025, 3.75, 0]}
        rotation={frontRotation}
        fontSize={0.34}
        color={store.accent}
      >
        {store.name.toUpperCase()}
      </Text>

      {/* Interior visible through glass — counter, shelves, warm glow */}
      <mesh position={[frontX * 0.6, 0.5, 0]} rotation={frontRotation}>
        <boxGeometry args={[store.depth - 3, 1.0, 0.6]} />
        <meshStandardMaterial color="#1c2028" roughness={0.5} metalness={0.4} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[frontX * 0.4, 1.8 + i * 0.8, -store.depth / 4 + (i % 2) * store.depth / 2]}>
          <boxGeometry args={[0.3, 0.6, store.depth - 4]} />
          <meshStandardMaterial color="#2a2520" roughness={0.7} />
        </mesh>
      ))}
      {/* Warm interior glow through shopfront */}
      <pointLight
        position={[frontX * 0.3, 2, 0]}
        color={store.accent}
        intensity={18}
        distance={12}
        decay={2}
      />
    </group>
  )
}

function DistrictWindows() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = useMemo(
    () => STOREFRONTS.reduce((total, store) => total + store.floors * 4, 0),
    [],
  )

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return

    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3(1.35, 1.05, 1)
    const color = new THREE.Color()
    let index = 0

    for (const store of STOREFRONTS) {
      const facesEast = store.x < 0
      const frontX = store.x + (facesEast ? 1 : -1) * (store.width / 2 + 0.08)
      rotation.setFromEuler(new THREE.Euler(0, facesEast ? Math.PI / 2 : -Math.PI / 2, 0))

      for (let floor = 0; floor < store.floors; floor++) {
        const y = 5.1 + floor * 2.45
        if (y > store.height - 0.8) continue
        for (let column = 0; column < 4; column++) {
          const z = store.z - store.depth / 2 + 2.7 + (column / 3) * (store.depth - 5.4)
          position.set(frontX, y, z)
          matrix.compose(position, rotation, scale)
          mesh.setMatrixAt(index, matrix)
          color.setStyle((index + floor) % 3 === 0 ? store.accent : PALETTE.warmLight)
          color.multiplyScalar((index + column) % 4 === 0 ? 0.28 : 0.65)
          mesh.setColorAt(index, color)
          index++
        }
      }
    }

    // Hide unused capacity when a short building has fewer valid upper rows.
    for (; index < count; index++) {
      matrix.makeScale(0, 0, 0)
      mesh.setMatrixAt(index, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [count])

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

function MarketInventory({
  display,
  stall,
  shadows,
}: {
  display: MarketDisplay
  stall: MarketStall
  shadows: boolean
}) {
  const counterX = -stall.width / 2 + 0.38

  return (
    <group position={[counterX, 1.12, 0]}>
      {display.kind === 'ramen' &&
        [-0.72, 0, 0.72].map((z) => (
          <group key={z} position={[0, 0, z]}>
            <mesh castShadow={shadows}>
              <cylinderGeometry args={[0.18, 0.12, 0.13, 16]} />
              <meshStandardMaterial color="#eee5d2" roughness={0.55} />
            </mesh>
            <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.1, 0.024, 6, 16]} />
              <meshStandardMaterial color={display.secondary} roughness={0.78} />
            </mesh>
          </group>
        ))}

      {display.kind === 'tea' &&
        [-0.8, -0.4, 0, 0.4, 0.8].map((z, index) => (
          <group key={z} position={[0, 0.14 + (index % 2) * 0.03, z]}>
            <mesh castShadow={shadows}>
              <cylinderGeometry args={[0.11, 0.11, 0.3, 14]} />
              <meshStandardMaterial
                color={index % 2 ? display.primary : display.secondary}
                roughness={0.48}
                metalness={0.28}
              />
            </mesh>
            <mesh position={[0, 0.165, 0]}>
              <cylinderGeometry args={[0.12, 0.12, 0.025, 14]} />
              <meshStandardMaterial color="#b8a67e" roughness={0.38} metalness={0.4} />
            </mesh>
          </group>
        ))}

      {display.kind === 'flowers' &&
        [-0.72, -0.24, 0.24, 0.72].map((z, index) => (
          <group key={z} position={[0, 0, z]}>
            <mesh position={[0, 0.08, 0]} castShadow={shadows}>
              <cylinderGeometry args={[0.11, 0.14, 0.18, 12]} />
              <meshStandardMaterial color="#75604a" roughness={0.9} />
            </mesh>
            <mesh position={[0, 0.36, 0]}>
              <cylinderGeometry args={[0.018, 0.025, 0.45, 7]} />
              <meshStandardMaterial color={display.secondary} roughness={0.82} />
            </mesh>
            <mesh position={[0, 0.61, 0]} castShadow={shadows}>
              <icosahedronGeometry args={[0.13, 1]} />
              <meshStandardMaterial
                color={index % 2 ? display.primary : '#f2a65a'}
                emissive={index % 2 ? display.primary : '#f2a65a'}
                emissiveIntensity={0.08}
                roughness={0.72}
              />
            </mesh>
          </group>
        ))}

      {display.kind === 'books' &&
        [-0.68, 0, 0.68].map((z, stack) => (
          <group key={z} position={[0, 0, z]}>
            {[0, 1, 2].map((level) => (
              <mesh
                key={level}
                position={[0, 0.045 + level * 0.075, 0]}
                rotation={[0, (stack + level) * 0.08 - 0.12, 0]}
                castShadow={shadows}
              >
                <boxGeometry args={[0.4, 0.065, 0.34]} />
                <meshStandardMaterial
                  color={(stack + level) % 2 ? display.primary : display.secondary}
                  roughness={0.82}
                />
              </mesh>
            ))}
          </group>
        ))}
    </group>
  )
}

function Market({ shadows }: { shadows: boolean }) {
  const woodMat = useWoodMaterial()
  return (
    <group>
      <Text position={[13.7, 3.65, 70]} rotation={[0, -Math.PI / 2, 0]} fontSize={0.48} color="#fbbf24">
        NIGHT MARKET
      </Text>
      {MARKET_STALLS.map((stall) => {
        const display = marketDisplayFor(stall.id)
        return (
        <group key={stall.id} position={[stall.x, 0, stall.z]}>
          {/* A real counter and rear cabinet leave depth under the canopy. */}
          <mesh
            position={[-stall.width / 2 + 0.34, 0.55, 0]}
            castShadow={shadows}
            receiveShadow={shadows}
          >
            <boxGeometry args={[0.68, 1.1, stall.depth - 0.18]} />
            <primitive object={woodMat} attach="material" />
          </mesh>
          <mesh position={[-stall.width / 2 + 0.34, 1.1, 0]} castShadow={shadows}>
            <boxGeometry args={[0.88, 0.1, stall.depth + 0.08]} />
            <meshStandardMaterial color="#76583e" roughness={0.68} />
          </mesh>
          <mesh
            position={[stall.width / 2 - 0.28, 0.72, 0]}
            castShadow={shadows}
            receiveShadow={shadows}
          >
            <boxGeometry args={[0.56, 1.44, stall.depth - 0.22]} />
            <primitive object={woodMat} attach="material" />
          </mesh>

          <MarketInventory display={display} stall={stall} shadows={shadows} />

          <mesh position={[0, stall.height, 0]} castShadow={shadows}>
            <boxGeometry args={[stall.width + 0.35, 0.12, stall.depth + 0.4]} />
            <meshStandardMaterial
              color={stall.awning}
              emissive={stall.awning}
              emissiveIntensity={0.18}
              roughness={0.65}
            />
          </mesh>
          {/* Cloth valance gives the awning a readable front edge. */}
          {[-0.82, 0, 0.82].map((z, index) => (
            <mesh
              key={z}
              position={[-stall.width / 2 - 0.16, stall.height - 0.22, z]}
            >
              <boxGeometry args={[0.08, 0.38, 0.68]} />
              <meshStandardMaterial
                color={index % 2 ? '#efe3c5' : stall.awning}
                emissive={index % 2 ? '#000000' : stall.awning}
                emissiveIntensity={index % 2 ? 0 : 0.08}
                roughness={0.78}
              />
            </mesh>
          ))}
          {[-1, 1].map((x) =>
            [-1, 1].map((z) => (
              <mesh
                key={`${x}:${z}`}
                position={[x * (stall.width / 2 - 0.12), stall.height / 2, z * (stall.depth / 2 - 0.12)]}
              >
                <cylinderGeometry args={[0.035, 0.045, stall.height, 6]} />
                <meshStandardMaterial color="#6b5542" roughness={0.9} />
              </mesh>
            )),
          )}
          {[-1, 1].map((side) => (
            <group
              key={side}
              position={[-stall.width / 2 - 0.18, stall.height - 0.56, side * (stall.depth / 2 - 0.2)]}
            >
              <mesh>
                <cylinderGeometry args={[0.11, 0.14, 0.28, 12]} />
                <meshStandardMaterial
                  color={display.primary}
                  emissive={display.primary}
                  emissiveIntensity={0.65}
                  roughness={0.5}
                />
              </mesh>
              <pointLight color={display.primary} intensity={7} distance={4.5} decay={2} />
            </group>
          ))}
          <Text
            position={[-stall.width / 2 - 0.05, 1.45, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            fontSize={0.22}
            color="#fff7df"
          >
            {stall.name.toUpperCase()}
          </Text>
          <Text
            position={[-stall.width / 2 - 0.06, 1.2, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            fontSize={0.085}
            color={display.secondary}
          >
            {display.label}
          </Text>
        </group>
        )
      })}
    </group>
  )
}

function Trees({ shadows }: { shadows: boolean }) {
  return (
    <group>
      {STREET_TREES.map((tree, index) => {
        const url =
          index % 3 === 0
            ? CITY_NATURE_ASSETS.detailed
            : index % 3 === 1
              ? CITY_NATURE_ASSETS.oak
              : CITY_NATURE_ASSETS.thin
        return (
          <StaticCityModel
            key={tree.id}
            url={url}
            position={[tree.x, 0, tree.z]}
            dimensions={[2.5 * tree.scale, 4.8 * tree.scale, 2.5 * tree.scale]}
            rotationY={(index * 1.73) % (Math.PI * 2)}
            shadows={shadows}
          />
        )
      })}

      {PARK_NATURE.map((feature, index) => (
        <StaticCityModel
          key={feature.id}
          url={feature.kind === 'bush' ? CITY_NATURE_ASSETS.bush : CITY_NATURE_ASSETS.rock}
          position={[feature.x, 0, feature.z]}
          dimensions={[feature.width, feature.height, feature.depth]}
          rotationY={index * 1.9}
          shadows={shadows}
        />
      ))}
    </group>
  )
}

function StreetLights() {
  const poles = useRef<THREE.InstancedMesh>(null)
  const lamps = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const poleMesh = poles.current
    const lampMesh = lamps.current
    if (!poleMesh || !lampMesh) return
    const matrix = new THREE.Matrix4()

    for (let i = 0; i < STREET_LIGHTS.length; i++) {
      const light = STREET_LIGHTS[i]
      matrix.makeTranslation(light.x, 2.3, light.z)
      poleMesh.setMatrixAt(i, matrix)
      matrix.makeTranslation(light.x, 4.62, light.z)
      lampMesh.setMatrixAt(i, matrix)
    }
    poleMesh.instanceMatrix.needsUpdate = true
    lampMesh.instanceMatrix.needsUpdate = true
  }, [])

  return (
    <>
      <instancedMesh ref={poles} args={[undefined, undefined, STREET_LIGHTS.length]}>
        <cylinderGeometry args={[0.08, 0.12, 4.6, 8]} />
        <meshStandardMaterial color="#343b47" metalness={0.8} roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={lamps} args={[undefined, undefined, STREET_LIGHTS.length]}>
        <sphereGeometry args={[0.18, 8, 6]} />
        <meshBasicMaterial color={PALETTE.warmLight} toneMapped={false} />
      </instancedMesh>
    </>
  )
}

function RoadMarkings() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = 14

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    for (let i = 0; i < count; i++) {
      matrix.makeTranslation(0, 0.024, 48 + i * 8)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [])

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <boxGeometry args={[0.16, 0.025, 3.8]} />
      <meshBasicMaterial color="#c7b875" transparent opacity={0.75} />
    </instancedMesh>
  )
}

export function CityDistrict({ quality }: { quality: QualitySettings }) {
  const sidewalkX = BOULEVARD.width / 2 + BOULEVARD.sidewalkWidth / 2
  const roadMat = useRoadMaterial()
  const sidewalkMat = useSidewalkMaterial()

  return (
    <group>
      {/* Boulevard and raised pedestrian edges begin after the HQ plaza. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[BOULEVARD.x, 0.012, BOULEVARD.z]}>
        <planeGeometry args={[BOULEVARD.width, BOULEVARD.depth]} />
        <primitive object={roadMat} attach="material" />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * sidewalkX, 0.09, BOULEVARD.z]}
          receiveShadow={quality.shadows}
        >
          <boxGeometry args={[BOULEVARD.sidewalkWidth, 0.18, BOULEVARD.depth]} />
          <primitive object={sidewalkMat} attach="material" />
        </mesh>
      ))}
      <RoadMarkings />

      {/* Crosswalk makes the end of the boulevard read as a real junction. */}
      {Array.from({ length: 9 }, (_, index) => (
        <mesh key={index} position={[-6.2 + index * 1.55, 0.035, 39.5]}>
          <boxGeometry args={[0.82, 0.025, 4.8]} />
          <meshBasicMaterial color="#d7d8d5" transparent opacity={0.72} />
        </mesh>
      ))}

      {/* Small green pocket between the HQ plaza and the west storefronts. */}
      <mesh position={[-20, 0.055, 49]} receiveShadow={quality.shadows}>
        <boxGeometry args={[15.5, 0.1, 20]} />
        <meshStandardMaterial color="#14291f" roughness={1} />
      </mesh>
      <mesh position={[-20, 0.12, 49]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[4.4, 5.1, 32]} />
        <meshStandardMaterial color="#8b8172" roughness={0.95} />
      </mesh>
      <Text position={[-20, 0.2, 59.2]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.5} color="#75a98c">
        DRAGON POCKET PARK
      </Text>

      {STOREFRONTS.map((store) => (
        <StorefrontBuilding key={store.id} store={store} shadows={quality.shadows} />
      ))}
      <DistrictWindows />
      <Market shadows={quality.shadows} />
      <Trees shadows={quality.shadows} />
      <StreetLights />
    </group>
  )
}
