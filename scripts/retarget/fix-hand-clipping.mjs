#!/usr/bin/env node
/**
 * Fix hand clipping by patching upper arm rotation channels directly in the GLB binary.
 * No parseGlb/writeGlb — raw buffer manipulation to avoid any roundtrip corruption.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLIPS_PATH = join(ROOT, 'public/models/characters/player/player-clips.glb');

function qmul(a, b) {
  return [
    a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
    a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
    a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
    a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
  ];
}

function qFromAxisAngle(axis, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  const s = Math.sin(rad / 2);
  const len = Math.sqrt(axis[0]**2 + axis[1]**2 + axis[2]**2);
  return [axis[0]/len*s, axis[1]/len*s, axis[2]/len*s, Math.cos(rad/2)];
}

// Parse GLB
const raw = Buffer.from(readFileSync(CLIPS_PATH));
const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

if (raw.readUInt32LE(0) !== MAGIC) throw new Error('not GLB');
const total = raw.readUInt32LE(8);
let off = 12;
let jsonData, binStart = 0;
while (off < total) {
  const len = raw.readUInt32LE(off);
  const type = raw.readUInt32LE(off + 4);
  if (type === CHUNK_JSON) {
    jsonData = JSON.parse(raw.subarray(off + 8, off + 8 + len).toString('utf8'));
  } else if (type === CHUNK_BIN) {
    binStart = off + 8;
  }
  off += 8 + len;
}

const nodeNames = jsonData.nodes.map(n => n.name ?? '');

// Corrections: rotate upper arms outward to the sides
const BONE_CORRECTIONS = {
  'upperarm_l_024': qFromAxisAngle([0, 0, 1], 45),
  'upperarm_r_049': qFromAxisAngle([0, 0, 1], -45),
};

const corrections = {};
for (const [boneName, correction] of Object.entries(BONE_CORRECTIONS)) {
  const idx = nodeNames.indexOf(boneName);
  if (idx === -1) { console.warn(`Bone ${boneName} not found`); continue; }
  corrections[idx] = correction;
}

let channelsFixed = 0, keyframesFixed = 0;

for (const anim of jsonData.animations) {
  for (const ch of anim.channels) {
    if (ch.target.path !== 'rotation') continue;
    const nodeIdx = ch.target.node;
    if (!(nodeIdx in corrections)) continue;

    const correction = corrections[nodeIdx];
    const sampler = anim.samplers[ch.sampler];
    const outAcc = jsonData.accessors[sampler.output];
    const outView = jsonData.bufferViews[outAcc.bufferView];
    const outByteOffset = binStart + (outView.byteOffset ?? 0) + (outAcc.byteOffset ?? 0);
    const numKeys = outAcc.count;

    for (let i = 0; i < numKeys; i++) {
      const kOff = outByteOffset + i * 16;
      const q = [
        raw.readFloatLE(kOff),
        raw.readFloatLE(kOff + 4),
        raw.readFloatLE(kOff + 8),
        raw.readFloatLE(kOff + 12),
      ];
      const fixed = qmul(correction, q);
      raw.writeFloatLE(fixed[0], kOff);
      raw.writeFloatLE(fixed[1], kOff + 4);
      raw.writeFloatLE(fixed[2], kOff + 8);
      raw.writeFloatLE(fixed[3], kOff + 12);
      keyframesFixed++;
    }
    channelsFixed++;
  }
}

writeFileSync(CLIPS_PATH, raw);
console.log(`Fixed ${channelsFixed} channels, ${keyframesFixed} keyframes → ${CLIPS_PATH}`);
