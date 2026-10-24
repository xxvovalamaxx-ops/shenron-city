/**
 * The player's visible body, third person only.
 *
 * Stands the realistic CC3 character where the on-foot simulation put the
 * player, facing the way the simulation turned the body
 * (`playerMotion.foot.bodyYaw`) — which is not the camera's heading: the
 * orbit camera and the body turn independently, as in GTA. A small roll into
 * turns and a forward pitch under acceleration give the body some weight.
 *
 * Not rendered in first person at all.
 */
import { Suspense, useCallback, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { rt } from '../gameplay/runtime'
import { vehicleSim } from '../gameplay/vehicles/vehicle-session'
import { playerMotion } from '../gameplay/player/player-motion'
import { stepDt } from '../gameplay/player/sim-step'
import { angleDelta, damp } from '../gameplay/player/orbit-camera'
import { useHud } from '../ui/hud-store'
import { RealisticPlayer } from './RealisticPlayer'
import type { BodyClip } from './locomotion-blend'

/** Most the body rolls into a turn, radians. */
const MAX_LEAN = 0.09
/** Most the body pitches forward under acceleration, radians. */
const MAX_PITCH = 0.07

export function PlayerAvatar() {
  const root = useRef<Group>(null)
  const tilt = useRef<Group>(null)
  const lastYaw = useRef(playerMotion.foot.bodyYaw)
  const lastSpeed = useRef(0)
  const lean = useRef(0)
  const pitch = useRef(0)
  const thirdPerson = useHud((s) => s.thirdPerson)

  useEffect(() => {
    const doc = document.documentElement
    doc.dataset.avatarThirdPerson = String(thirdPerson)
    return () => {
      delete doc.dataset.avatarThirdPerson
      delete doc.dataset.avatarMotion
    }
  }, [thirdPerson])

  const publishClip = useCallback((clip: BodyClip) => {
    document.documentElement.dataset.avatarMotion = clip
  }, [])

  useFrame((_, delta) => {
    if (rt.paused) return
    // While the player is attached to a seat the avatar is not rendered; the
    // sim owns the pose and publishes it to rt.player.
    if (!vehicleSim.playerVisible) return
    const group = root.current
    if (!group) return

    const dt = Math.max(1e-4, stepDt(delta, 0.05))
    const p = rt.player
    const foot = playerMotion.foot
    group.position.set(p.pos.x, p.pos.y, p.pos.z)
    group.rotation.y = foot.bodyYaw

    // Lean into turns: yaw rate × speed, rolled about the body's forward axis.
    const yawRate = angleDelta(lastYaw.current, foot.bodyYaw) / dt
    lastYaw.current = foot.bodyYaw
    const speed = playerMotion.groundSpeed
    const wantLean = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, -yawRate * speed * 0.012))
    lean.current = damp(lean.current, playerMotion.grounded ? wantLean : 0, 8, dt)
    // Pitch forward when speeding up, back a touch when braking.
    const accel = (speed - lastSpeed.current) / dt
    lastSpeed.current = speed
    const wantPitch = Math.max(-MAX_PITCH * 0.6, Math.min(MAX_PITCH, accel * 0.008))
    pitch.current = damp(pitch.current, playerMotion.grounded ? wantPitch : 0, 6, dt)
    if (tilt.current) tilt.current.rotation.set(pitch.current, 0, lean.current)
  })

  if (!thirdPerson) return null
  if (!vehicleSim.playerVisible) return null
  // Deterministic captures: the idle clip animates the skeleton, which moves
  // pixels between otherwise-identical captures. Captures are city evidence.
  if (rt.captureFrozen) return null

  return (
    <group ref={root}>
      <group ref={tilt}>
        <Suspense fallback={null}>
          <RealisticPlayer onDominantClip={publishClip} />
        </Suspense>
      </group>
    </group>
  )
}
