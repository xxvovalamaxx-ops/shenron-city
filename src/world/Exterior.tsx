/**
 * The plaza, the tower you are standing in, and the city around it.
 *
 * Everything repeated is instanced. A night skyline made of individual meshes
 * is the fastest way to lose the frame budget before the interior even loads.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ENTRANCE, LOBBY, TOWER } from './layout'
import { PALETTE, type QualitySettings } from './palette'
import { CITY_GROUND } from './city-data'
import { CityDistrict } from './CityDistrict'

/** Deterministic PRNG — the skyline must be identical every run. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function CityBlocks({ count }: { count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const rand = mulberry32(20260727)
    const m = new THREE.Matrix4()
    const color = new THREE.Color()

    for (let i = 0; i < count; i++) {
      // Ring layout: keep the full playable district clear, then fill the
      // middle distance beyond its authored ground.
      const angle = rand() * Math.PI * 2
      const radius = 220 + rand() * 360
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius - 20
      const h = 20 + rand() * rand() * 190
      const w = 14 + rand() * 26
      const d = 14 + rand() * 26

      m.compose(
        new THREE.Vector3(x, h / 2, z),
        new THREE.Quaternion(),
        new THREE.Vector3(w, h, d),
      )
      mesh.setMatrixAt(i, m)

      // A few windows lit per building, biased dim so the tower dominates.
      const lit = rand()
      color.setStyle(PALETTE.cityGlow)
      color.multiplyScalar(0.25 + lit * 0.9)
      mesh.setColorAt(i, color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [count])

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={PALETTE.concreteDark}
        roughness={0.9}
        metalness={0.1}
        emissive={PALETTE.cityGlow}
        emissiveIntensity={0.35}
      />
    </instancedMesh>
  )
}

/** Lit window grid on the tower facade. Instanced emissive quads. */
function FacadeWindows() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const cols = 26
  const rows = 30
  const count = cols * rows * 2 // front and back faces

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const rand = mulberry32(31337)
    const m = new THREE.Matrix4()
    const color = new THREE.Color()
    const q = new THREE.Quaternion()
    let i = 0

    for (const face of [1, -1]) {
      const z = face === 1 ? 0.35 : -TOWER.depth - 0.35
      q.setFromEuler(new THREE.Euler(0, face === 1 ? 0 : Math.PI, 0))

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const x = -TOWER.halfWidth + 1.6 + (c / (cols - 1)) * (TOWER.halfWidth * 2 - 3.2)
          const y = 14 + (r / (rows - 1)) * (TOWER.height - 20)
          m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1.15, 2.1, 1))
          mesh.setMatrixAt(i, m)

          const on = rand()
          // Floors 45-50 are the player's HQ: always lit, always teal.
          const floorNo = Math.round((y / TOWER.height) * 60)
          if (floorNo >= 45 && floorNo <= 50) {
            color.setStyle(PALETTE.accent).multiplyScalar(1.5)
          } else if (on > 0.55) {
            color.setStyle(PALETTE.warmLight).multiplyScalar(0.5 + rand() * 0.5)
          } else {
            color.setStyle(PALETTE.horizon).multiplyScalar(0.4)
          }
          mesh.setColorAt(i, color)
          i++
        }
      }
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

export function Exterior({ quality }: { quality: QualitySettings }) {
  const eh = ENTRANCE.halfWidth
  const sideW = LOBBY.halfWidth - eh

  const groundMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: PALETTE.concreteDark,
        roughness: 0.75,
        metalness: 0.15,
      }),
    [],
  )

  return (
    <group>
      {/* Plaza and street */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[CITY_GROUND.x, 0, CITY_GROUND.z]}
        receiveShadow={quality.shadows}
        material={groundMat}
      >
        <planeGeometry args={[CITY_GROUND.width, CITY_GROUND.depth]} />
      </mesh>

      <CityDistrict quality={quality} />

      {/* Tower mass — the building continues far above the lobby ceiling */}
      <mesh position={[0, TOWER.height / 2, -TOWER.depth / 2]} castShadow={quality.shadows}>
        <boxGeometry args={[TOWER.halfWidth * 2, TOWER.height, TOWER.depth]} />
        <meshStandardMaterial color={PALETTE.concrete} roughness={0.55} metalness={0.45} />
      </mesh>

      <FacadeWindows />

      {/* Facade panels flanking the entrance, in glass */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (eh + sideW / 2), 6, 0.3]}>
          <boxGeometry args={[sideW, 12, 0.25]} />
          {/* See-through by alpha rather than transmission — the lobby has to
              be visible from the plaza, which is what draws you toward it. */}
          <meshPhysicalMaterial
            color="#9dc0de"
            roughness={0.05}
            metalness={0}
            transparent
            opacity={0.14}
            ior={1.5}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* Entrance canopy */}
      <mesh position={[0, ENTRANCE.height + 0.6, 2.6]} castShadow={quality.shadows}>
        <boxGeometry args={[eh * 2 + 5, 0.35, 5.6]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.35} metalness={0.85} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (eh + 2), ENTRANCE.height / 2, 5.1]}>
          <cylinderGeometry args={[0.14, 0.14, ENTRANCE.height + 1.2, 12]} />
          <meshStandardMaterial color={PALETTE.metal} roughness={0.3} metalness={0.9} />
        </mesh>
      ))}

      {/* Accent strip over the doors — the building's one branded gesture */}
      <mesh position={[0, ENTRANCE.height + 1.15, 0.36]}>
        <boxGeometry args={[eh * 2, 0.12, 0.08]} />
        <meshBasicMaterial color={PALETTE.accent} toneMapped={false} />
      </mesh>
      {/* Door frame glow — guides the eye to the entrance from across the plaza */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (eh + 0.15), ENTRANCE.height / 2, 0.15]}>
          <boxGeometry args={[0.08, ENTRANCE.height, 0.08]} />
          <meshBasicMaterial color={PALETTE.accent} transparent opacity={0.25} toneMapped={false} />
        </mesh>
      ))}

      {/* Planters framing the approach */}
      {[-9, 9].map((x) =>
        [10, 18, 26].map((z) => (
          <group key={`${x}:${z}`} position={[x, 0, z]}>
            <mesh position={[0, 0.35, 0]} castShadow={quality.shadows} receiveShadow={quality.shadows}>
              <boxGeometry args={[2.4, 0.7, 2.4]} />
              <meshStandardMaterial color={PALETTE.stone} roughness={0.85} />
            </mesh>
            <mesh position={[0, 1.15, 0]}>
              <sphereGeometry args={[0.95, 10, 8]} />
              <meshStandardMaterial color="#16301f" roughness={1} />
            </mesh>
          </group>
        )),
      )}

      {/* Bollard lights walking you toward the door */}
      {[6, 14, 22, 30].map((z) =>
        [-5, 5].map((x) => (
          <group key={`b${x}:${z}`} position={[x, 0, z]}>
            <mesh position={[0, 0.5, 0]}>
              <cylinderGeometry args={[0.09, 0.11, 1, 8]} />
              <meshStandardMaterial color={PALETTE.metal} roughness={0.4} metalness={0.8} />
            </mesh>
            <mesh position={[0, 1.02, 0]}>
              <cylinderGeometry args={[0.1, 0.1, 0.06, 8]} />
              <meshBasicMaterial color={PALETTE.accent} toneMapped={false} />
            </mesh>
          </group>
        )),
      )}

      <CityBlocks count={quality.cityWindows > 1000 ? 260 : 90} />
    </group>
  )
}
