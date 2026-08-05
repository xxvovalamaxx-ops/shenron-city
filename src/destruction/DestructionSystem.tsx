/**
 * Renders the destructible props.
 *
 * Presentation only. The simulation — healths, fragments, scorches, damage
 * stepping — lives in `rt.destruction` (see destruction.ts) and is advanced
 * by GameLoop with the same real dt as everything else. This component reads
 * that state and mirrors it into React via the revision counter; it owns no
 * game state, so StrictMode's double-invocation cannot duplicate anything.
 */
import { useCallback, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh } from 'three'
import { rt } from '../gameplay/runtime'
import { BREAKABLES, type BreakableDef } from './BreakableRegistry'
import {
  removeFragment,
  removeScorch,
} from './destruction'
import { Fragment } from './Fragment'
import { ScorchMark } from '../weapons/ScorchMark'
import { registerBreakableMesh } from './breakableMeshRegistry'

export function DestructionSystem() {
  // Mirror of rt.destruction for render. The sim bumps `revision` on every
  // change; polling it in useFrame is cheaper than subscribing each
  // fragment, and it never re-renders from a React-owned setState in the
  // damage path (there is no React-owned damage path any more).
  const [, setSnapshot] = useState(rt.destruction.revision)
  const lastRevision = useRef(rt.destruction.revision)

  useFrame(() => {
    const rev = rt.destruction.revision
    if (rev === lastRevision.current) return
    lastRevision.current = rev
    setSnapshot(rev)
  })

  const handleFragmentExpired = useCallback((id: string) => {
    removeFragment(rt.destruction, id)
  }, [])

  const handleScorchExpired = useCallback((id: string) => {
    removeScorch(rt.destruction, id)
  }, [])

  const fragments = rt.destruction.fragments
  const scorches = rt.destruction.scorches

  return (
    <>
      {BREAKABLES.map((def) => {
        const destroyed = rt.destroyed.has(def.id)
        const h = rt.destruction.healths.get(def.id)
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
          onExpired={() => handleFragmentExpired(f.id)}
        />
      ))}

      {scorches.map((s) => (
        <ScorchMark
          key={s.id}
          position={s.position}
          normal={s.normal}
          onExpire={() => handleScorchExpired(s.id)}
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
