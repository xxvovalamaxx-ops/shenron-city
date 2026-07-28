/**
 * Manages all breakable objects in the scene.
 *
 * Each breakable is rendered as a simple box. When the laser deals enough
 * damage, the box hides and N fragment boxes spawn with physics. The
 * breakable's collision AABB is removed so the player can walk through.
 */
import { useCallback, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { rt } from '../gameplay/runtime'
import { BREAKABLES, type BreakableDef } from './BreakableRegistry'
import { LASER_CONFIG } from '../weapons/laser'
import { Fragment } from './Fragment'
import { ScorchMark } from '../weapons/ScorchMark'

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

  const getColliderAABBs = useCallback(() => {
    const result: { id: string; min: readonly [number, number, number]; max: readonly [number, number, number] }[] = []
    for (const def of BREAKABLES) {
      if (rt.destroyed.has(def.id)) continue
      const hx = def.size[0] / 2
      const hy = def.size[1] / 2
      const hz = def.size[2] / 2
      result.push({
        id: def.id,
        min: [def.pos.x - hx, def.pos.y - hy, def.pos.z - hz],
        max: [def.pos.x + hx, def.pos.y + hy, def.pos.z + hz],
      })
    }
    return result
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    if (!rt.player.firing || rt.player.overheated || !rt.player.aimPoint) return

    const aim = rt.player.aimPoint
    const aimVec = new Vector3(aim.x, aim.y, aim.z)

    for (const def of BREAKABLES) {
      if (rt.destroyed.has(def.id)) continue

      const hx = def.size[0] / 2 + 0.15
      const hy = def.size[1] / 2 + 0.15
      const hz = def.size[2] / 2 + 0.15

      if (
        Math.abs(aim.x - def.pos.x) < hx &&
        Math.abs(aim.y - def.pos.y) < hy &&
        Math.abs(aim.z - def.pos.z) < hz
      ) {
        const damage = LASER_CONFIG.dps * dt
        setHealths((prev) => {
          const next = new Map(prev)
          const h = next.get(def.id)
          if (!h) return prev
          const newHealth = h.current - damage
          if (newHealth <= 0) {
            rt.destroyed.add(def.id)
            const dir = new Vector3()
              .copy(aimVec)
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
    }
  })

  const removeFragment = useCallback((id: string) => {
    setFragments((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const removeScorch = useCallback((id: string) => {
    setScorchMarks((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const aabbGetter = useCallback(() => {
    return getColliderAABBs().map((c) => ({
      min: c.min,
      max: c.max,
    }))
  }, [getColliderAABBs])

  return (
    <>
      {BREAKABLES.map((def) => {
        const destroyed = rt.destroyed.has(def.id)
        const h = healths.get(def.id)
        const healthPct = h ? h.current / h.max : 1

        return (
          <mesh
            key={def.id}
            position={[def.pos.x, def.pos.y, def.pos.z]}
            visible={!destroyed}
            castShadow
          >
            <boxGeometry args={def.size} />
            <meshStandardMaterial
              color={def.color}
              roughness={0.7}
              emissive={healthPct < 0.5 && !destroyed ? '#ef4444' : '#000000'}
              emissiveIntensity={healthPct < 0.5 ? (1 - healthPct) * 0.4 : 0}
            />
          </mesh>
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

      <_AABBProvider getter={aabbGetter} />
    </>
  )
}

/**
 * Invisible component that exposes the breakable AABBs to the laser
 * raycasting system via a ref callback.
 */
function _AABBProvider({ getter }: { getter: () => { min: readonly [number, number, number]; max: readonly [number, number, number] }[] }) {
  useFrame(() => {
    ;(globalThis as unknown as { __breakableAABBs?: typeof getter }).__breakableAABBs = getter
  })
  return null
}
