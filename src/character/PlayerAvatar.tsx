/**
 * The player's visible body, third person only.
 *
 * Uses the same rigged Quaternius character the plaza warden does, driven by
 * the player's real ground speed, so the avatar walks, jogs and sprints in step
 * with the movement code instead of looping one clip. The placeholder box body
 * it replaces was fine when you only ever glimpsed it looking down; the moment
 * the camera moved behind the player it became the main thing in frame.
 *
 * Not rendered in first person at all. Hiding it costs nothing and avoids the
 * camera sitting inside a head, which no amount of near-plane tuning fixes.
 */
import { Suspense, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { rt } from '../gameplay/runtime'
import { useHud } from '../ui/hud-store'
import { QuaterniusHero } from '../agents/QuaterniusHero'
import { playerAnimationRate, playerMotionFor, type PlayerMotion } from './player-locomotion'

/** How fast the body turns to face travel, radians per second. */
const TURN_RATE = 9

export function PlayerAvatar() {
  const root = useRef<Group>(null)
  const yaw = useRef(0)
  const speed = useRef(0)
  const last = useRef({ x: 0, z: 0 })
  const motion = useRef<PlayerMotion>('Idle_Loop')
  const thirdPerson = useHud((s) => s.thirdPerson)

  useFrame((_, delta) => {
    const group = root.current
    if (!group) return

    const dt = Math.max(1e-4, Math.min(delta, 0.05))
    const p = rt.player

    // Ground speed from actual displacement rather than intent: this is what
    // the world did to the player, after collision, so the clip matches what
    // is on screen even when they are walking into a wall.
    const dx = p.pos.x - last.current.x
    const dz = p.pos.z - last.current.z
    last.current.x = p.pos.x
    last.current.z = p.pos.z
    const instantaneous = Math.hypot(dx, dz) / dt
    // Smoothed, or a single stuttered frame flips the clip and back.
    speed.current += (instantaneous - speed.current) * Math.min(1, dt * 12)

    group.position.set(p.pos.x, p.pos.y, p.pos.z)

    // Face travel while moving, and hold the last heading when stopped so the
    // body does not snap to a default direction the instant you release a key.
    if (Math.hypot(dx, dz) > 1e-4) {
      const target = Math.atan2(dx, dz)
      let diff = target - yaw.current
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      yaw.current += diff * Math.min(1, dt * TURN_RATE)
    }
    group.rotation.y = yaw.current

    motion.current = playerMotionFor({ speed: speed.current, grounded: p.grounded })
  })

  if (!thirdPerson) return null

  const chosen = motion.current
  return (
    <group ref={root}>
      {/* No fallback body: a placeholder that appears for a moment and is
          replaced is worse than the character simply arriving. */}
      <Suspense fallback={null}>
        <QuaterniusHero
          motion={chosen}
          animationSpeed={playerAnimationRate(chosen, speed.current)}
        />
      </Suspense>
    </group>
  )
}
