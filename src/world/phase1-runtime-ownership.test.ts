import { describe, expect, it } from 'vitest'

import { Phase1RuntimeOwnership } from './phase1-runtime-ownership'

describe('Phase1RuntimeOwnership', () => {
  it('rejects a stale asynchronous diagnostic after StrictMode replaces its effect', () => {
    const ownership = new Phase1RuntimeOwnership()
    const first = ownership.acquire()
    ownership.release(first)
    const replacement = ownership.acquire()
    const published: number[] = []
    const publishIfOwned = (generation: typeof first) => {
      if (ownership.owns(generation)) published.push(generation.generation)
    }

    publishIfOwned(first)
    publishIfOwned(replacement)

    expect(published).toEqual([replacement.generation])
  })
})
