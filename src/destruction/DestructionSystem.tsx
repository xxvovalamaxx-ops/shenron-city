/**
 * Manages all breakable objects in the scene.
 *
 * Each breakable is a box mesh. Mesh refs are registered synchronously via
 * React ref callbacks into the module-level breakableMeshRegistry — no
 * globalThis, no useFrame timing dependency. Damage is applied by the
 * laser hook which reads the registry directly.
 */
import { useCallback, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, Vector3 } from 'three'
import { rt } from '../gameplay/runtime'
import { BREAKABLES, type BreakableDef } from './BreakableRegistry'
import { LASER_CONFIG } from '../weapons/laser'
import { Fragment } from './Fragment'
import { ScorchMark } from '../weapons/ScorchMark'
import { registerBreakableMesh } from './breakableMeshRegistry'

interface BreakableHealth {
  id: string
  current: number
  max: number
}

interface ActiveFragment {
  id: string
  def: BreakableDef
  origin: Vector3
  direction: Vector3
}

interface Scorch {
  id: string
  position: [number, number, number]
  normal: [number, number, number]
}

export function DestructionSystem() {
  const [healths, setHealths] = useState<Map<string, BreakableHealth>>(() => {
    const map = new Map<string, BreakableHealth>()
    for (const def of BREAKABLES) {
      map.set(def.id, { id: def.id, current: def.health, max: def.health })
    }
    return map
  })
  const [fragments, setFragments] = useState<ActiveFragment[]>([])
  const [scorchMarks, setScorchMarks] = useState<Scorch[]>([])
  const idCounter = useRef(0)

  const removeFragment = useCallback((id: string) => {
    setFragments((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const removeScorch = useCallback((id: string) => {
    setScorchMarks((prev) => prev.filter((s) => s.id !== id))
  }, [])

  // Expose damage handler for the laser hook to call.
  // Returns the aimPoint if damage was applied, for beam targeting.
  useFrame(() => {
    if (rt.paused) return
    if (!rt.player.firing || rt.player.overheated || !rt.player.aimPoint) return

    const aim = rt.player.aimPoint

    for (const def of BREAKABLES) {
      if (rt.destroyed.has(def.id)) continue

      // Fast AABB pre-check: is the aim point within tolerance of this breakable?
      const hx = def.size[0] / 2 + 0.5
      const hy = def.size[1] / 2 + 0.5
      const hz = def.size[2] / 2 + 0.5
      if (
        Math.abs(aim.x - def.pos.x) > hx ||
        Math.abs(aim.y - def.pos.y) > hy ||
        Math.abs(aim.z - def.pos.z) > hz
      ) continue

      const dt = 1 / 60
      const damage = LASER_CONFIG.dps * dt
      setHealths((prev) => {
        const next = new Map(prev)
        const h = next.get(def.id)
        if (!h) return prev
        const newHealth = h.current - damage
        if (newHealth <= 0) {
          rt.destroyed.add(def.id)
          const dir = new Vector3()
            .copy(aim)
            .sub(new Vector3(def.pos.x, def.pos.y, def.pos.z))
            .normalize()

          const fragCount = def.fragments ?? 5
          const newFrags: ActiveFragment[] = []
          for (let i = 0; i < fragCount; i++) {
            newFrags.push({
              id: `frag-${idCounter.current++}`,
              def,
              origin: new Vector3(def.pos.x, def.pos.y, def.pos.z),
              direction: dir,
            })
          }
          setFragments((prev) => [...prev, ...newFrags])

          setScorchMarks((prev) => [
            ...prev.slice(-20),
            {
              id: `scorch-${idCounter.current++}`,
              position: [aim.x, aim.y, aim.z],
              normal: [0, 1, 0],
            },
          ])
        }
        next.set(def.id, { ...h, current: Math.max(0, newHealth) })
        return next
      })
      break
    }
  })

  return (
    <>
      {BREAKABLES.map((def) => {
        const destroyed = rt.destroyed.has(def.id)
        const h = healths.get(def.id)
        const healthPct = h ? h.current / h.max : 1

        return (
          <BreakableMesh
            key={def.id}
            def={def}
            destroyed={destroyed}
            healthPct={healthPct}
          />
        )
      })}

      {fragments.map((f) => (
        <Fragment
          key={f.id}
          def={f.def}
          origin={f.origin}
          direction={f.direction}
          onExpired={() => removeFragment(f.id)}
        />
      ))}

      {scorchMarks.map((s) => (
        <ScorchMark
          key={s.id}
          position={s.position}
          normal={s.normal}
          onExpire={() => removeScorch(s.id)}
        />
      ))}
    </>
  )
}

function BreakableMesh({
  def,
  destroyed,
  healthPct,
}: {
  def: BreakableDef
  destroyed: boolean
  healthPct: number
}) {
  const ref = useCallback(
    (mesh: Mesh | null) => {
      registerBreakableMesh(def.id, mesh)
      // Force matrixWorld so the raycaster works on the very first frame.
      if (mesh) mesh.updateMatrixWorld(true)
    },
    [def.id],
  )

  return (
    <group position={[def.pos.x, def.pos.y, def.pos.z]} visible={!destroyed}>
      <mesh ref={ref} castShadow receiveShadow>
        <boxGeometry args={def.size} />
        <meshStandardMaterial
          color={def.color}
          roughness={def.type === 'crate' ? 0.86 : 0.52}
          metalness={def.type === 'desk' ? 0.34 : 0}
          emissive={healthPct < 0.5 && !destroyed ? '#ef4444' : '#000000'}
          emissiveIntensity={healthPct < 0.5 ? (1 - healthPct) * 0.4 : 0}
        />
      </mesh>

      {def.type === 'crate' && (
        <>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * def.size[0] * 0.34, 0, def.size[2] / 2 + 0.012]}>
              <boxGeometry args={[0.075, def.size[1] * 0.88, 0.035]} />
              <meshStandardMaterial color="#8a6848" roughness={0.92} />
            </mesh>
          ))}
          {[-0.45, 0.45].map((angle) => (
            <mesh key={angle} position={[0, 0, def.size[2] / 2 + 0.018]} rotation={[0, 0, angle]}>
              <boxGeometry args={[def.size[0] * 0.82, 0.065, 0.04]} />
              <meshStandardMaterial color="#8a6848" roughness={0.92} />
            </mesh>
          ))}
        </>
      )}

      {def.type === 'desk' && (
        <>
          <mesh position={[0, def.size[1] / 2 + 0.055, 0]} castShadow>
            <boxGeometry args={[def.size[0] + 0.16, 0.11, def.size[2] + 0.14]} />
            <meshStandardMaterial color="#303745" roughness={0.38} metalness={0.52} />
          </mesh>
          <mesh position={[0, 0.18, def.size[2] / 2 + 0.018]}>
            <boxGeometry args={[def.size[0] * 0.72, 0.055, 0.035]} />
            <meshBasicMaterial color="#2dd4bf" toneMapped={false} />
          </mesh>
        </>
      )}
    </group>
  )
}
