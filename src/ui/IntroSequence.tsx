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
import { look, setLook } from '../gameplay/player/look-state'
import { resetPlayerMotion } from '../gameplay/player/player-motion'
import { STREET_SPAWNS, spawnFacingAt } from '../gameplay/player/spawn-points'
import { debugSpawnOverride } from '../gameplay/dev-view'
import {
  ORBIT_DISTANCE,
  ORBIT_PIVOT_HEIGHT,
  ORBIT_SHOULDER,
  orbitCameraPose,
  yawFromForward,
} from '../gameplay/player/orbit-camera'
import { introAudio } from '../audio/intro'

export const INTRO_DURATION = 4.6

/** The pitch the camera settles at behind the player: just under level. */
const HANDOVER_PITCH = -0.1

/** Smoothstep, for the look-target blend. */
function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/**
 * Aim the player and the orbit camera for the handover: along the spawn's
 * avenue on a fresh start, otherwise along whatever heading the save
 * restored. Called when the intro starts rather than from the camera's first
 * frame, so it holds even when a slow machine renders no frame at all inside
 * the intro window.
 */
function prepareIntroHandover(): void {
  const p = rt.player.pos
  const override =
    import.meta.env.DEV && typeof location !== 'undefined'
      ? debugSpawnOverride(location.search, true)
      : null
  const facing =
    spawnFacingAt(p.x, p.z, override ? [override, ...STREET_SPAWNS] : STREET_SPAWNS) ?? rt.player.forward
  rt.player.forward = { x: facing.x, z: facing.z }
  setLook(yawFromForward(facing.x, facing.z), HANDOVER_PITCH)
  resetPlayerMotion(facing.x, facing.z)
}

/**
 * Camera dive. Runs only during the intro window.
 *
 * It lands exactly on the orbit camera's first pose — behind the player, over
 * the right shoulder, level — with the mouse's yaw and pitch set to match, so
 * the walk camera takes over without a cut. (It used to dive *into* the
 * player's head looking straight down; the walk camera then pushed back along
 * that view and the game opened on a top-down shot of a man lying in the road.)
 */
export function IntroCamera() {
  const start = useRef<Vector3 | null>(null)
  const end = useRef<{ position: Vector3; target: Vector3 } | null>(null)
  const head = useRef(new Vector3())
  const aim = useRef(new Vector3())

  useFrame(({ camera }) => {
    if (rt.introSeconds >= INTRO_DURATION) {
      start.current = null
      end.current = null
      return
    }
    const p = rt.player.pos
    if (!start.current || !end.current) {
      start.current = new Vector3(p.x + 240, p.y + 420, p.z + 260)
      const pivot = { x: p.x, y: p.y + ORBIT_PIVOT_HEIGHT, z: p.z }
      const pose = orbitCameraPose(pivot, look, ORBIT_DISTANCE, ORBIT_SHOULDER)
      end.current = {
        position: new Vector3(pose.position.x, pose.position.y, pose.position.z),
        target: new Vector3(pose.target.x, pose.target.y, pose.target.z),
      }
    }
    const progress = Math.min(1, rt.introSeconds / (INTRO_DURATION - 1.1))
    const ease = 1 - Math.pow(1 - progress, 3)
    camera.position.lerpVectors(start.current, end.current.position, ease)
    // Watch the player on the way down, then settle onto the orbit's aim line.
    head.current.set(p.x, p.y + 1.2, p.z)
    aim.current.lerpVectors(head.current, end.current.target, smooth((progress - 0.55) / 0.45))
    camera.lookAt(aim.current)
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
    prepareIntroHandover()
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
