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
import { Suspense, useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { rt } from '../gameplay/runtime'
import { useHud } from '../ui/hud-store'
import { QuaterniusHero } from '../agents/QuaterniusHero'
import {
  nextPlayerAnimationSample,
  playerAnimationRate,
  type PlayerAnimationSample,
} from './player-locomotion'

/** How fast the body turns to face travel, radians per second. */
const TURN_RATE = 9

export function PlayerAvatar() {
  const root = useRef<Group>(null)
  const yaw = useRef(0)
  const speed = useRef(0)
  const last = useRef({ x: rt.player.pos.x, z: rt.player.pos.z })
  const [animation, setAnimation] = useState<PlayerAnimationSample>({
    motion: 'Idle_Loop',
    speed: 0,
  })
  const publishedAnimation = useRef(animation)
  const thirdPerson = useHud((s) => s.thirdPerson)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.avatarMotion = animation.motion
    root.dataset.avatarPlaybackRate = playerAnimationRate(
      animation.motion,
      animation.speed,
    ).toFixed(3)
    root.dataset.avatarThirdPerson = String(thirdPerson)
    return () => {
      delete root.dataset.avatarMotion
      delete root.dataset.avatarPlaybackRate
      delete root.dataset.avatarThirdPerson
    }
  }, [animation, thirdPerson])

  useFrame((_, delta) => {
    if (rt.paused) return

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

    const group = root.current
    if (group) group.position.set(p.pos.x, p.pos.y, p.pos.z)

    // Face travel while moving, and hold the last heading when stopped so the
    // body does not snap to a default direction the instant you release a key.
    if (group && Math.hypot(dx, dz) > 1e-4) {
      const target = Math.atan2(dx, dz)
      let diff = target - yaw.current
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      yaw.current += diff * Math.min(1, dt * TURN_RATE)
    }
    if (group) group.rotation.y = yaw.current

    const next = nextPlayerAnimationSample(publishedAnimation.current, {
      speed: speed.current,
      grounded: p.grounded,
    })
    if (next !== publishedAnimation.current) {
      publishedAnimation.current = next
      setAnimation(next)
    }
  })

  if (!thirdPerson) return null

  return (
    <group ref={root}>
      {/* No fallback body: a placeholder that appears for a moment and is
          replaced is worse than the character simply arriving. */}
      <Suspense fallback={null}>
        <QuaterniusHero
          motion={animation.motion}
          animationSpeed={playerAnimationRate(animation.motion, animation.speed)}
        />
      </Suspense>
    </group>
  )
}
