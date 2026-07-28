/**
 * Registers the static world geometry as fixed Rapier rigid bodies.
 *
 * This runs alongside (not instead of) the custom AABB collision system.
 * Rapier uses these colliders for dynamic/kinematic bodies (future NPCs,
 * physics props, vehicles). The player still uses moveWithCollisions.
 */
import { RigidBody, CuboidCollider } from '@react-three/rapier'
import { useMemo } from 'react'
import { staticColliders, hqColliders } from '../world/layout'
import type { AABB } from './collision'

function aabbToCuboid(a: AABB) {
  const cx = (a.min[0] + a.max[0]) / 2
  const cy = (a.min[1] + a.max[1]) / 2
  const cz = (a.min[2] + a.max[2]) / 2
  const hx = (a.max[0] - a.min[0]) / 2
  const hy = (a.max[1] - a.min[1]) / 2
  const hz = (a.max[2] - a.min[2]) / 2
  return {
    position: [cx, cy, cz] as [number, number, number],
    args: [hx, hy, hz] as [number, number, number],
  }
}

export function StaticWorldColliders() {
  const boxes = useMemo(() => {
    const all = [...staticColliders(), ...hqColliders()]
    return all.map(aabbToCuboid)
  }, [])

  return (
    <RigidBody type="fixed" colliders={false}>
      {boxes.map((b, i) => (
        <CuboidCollider key={i} args={b.args} position={b.position} />
      ))}
    </RigidBody>
  )
}
