/**
 * Cinematic entry: the logo spins in, expands to swallow the screen, then
 * shrinks away GTA-style as the camera dives from the sky onto the player.
 *
 * The overlay is pure DOM/CSS. The camera flight is a small R3F component that
 * runs while `rt.introSeconds` is inside the intro window — the game loop
 * deliberately defers camera ownership and freezes input for that window.
 */
import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { rt } from '../gameplay/runtime'
import { lookAnglesFromDirection } from '../gameplay/look'
import { introAudio } from '../audio/intro'

export const INTRO_DURATION = 4.6

/** Scratch for the handover conversion; the dive runs every frame. */
const forward = new Vector3()

/** Camera dive. Runs only during the intro window. */
export function IntroCamera() {
  const start = useRef<Vector3 | null>(null)
  const handedOver = useRef(false)

  useFrame(({ camera }) => {
    if (rt.introSeconds >= INTRO_DURATION) {
      // Hand the camera over level, once.
      //
      // The dive orients with lookAt, which writes a quaternion; camera.rotation
      // then decomposes it in the camera's order — XYZ by default — and a
      // downward look puts part of itself in `z`. Measured after the intro:
      // roll z = 0.2686, a 15.4 degree tilt, still there minutes later because
      // nothing rewrites the rotation until the player drags.
      //
      // So convert once, through the forward direction rather than the Euler
      // components, into the YXZ form every other controller uses. Yaw is kept
      // so the player faces where the dive pointed them; pitch and roll are
      // dropped so they start looking at the horizon rather than the pavement.
      if (!handedOver.current) {
        handedOver.current = true
        camera.getWorldDirection(forward)
        const { yaw } = lookAnglesFromDirection(forward)
        camera.rotation.order = 'YXZ'
        camera.rotation.set(0, yaw, 0)
      }
      return
    }
    handedOver.current = false
    if (!start.current) {
      const p = rt.player.pos
      start.current = new Vector3(p.x + 240, p.y + 420, p.z + 260)
    }
    const progress = Math.min(1, rt.introSeconds / (INTRO_DURATION - 1.1))
    const ease = 1 - Math.pow(1 - progress, 3)
    const eye = new Vector3(rt.player.pos.x, rt.player.pos.y + 1.66, rt.player.pos.z)
    camera.position.lerpVectors(start.current, eye, ease)

    // Aim at the player early and out to the horizon as we land.
    //
    // The dive used to look at `eye.y - 0.4` for its whole length. That is
    // fine at 420 m up and degenerate at the end: the camera arrives *at* the
    // player and is still asked to look 0.4 m below itself, i.e. straight
    // down. Measured, the handover left the camera pitched 88.8 degrees with
    // its up vector at y = 0.02 — lying on its side, staring at the pavement,
    // which is the view the player then had to drag themselves out of.
    //
    // So the aim point slides forward as the dive lands. `-z` is the camera's
    // resting heading; by the time ease reaches 1 the target is 60 m ahead at
    // eye height and the handover pitch is level.
    const AIM_AHEAD = 60
    const settle = ease * ease
    camera.lookAt(
      eye.x,
      eye.y - 0.4 * (1 - settle),
      eye.z - AIM_AHEAD * settle,
    )
  })

  return null
}

type Phase = 'spin' | 'expand' | 'shrink' | 'done'

const PHASE_TIMING: Array<[Phase, number]> = [
  ['spin', 1600],
  ['expand', 1300],
  ['shrink', 1700],
]

export function IntroSequence({ onDone }: { onDone(): void }) {
  const [phase, setPhase] = useState<Phase>('spin')
  const [exited, setExited] = useState(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    introAudio.play()
    rt.introSeconds = 0
    const timers = PHASE_TIMING.map(([nextPhase, delay], index) =>
      setTimeout(
        () => {
          setPhase(nextPhase)
          if (index === PHASE_TIMING.length - 1) {
            setTimeout(() => {
              setExited(true)
              rt.introSeconds = Number.POSITIVE_INFINITY
              onDoneRef.current()
            }, 150)
          }
        },
        PHASE_TIMING.slice(0, index + 1).reduce((sum, [, d]) => sum + d, 0) - delay,
      ),
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  // Cleanup: if the component unmounts for any reason (e.g. the menu opens),
  // make sure the intro window closes so input never stays frozen.
  useEffect(() => {
    return () => {
      rt.introSeconds = Number.POSITIVE_INFINITY
    }
  }, [])

  if (exited) return null

  return (
    <div className={`intro-overlay intro-phase-${phase}`} aria-hidden="true">
      <div className="intro-wordmark">
        <span className="intro-word-1">SHENZHEN</span>
        <span className="intro-word-2">CITY</span>
      </div>
      <div className="intro-vignette" />
    </div>
  )
}
