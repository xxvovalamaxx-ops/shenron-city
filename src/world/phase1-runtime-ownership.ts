export interface Phase1RuntimeLease {
  readonly generation: number
  active: boolean
}

/**
 * React StrictMode may clean up one effect and start its replacement before an
 * aborted fetch settles. A lease lets the replacement reject every late event
 * from that prior effect instead of republishing its diagnostics globally.
 */
export class Phase1RuntimeOwnership {
  private generation = 0
  private current: Phase1RuntimeLease | null = null

  acquire(): Phase1RuntimeLease {
    const lease: Phase1RuntimeLease = {
      generation: ++this.generation,
      active: true,
    }
    this.current = lease
    return lease
  }

  owns(lease: Phase1RuntimeLease): boolean {
    return lease.active && this.current === lease
  }

  release(lease: Phase1RuntimeLease): void {
    lease.active = false
    if (this.current === lease) this.current = null
  }
}
