/**
 * Cinematic entry: plays the intro video, then dives the camera from the sky
 * onto the player. Press Space to skip the video.
 *
 * The overlay is pure DOM/CSS. The camera flight is a small R3F component that
 * runs while `rt.introSeconds` is inside the intro window — the game loop
 * deliberately defers camera ownership and freezes input for that window.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { rt } from '../gameplay/runtime'
import { useSimulationStage } from '../gameplay/useSimulationStage'
import { lookAnglesFromDirection } from '../gameplay/look'

export const INTRO_DURATION = 4.6

/** Scratch for the handover conversion; the dive runs every frame. */
const forward = new Vector3()

/** Camera dive. Runs only during the intro window. */
export function IntroCamera() {
  const start = useRef<Vector3 | null>(null)
  const handedOver = useRef(false)
  const camera = useThree((s) => s.camera)

  // Presentation, and only safe there.
  //
  // This used to be a bare useFrame at render priority 150, and that number
  // was load-bearing: DragLook writes the camera at the default 0, so the dive
  // only survives because it runs after. The presentation stage is dispatched
  // from a priority-300 callback for exactly this reason — moving it onto the
  // -100 gameplay call would have let DragLook overwrite the dive every frame,
  // and the intro would have jittered or died with no error anywhere.
  useSimulationStage('intro-camera', 'presentation', () => {
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

export function IntroSequence({ onDone }: { onDone(): void }) {
  const [exited, setExited] = useState(false)
  const exitedRef = useRef(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const skip = useCallback(() => {
    if (exitedRef.current) return
    exitedRef.current = true
    setExited(true)
    rt.introSeconds = Number.POSITIVE_INFINITY
    onDoneRef.current()
  }, [])

  useEffect(() => {
    rt.introSeconds = 0
    const video = videoRef.current
    if (video) {
      video.play().catch(() => {})
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
        e.preventDefault()
        skip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      rt.introSeconds = Number.POSITIVE_INFINITY
    }
  }, [skip])

  // Cleanup: if the component unmounts for any reason (e.g. the menu opens),
  // make sure the intro window closes so input never stays frozen.
  useEffect(() => {
    return () => {
      rt.introSeconds = Number.POSITIVE_INFINITY
    }
  }, [])

  if (exited) return null

  return (
    <div className="intro-video-overlay" onClick={skip}>
      <video
        ref={videoRef}
        src="/intro.mp4"
        className="intro-video"
        onEnded={skip}
        playsInline
      />
      <div className="intro-skip-hint">Press Space to skip</div>
    </div>
  )
}
