/**
 * Keyboard state as a ref, not React state.
 *
 * A keydown must not re-render the tree — it only needs to be readable from
 * the frame loop.
 */
import { useEffect, useRef } from 'react'

export interface Keys {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  sprint: boolean
  jump: boolean
}

const MAP: Record<string, keyof Keys> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'jump',
}

export function useKeys() {
  const keys = useRef<Keys>({
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
    jump: false,
  })

  useEffect(() => {
    const set = (code: string, down: boolean) => {
      const k = MAP[code]
      if (k) keys.current[k] = down
    }
    const onDown = (e: KeyboardEvent) => {
      // Space scrolls the page otherwise, which fights the pointer lock.
      if (e.code === 'Space') e.preventDefault()
      set(e.code, true)
    }
    const onUp = (e: KeyboardEvent) => set(e.code, false)
    /** Losing focus mid-stride otherwise leaves the player walking forever. */
    const clear = () => {
      for (const k of Object.keys(keys.current) as (keyof Keys)[]) keys.current[k] = false
    }

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return keys
}
