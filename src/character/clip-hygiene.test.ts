import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  HOLDER_NODES,
  isHolderTrack,
  sanitizeClips,
  stripHolderTracks,
  trackNode,
} from './clip-hygiene'

/** A clip shaped like the retargeted locomotion: bones plus a holder node. */
function locomotionClip(name = 'Walk_Loop') {
  return new THREE.AnimationClip(name, 1, [
    // The exact channel that laid the player face-down: a constant -90 degree
    // X rotation on the node that holds the skeleton.
    new THREE.QuaternionKeyframeTrack(
      '_rootJoint.quaternion',
      [0, 1],
      [-0.7071, 0, 0, 0.7071, -0.7071, 0, 0, 0.7071],
    ),
    new THREE.VectorKeyframeTrack('_rootJoint.position', [0, 1], [0, 0, 0, 0, 0, 0]),
    new THREE.VectorKeyframeTrack('_rootJoint.scale', [0, 1], [1, 1, 1, 1, 1, 1]),
    new THREE.QuaternionKeyframeTrack('hip_02.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    new THREE.VectorKeyframeTrack('root_01.position', [0, 1], [0, 0, 0, 0, 0.1, 0]),
  ])
}

describe('trackNode', () => {
  it('splits three\'s node.property track naming', () => {
    expect(trackNode('_rootJoint.quaternion')).toBe('_rootJoint')
    expect(trackNode('hip_02.position')).toBe('hip_02')
  })

  it('keeps a dotted bone name intact — only the last dot separates', () => {
    expect(trackNode('rig.spine.02.quaternion')).toBe('rig.spine.02')
  })

  it('survives a name with no property', () => {
    expect(trackNode('bare')).toBe('bare')
  })
})

describe('isHolderTrack', () => {
  it('matches the holder nodes and not bones', () => {
    expect(isHolderTrack('_rootJoint.quaternion')).toBe(true)
    expect(isHolderTrack('Armature.position')).toBe(true)
    expect(isHolderTrack('hip_02.quaternion')).toBe(false)
    // A bone whose name merely contains a holder name is a bone.
    expect(isHolderTrack('_rootJoint_extra.quaternion')).toBe(false)
  })
})

describe('stripHolderTracks', () => {
  it('drops every holder track and keeps every bone track', () => {
    const clip = locomotionClip()
    expect(clip.tracks).toHaveLength(5)
    const { dropped } = stripHolderTracks(clip)
    expect(dropped).toEqual([
      '_rootJoint.quaternion',
      '_rootJoint.position',
      '_rootJoint.scale',
    ])
    expect(clip.tracks.map((t) => t.name)).toEqual([
      'hip_02.quaternion',
      'root_01.position',
    ])
  })

  it('removes the rotation that laid the character face-down', () => {
    // The defect stated as the thing it did. -0.7071 on x is -90 degrees about
    // X; applied to the node holding the skeleton, the whole character rotates
    // with it, and the mesh's own holder sits at identity so nothing cancels it.
    const clip = locomotionClip()
    const holder = clip.tracks.find((t) => t.name === '_rootJoint.quaternion')!
    expect(holder.values[0]).toBeCloseTo(-0.7071, 4)
    stripHolderTracks(clip)
    expect(clip.tracks.some((t) => t.name.startsWith('_rootJoint'))).toBe(false)
  })

  it('leaves a clean clip untouched, and does not reallocate its tracks', () => {
    const clip = new THREE.AnimationClip('Idle_Loop', 1, [
      new THREE.QuaternionKeyframeTrack('hip_02.quaternion', [0], [0, 0, 0, 1]),
    ])
    const before = clip.tracks
    const { dropped } = stripHolderTracks(clip)
    expect(dropped).toEqual([])
    expect(clip.tracks).toBe(before)
  })

  it('is idempotent', () => {
    const clip = locomotionClip()
    stripHolderTracks(clip)
    const after = clip.tracks.length
    expect(stripHolderTracks(clip).dropped).toEqual([])
    expect(clip.tracks).toHaveLength(after)
  })

  it('honours a custom holder list', () => {
    const clip = locomotionClip()
    const { dropped } = stripHolderTracks(clip, ['hip_02'])
    expect(dropped).toEqual(['hip_02.quaternion'])
    expect(clip.tracks.some((t) => t.name.startsWith('_rootJoint'))).toBe(true)
  })
})

describe('sanitizeClips', () => {
  it('cleans every clip and reports the total', () => {
    // Seven clips is what the retarget bake ships.
    const clips = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop'].map(locomotionClip)
    const { dropped } = sanitizeClips(clips)
    expect(dropped).toHaveLength(9)
    for (const clip of clips) {
      expect(clip.tracks.every((t) => !t.name.startsWith('_rootJoint'))).toBe(true)
      expect(clip.tracks).toHaveLength(2)
    }
  })

  it('reports nothing for clips that were already clean', () => {
    const clips = [
      new THREE.AnimationClip('A', 1, [
        new THREE.QuaternionKeyframeTrack('hip_02.quaternion', [0], [0, 0, 0, 1]),
      ]),
    ]
    expect(sanitizeClips(clips).dropped).toEqual([])
  })

  it('holds the holder list the pipeline script uses', () => {
    // Both sides must agree, or the asset is stripped of one set and the
    // runtime guards a different one.
    expect(HOLDER_NODES).toContain('_rootJoint')
    expect(HOLDER_NODES).toContain('Armature')
    expect(HOLDER_NODES).toContain('Sketchfab_model')
  })
})
