/**
 * Register a system with the simulation authority for the life of a component.
 *
 * The React half of `simulation.ts`. Replaces a bare `useFrame` whose place in
 * the frame was decided by a render priority in one file and JSX mount order in
 * another:
 *
 *     useFrame((_, rawDt) => { ... })                  // order: whatever
 *     useSimulationStage('day-cycle', 'clock', (f) => { ... })   // order: declared
 *
 * The callback is held in a ref and the registration is made once, so a system
 * that closes over changing props does not re-register every render — a
 * re-register is cheap but it moves the system to the end of its stage, which
 * would make the order depend on render timing again, i.e. exactly the problem
 * this replaces.
 */
import { useEffect, useRef } from 'react'

import { simulation, type SimFrame, type SimStage } from './simulation'

export function useSimulationStage(id: string, stage: SimStage, step: (frame: SimFrame) => void) {
  const latest = useRef(step)
  latest.current = step

  useEffect(() => {
    return simulation.register(id, stage, (frame) => latest.current(frame))
  }, [id, stage])
}
