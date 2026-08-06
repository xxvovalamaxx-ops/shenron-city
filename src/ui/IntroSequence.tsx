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
import { introAudio } from '../audio/intro'

export const INTRO_DURATION = 4.6

/** Camera dive. Runs only during the intro window. */
export function IntroCamera() {
  const start = useRef<Vector3 | null>(null)

  useFrame(({ camera }) => {
    if (rt.introSeconds >= INTRO_DURATION) return
    if (!start.current) {
      const p = rt.player.pos
      start.current = new Vector3(p.x + 240, p.y + 420, p.z + 260)
    }
    const progress = Math.min(1, rt.introSeconds / (INTRO_DURATION - 1.1))
    const ease = 1 - Math.pow(1 - progress, 3)
    const target = new Vector3(rt.player.pos.x, rt.player.pos.y + 1.66, rt.player.pos.z)
    camera.position.lerpVectors(start.current, target, ease)
    camera.lookAt(target.x, target.y - 0.4, target.z)
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
