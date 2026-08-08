/**
 * A live readout of what the game thinks you are pressing.
 *
 * Asked for directly: "i need the ability to see what im pressing on the dev
 * mode when enabled". It is also the cheapest possible answer to a whole class
 * of bug report — "I pressed W and nothing happened" has two very different
 * causes, and this says which. A key lit here that does nothing is a movement
 * bug; a key that never lights is an input bug, and they live in different
 * files.
 *
 * Reads `rt.keys`, which is the same object the game loop consumes, rather
 * than listening for its own key events. A monitor with its own listeners
 * would happily show a key the simulation never received — which is precisely
 * the failure it is meant to detect.
 *
 * Polled rather than subscribed: `rt` is a plain mutable object with no change
 * notification, and a React subscription per keystroke is more machinery than
 * a 10 Hz sample deserves.
 */
import { useEffect, useRef, useState } from 'react'

import { rt } from '../gameplay/runtime'

/** Sample rate. Fast enough to feel live, slow enough to be free. */
const POLL_MS = 80

/** Display order, with the label each one gets. Movement first, then modifiers. */
const KEYS: Array<[keyof typeof rt.keys, string]> = [
  ['forward', 'W'],
  ['left', 'A'],
  ['back', 'S'],
  ['right', 'D'],
  ['sprint', 'SHIFT'],
  ['jump', 'SPACE'],
  ['crouch', 'CTRL'],
]

interface Snapshot {
  keys: Record<string, boolean>
  mouse: { left: boolean; right: boolean; middle: boolean }
  look: { yaw: number; pitch: number }
  pos: { x: number; y: number; z: number }
  grounded: boolean
  flying: boolean
  paused: boolean
}

export function InputMonitor() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  // Mouse buttons are not in rt; they are the one thing this has to watch for
  // itself, so it watches the window rather than the canvas — a drag that
  // leaves the canvas is still a held button.
  const buttons = useRef({ left: false, right: false, middle: false })

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.button === 0) buttons.current.left = true
      if (e.button === 1) buttons.current.middle = true
      if (e.button === 2) buttons.current.right = true
    }
    const up = (e: PointerEvent) => {
      if (e.button === 0) buttons.current.left = false
      if (e.button === 1) buttons.current.middle = false
      if (e.button === 2) buttons.current.right = false
    }
    // A button released while the window is not focused never reports an up.
    const clear = () => {
      buttons.current = { left: false, right: false, middle: false }
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', clear)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', clear)
      window.removeEventListener('blur', clear)
    }
  }, [])

  useEffect(() => {
    const sample = () => {
      const keys: Record<string, boolean> = {}
      for (const [key] of KEYS) keys[key] = rt.keys[key]
      setSnap({
        keys,
        mouse: { ...buttons.current },
        look: {
          yaw: Math.atan2(rt.player.forward.x, rt.player.forward.z),
          pitch: 0,
        },
        pos: { ...rt.player.pos },
        grounded: rt.player.grounded,
        flying: rt.player.flying,
        paused: rt.paused,
      })
    }
    sample()
    const id = setInterval(sample, POLL_MS)
    return () => clearInterval(id)
  }, [])

  if (!snap) return null

  const heading = ((snap.look.yaw * 180) / Math.PI).toFixed(0)

  return (
    <div className="dev-menu-section input-monitor">
      <div className="dev-menu-title">Input</div>

      <div className="input-keys">
        {KEYS.map(([key, label]) => (
          <span
            key={key}
            className={`input-key${snap.keys[key] ? ' is-down' : ''}`}
            data-key={key}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="input-keys">
        <span className={`input-key${snap.mouse.left ? ' is-down' : ''}`}>LMB</span>
        <span className={`input-key${snap.mouse.middle ? ' is-down' : ''}`}>MMB</span>
        <span className={`input-key${snap.mouse.right ? ' is-down' : ''}`}>RMB</span>
      </div>

      <div className="input-readout">
        <span>
          pos {snap.pos.x.toFixed(1)}, {snap.pos.y.toFixed(2)}, {snap.pos.z.toFixed(1)}
        </span>
        <span>heading {heading}&deg;</span>
        <span>
          {snap.flying ? 'fly' : 'walk'}
          {snap.grounded ? ' · grounded' : ' · airborne'}
          {snap.paused ? ' · paused' : ''}
        </span>
      </div>
    </div>
  )
}
