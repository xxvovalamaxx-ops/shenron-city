/**
 * Acceptance for the shipped locomotion clips.
 *
 * Not a unit test of the retarget arithmetic — that is retarget-math.test.mjs.
 * This opens the actual file the game loads and asks whether the character it
 * describes is a person: head above feet, hands below the head, feet under the
 * hips, and something moving over time.
 *
 * It exists because "looks right" was checked by eye for Idle only, and the
 * previous two rounds of this bug shipped a character who was face-down and
 * then contorted, both times past a green test suite.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseGlb } from './strip-root-holder-channels.mjs'
import { poseAt, clipDuration } from './clip-pose.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const CLIPS = join(REPO, 'public', 'models', 'characters', 'player', 'player-clips.glb')

const { json, bin } = parseGlb(readFileSync(CLIPS))

/** Bone names vary by rig; find them the way the runtime probe does. */
const NAMES = (json.nodes ?? []).map((n) => n.name ?? '')
const find = (re) => NAMES.find((n) => re.test(n)) || ''
const HEAD = find(/^head_/i)
const FOOT_L = find(/^foot_l_/i)
const FOOT_R = find(/^foot_r_/i)
const HAND_L = find(/^hand_l_/i)
const HAND_R = find(/^hand_r_/i)
const HIP = find(/^hip_/i)

const CLIP_NAMES = (json.animations ?? []).map((a) => a.name)

/** Six evenly spaced samples across a clip, avoiding the exact endpoints. */
function samples(clip) {
  const duration = clipDuration(json, bin, clip) || 1
  return Array.from({ length: 6 }, (_, i) => ((i + 0.5) / 6) * duration)
}

describe('the clips file itself', () => {
  it('carries the seven locomotion clips the runtime asks for', () => {
    expect(CLIP_NAMES).toEqual([
      'Idle_Loop',
      'Walk_Loop',
      'Jog_Fwd_Loop',
      'Sprint_Loop',
      'Jump_Start',
      'Jump_Loop',
      'Jump_Land',
    ])
  })

  it('found every bone these assertions depend on', () => {
    // A silently missing bone would turn every check below into a pass.
    for (const [label, name] of [
      ['head', HEAD],
      ['left foot', FOOT_L],
      ['right foot', FOOT_R],
      ['left hand', HAND_L],
      ['right hand', HAND_R],
      ['hip', HIP],
    ]) {
      expect(name, `${label} bone not found in the rig`).not.toBe('')
    }
  })

  it('animates on more than two keyframes', () => {
    // The exact shape of the old bug: every clip collapsed to a start and an
    // end key, which is a static pose the exporter could not tell from an
    // animation.
    for (const clip of CLIP_NAMES) {
      const animation = json.animations.find((a) => a.name === clip)
      const counts = animation.samplers.map((s) => json.accessors[s.input].count)
      expect(Math.max(...counts), `${clip} has no real keyframes`).toBeGreaterThan(2)
    }
  })
})

describe.each(CLIP_NAMES)('%s', (clip) => {
  const poses = samples(clip).map((t) => poseAt(json, bin, clip, t))

  it('stands: the head is well above the feet', () => {
    for (const [i, pose] of poses.entries()) {
      const head = pose.get(HEAD)
      const foot = pose.get(FOOT_L)
      const up = head.y - foot.y
      // A 1.8 m character measured at the bind scale of this rig. Generous
      // bounds: this is catching "face-down" and "upside down", not posture.
      expect(up, `${clip} sample ${i}: head only ${up.toFixed(3)} above the foot`).toBeGreaterThan(0.6)
    }
  })

  it('is upright: the head sits close to over the feet, not sprawled away', () => {
    for (const [i, pose] of poses.entries()) {
      const head = pose.get(HEAD)
      const foot = pose.get(FOOT_L)
      const span = Math.hypot(head.x - foot.x, head.z - foot.z)
      const up = head.y - foot.y
      // Lying down reads as a large horizontal span and a small vertical one.
      expect(span, `${clip} sample ${i}: horizontal span ${span.toFixed(3)}`).toBeLessThan(up)
    }
  })

  it('keeps the feet below the hips', () => {
    for (const [i, pose] of poses.entries()) {
      const hip = pose.get(HIP)
      for (const foot of [FOOT_L, FOOT_R]) {
        const f = pose.get(foot)
        expect(hip.y, `${clip} sample ${i}: ${foot} is above the hip`).toBeGreaterThan(f.y)
      }
    }
  })

  it('keeps the hands below the head', () => {
    // The contorted pose put one arm straight up. Jump clips swing the arms
    // but not above the crown in these source clips.
    for (const [i, pose] of poses.entries()) {
      const head = pose.get(HEAD)
      for (const hand of [HAND_L, HAND_R]) {
        const h = pose.get(hand)
        expect(head.y, `${clip} sample ${i}: ${hand} is above the head`).toBeGreaterThan(h.y)
      }
    }
  })

  it('actually moves over its own length', () => {
    // A static pose passes every check above. This is the one that fails on it.
    let travel = 0
    for (let i = 1; i < poses.length; i++) {
      for (const bone of [HAND_L, FOOT_L, HEAD]) {
        const a = poses[i - 1].get(bone)
        const b = poses[i].get(bone)
        travel += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
      }
    }
    expect(travel, `${clip} is static across its whole length`).toBeGreaterThan(0.01)
  })
})

describe('the walking clips move the legs more than the idle does', () => {
  it('ranks stride by clip, idle lowest', () => {
    // A cheap sanity check that the clips are not all the same animation:
    // walking swings a foot further than standing still does.
    const stride = (clip) => {
      const poses = samples(clip).map((t) => poseAt(json, bin, clip, t))
      let travel = 0
      for (let i = 1; i < poses.length; i++) {
        const a = poses[i - 1].get(FOOT_L)
        const b = poses[i].get(FOOT_L)
        travel += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
      }
      return travel
    }
    const idle = stride('Idle_Loop')
    for (const clip of ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop']) {
      expect(stride(clip), `${clip} moves the foot no more than the idle`).toBeGreaterThan(idle)
    }
  })
})
