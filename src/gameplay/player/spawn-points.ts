/**
 * Where a fresh game starts, and which way the player faces.
 *
 * The old spawn (x=1000 z=-3000) sat in a courtyard between buildings, so the
 * first thing a player saw was a wall. These are sidewalk points measured off
 * the LION street graph and the sidewalk-validated walk graph
 * (`public/models/manhattan/streets/`), each facing down an avenue with the
 * traffic and the crowd in view. World axes: x east, z south (z = -y_m).
 *
 * Renderer-free so the list and the facing lookup are unit tested.
 */

export interface SpawnPoint {
  id: string
  label: string
  x: number
  z: number
  /** Unit horizontal facing, world space. */
  facing: { x: number; z: number }
}

/** Uptown along the Manhattan grid (the avenues run ~29° east of north). */
const UPTOWN = { x: 0.477, z: -0.879 }
const DOWNTOWN = { x: -UPTOWN.x, z: -UPTOWN.z }

/**
 * In order of preference. The first that resolves to open ground (not water,
 * not inside a building) wins.
 */
export const STREET_SPAWNS: readonly SpawnPoint[] = [
  {
    // East sidewalk of Fifth Avenue between 48th and 49th, looking downtown:
    // four lanes of southbound traffic running away up the frame, Midtown's
    // towers either side. 11.5 m east of the centreline, mid-pavement: a
    // ground probe across the avenue here reads road (12.05) out to 7 m and
    // pavement (12.20) from 9 m to 14 m.
    id: 'fifth-avenue',
    label: '5th Ave & 48th St',
    x: -824.1,
    z: 2481.2,
    facing: DOWNTOWN,
  },
  {
    // Seventh Avenue between 46th and 47th, the Duffy Square side of the
    // Times Square bowtie, looking downtown.
    id: 'times-square',
    label: '7th Ave & 46th St',
    x: -1429.8,
    z: 2327.9,
    facing: DOWNTOWN,
  },
  {
    // East sidewalk of Madison Avenue between 45th and 46th, looking uptown
    // with the northbound traffic.
    id: 'madison-avenue',
    label: 'Madison Ave & 45th St',
    x: -803.1,
    z: 2764.3,
    facing: UPTOWN,
  },
]

/** How close to a spawn point still counts as "standing on it". */
const ON_SPAWN_RADIUS = 2.5

/**
 * The facing that belongs to the spawn point at (x, z), or null when the
 * player is not standing on one (a restored save, a dev teleport).
 */
export function spawnFacingAt(
  x: number,
  z: number,
  spawns: readonly Pick<SpawnPoint, 'x' | 'z' | 'facing'>[] = STREET_SPAWNS,
): { x: number; z: number } | null {
  for (const spawn of spawns) {
    if (Math.hypot(spawn.x - x, spawn.z - z) <= ON_SPAWN_RADIUS) return { ...spawn.facing }
  }
  return null
}
