/**
 * Making a borrowed animation clip safe to play on a different skeleton.
 *
 * The player mesh and the player's locomotion come from two different files:
 * `player.glb` is a Sketchfab character, `player-clips.glb` is Quaternius
 * motion retargeted onto his skeleton by `scripts/retarget/bake-retarget.py`.
 * Borrowing clips like that is the whole point of retargeting, and it has one
 * sharp edge.
 *
 * A glTF skeleton hangs off a scene node that is not a bone — Sketchfab's
 * exporter calls it `_rootJoint`. Blender's exporter, converting its Z-up
 * world to glTF's Y-up, can express that conversion as a -90 degree rotation
 * *animated on that node* rather than baked into the rest pose. Play the clip
 * on the skeleton it shipped with and nothing is wrong. Play it on another
 * instance whose holder sits at identity and the entire character rotates
 * face-down.
 *
 * That is exactly what happened: the player lay flat on the road. Measured in
 * the shipped clips, `_rootJoint` carried three channels per clip — translation
 * constant at (0,0,0), scale constant at (1,1,1), and rotation constant at
 * -90 degrees about X. Only the rotation did anything, and what it did was the
 * bug.
 *
 * The asset is fixed at source by `scripts/retarget/strip-root-holder-channels.mjs`.
 * This is the guard that stops a future re-bake putting it back silently: a
 * borrowed clip has no business moving the node that merely *holds* the
 * skeleton, whatever that node claims.
 */
import type { AnimationClip, KeyframeTrack } from 'three'

/**
 * Nodes that hold a skeleton rather than belonging to one.
 *
 * Matched against the track name's node part, which three writes as
 * `<node>.<property>` — so `_rootJoint.quaternion`.
 */
export const HOLDER_NODES = ['_rootJoint', 'Armature', 'Sketchfab_model']

/** The node a track drives, from three's `node.property` track naming. */
export function trackNode(trackName: string): string {
  const dot = trackName.lastIndexOf('.')
  return dot < 0 ? trackName : trackName.slice(0, dot)
}

export function isHolderTrack(trackName: string, holders = HOLDER_NODES): boolean {
  return holders.includes(trackNode(trackName))
}

export interface HygieneReport {
  /** Track names that were dropped. */
  dropped: string[]
}

/**
 * Drop holder-node tracks from a clip, in place, and report what went.
 *
 * In place rather than cloning: three's loader hands out one clip object per
 * animation and the mixer keys actions off it, so a clone would leave the
 * original in play alongside. The clip is ours — it came from a file loaded
 * for this purpose — and mutating it once at load is cheaper and less
 * surprising than maintaining a parallel set.
 */
export function stripHolderTracks(
  clip: AnimationClip,
  holders = HOLDER_NODES,
): HygieneReport {
  const dropped: string[] = []
  const kept: KeyframeTrack[] = []
  for (const track of clip.tracks) {
    if (isHolderTrack(track.name, holders)) dropped.push(track.name)
    else kept.push(track)
  }
  if (dropped.length) clip.tracks = kept
  return { dropped }
}

/** Apply {@link stripHolderTracks} across a set of clips. */
export function sanitizeClips(
  clips: readonly AnimationClip[],
  holders = HOLDER_NODES,
): { clips: AnimationClip[]; dropped: string[] } {
  const dropped: string[] = []
  for (const clip of clips) {
    dropped.push(...stripHolderTracks(clip, holders).dropped)
  }
  return { clips: [...clips], dropped }
}
