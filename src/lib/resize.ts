/**
 * A ResizeObserver that always delivers.
 *
 * R3F sizes its canvas with react-use-measure, which depends on
 * ResizeObserver, and it refuses to create the WebGL root until it receives a
 * non-zero measurement. Some embedded hosts expose a ResizeObserver
 * constructor that never invokes its callback — Claude's browser pane is one —
 * and the app then hangs forever on the loading screen with a 300x150 canvas
 * and no error anywhere. Verified directly: `new ResizeObserver(cb).observe(el)`
 * on a 1280x720 element produced zero callbacks in 800 ms.
 *
 * This wraps the native observer where it works and adds a cheap size poll as
 * a floor. One getBoundingClientRect per observed element every 250 ms is
 * nothing next to a frame of WebGL, and it makes startup independent of host
 * quirks.
 *
 * react-use-measure only needs `observe`, `unobserve` and `disconnect`, and
 * only reads `contentRect` off each entry.
 */

const POLL_MS = 250

interface MinimalEntry {
  target: Element
  contentRect: DOMRectReadOnly
}

type Callback = (entries: MinimalEntry[]) => void

export class ResilientResizeObserver {
  private callback: Callback
  private native: ResizeObserver | null = null
  private targets = new Set<Element>()
  private lastSize = new WeakMap<Element, string>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(callback: Callback) {
    this.callback = callback

    if (typeof ResizeObserver !== 'undefined') {
      try {
        this.native = new ResizeObserver((entries) => {
          for (const e of entries) this.remember(e.target)
          this.callback(entries as unknown as MinimalEntry[])
        })
      } catch {
        this.native = null
      }
    }
  }

  observe(target: Element): void {
    this.targets.add(target)
    this.native?.observe(target)
    // Deliver an immediate reading rather than waiting a poll interval — this
    // is what unblocks the first render.
    this.check(target)
    this.start()
  }

  unobserve(target: Element): void {
    this.targets.delete(target)
    this.native?.unobserve(target)
    if (this.targets.size === 0) this.stop()
  }

  disconnect(): void {
    this.targets.clear()
    this.native?.disconnect()
    this.stop()
  }

  private start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      for (const t of this.targets) this.check(t)
    }, POLL_MS)
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private key(rect: DOMRectReadOnly): string {
    return `${Math.round(rect.width)}x${Math.round(rect.height)}`
  }

  private remember(target: Element): void {
    this.lastSize.set(target, this.key(target.getBoundingClientRect()))
  }

  /** Emit only when the size actually changed, so this is not a render loop. */
  private check(target: Element): void {
    const rect = target.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    const k = this.key(rect)
    if (this.lastSize.get(target) === k) return
    this.lastSize.set(target, k)
    this.callback([{ target, contentRect: rect }])
  }
}
