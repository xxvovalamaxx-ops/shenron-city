/**
 * The GLB writer, checked against the parts of the specification that fail
 * quietly.
 *
 * Alignment is the whole risk here. A file with a misaligned accessor or a
 * chunk length that is not a multiple of four loads fine in some parsers and
 * throws in others, so "it opened in the viewer I tried" proves very little.
 * These assert the rules directly.
 */
import { describe, expect, it } from 'vitest'

import { buildGlb } from './glb-write.mjs'

/** Parse a GLB buffer back into its chunks, the way a strict loader would. */
function parse(buffer) {
  expect(buffer.toString('ascii', 0, 4)).toBe('glTF')
  expect(buffer.readUInt32LE(4)).toBe(2)
  expect(buffer.readUInt32LE(8)).toBe(buffer.length)

  const jsonLength = buffer.readUInt32LE(12)
  expect(buffer.readUInt32LE(16)).toBe(0x4e4f534a)
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength))

  const binHeader = 20 + jsonLength
  const binLength = buffer.readUInt32LE(binHeader)
  expect(buffer.readUInt32LE(binHeader + 4)).toBe(0x004e4942)
  const bin = buffer.subarray(binHeader + 8, binHeader + 8 + binLength)
  return { json, bin, jsonLength, binLength }
}

/** A quad: four vertices, two triangles. */
function quad(material) {
  return {
    name: 'QUAD',
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
    material,
  }
}

describe('the container', () => {
  it('writes a header a strict loader accepts', () => {
    const { json } = parse(buildGlb({ meshes: [quad()] }))
    expect(json.asset.version).toBe('2.0')
    expect(json.scenes[0].nodes).toEqual([0])
  })

  it('pads both chunks to a multiple of four', () => {
    // A name chosen to make the JSON an awkward length; without padding this
    // is the file that loads in three.js and throws in a validator.
    const { jsonLength, binLength } = parse(
      buildGlb({ meshes: [{ ...quad(), name: 'ODD_LENGTH_NAME_X' }] }),
    )
    expect(jsonLength % 4).toBe(0)
    expect(binLength % 4).toBe(0)
  })

  it('declares a buffer length that matches the binary chunk', () => {
    const { json, binLength } = parse(buildGlb({ meshes: [quad()] }))
    expect(json.buffers[0].byteLength).toBe(binLength)
  })

  it('aligns every accessor to its component size', () => {
    // Two meshes so the second one's views start after an odd-sized first.
    const { json } = parse(
      buildGlb({ meshes: [quad(), { ...quad(), name: 'SECOND' }] }),
    )
    const size = { 5126: 4, 5125: 4, 5123: 2 }
    for (const accessor of json.accessors) {
      const view = json.bufferViews[accessor.bufferView]
      expect(view.byteOffset % size[accessor.componentType]).toBe(0)
    }
  })
})

describe('geometry', () => {
  it('round-trips positions exactly', () => {
    const { json, bin } = parse(buildGlb({ meshes: [quad()] }))
    const accessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION]
    const view = json.bufferViews[accessor.bufferView]
    const floats = new Float32Array(
      bin.buffer.slice(
        bin.byteOffset + view.byteOffset,
        bin.byteOffset + view.byteOffset + view.byteLength,
      ),
    )
    expect([...floats]).toEqual(quad().positions)
  })

  it('gives POSITION a min and max, which is required and is how bounds work', () => {
    // Without these some viewers compute an empty bounding box and frame
    // nothing.
    const { json } = parse(buildGlb({ meshes: [quad()] }))
    const accessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION]
    expect(accessor.min).toEqual([0, 0, 0])
    expect(accessor.max).toEqual([1, 1, 0])
  })

  it('uses 16-bit indices for a small mesh', () => {
    const { json } = parse(buildGlb({ meshes: [quad()] }))
    const indices = json.accessors[json.meshes[0].primitives[0].indices]
    expect(indices.componentType).toBe(5123)
  })

  it('uses 32-bit indices once the vertex count needs them', () => {
    const n = 70000
    const positions = new Array(n * 3).fill(0)
    const indices = [0, 1, 2]
    const { json } = parse(buildGlb({ meshes: [{ name: 'BIG', positions, indices }] }))
    expect(json.accessors[json.meshes[0].primitives[0].indices].componentType).toBe(5125)
  })

  it('writes a mesh with no normals rather than inventing them', () => {
    const { json } = parse(
      buildGlb({ meshes: [{ name: 'FLAT', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }] }),
    )
    expect(json.meshes[0].primitives[0].attributes.NORMAL).toBeUndefined()
  })

  it('marks vertex and index buffers with their targets', () => {
    const { json } = parse(buildGlb({ meshes: [quad()] }))
    const p = json.meshes[0].primitives[0]
    expect(json.bufferViews[json.accessors[p.attributes.POSITION].bufferView].target).toBe(34962)
    expect(json.bufferViews[json.accessors[p.indices].bufferView].target).toBe(34963)
  })
})

describe('materials', () => {
  it('writes a PBR material and binds it to the primitive', () => {
    const { json } = parse(
      buildGlb({
        meshes: [quad(0)],
        materials: [{ name: 'PAINT', baseColor: [0.1, 0.2, 0.3, 1], metallic: 0.9, roughness: 0.3 }],
      }),
    )
    expect(json.materials[0].name).toBe('PAINT')
    expect(json.materials[0].pbrMetallicRoughness.metallicFactor).toBe(0.9)
    expect(json.meshes[0].primitives[0].material).toBe(0)
  })

  it('writes an emissive factor when one is given', () => {
    const { json } = parse(
      buildGlb({ meshes: [quad(0)], materials: [{ name: 'LAMP', emissive: [1, 0.9, 0.7] }] }),
    )
    expect(json.materials[0].emissiveFactor).toEqual([1, 0.9, 0.7])
  })

  it('omits the materials array entirely when there are none', () => {
    // An empty `materials: []` is invalid glTF — arrays must have at least one
    // element or be absent.
    const { json } = parse(buildGlb({ meshes: [quad()] }))
    expect(json.materials).toBeUndefined()
  })
})

describe('the node hierarchy', () => {
  it('defaults to one root node per mesh', () => {
    const { json } = parse(buildGlb({ meshes: [quad(), { ...quad(), name: 'B' }] }))
    expect(json.nodes).toHaveLength(2)
    expect(json.scenes[0].nodes).toEqual([0, 1])
  })

  it('puts only true roots in the scene when nodes are given', () => {
    // A child listed as a scene root is drawn twice, at two different
    // transforms — a duplicate that looks like a modelling mistake.
    const { json } = parse(
      buildGlb({
        meshes: [quad()],
        nodes: [
          { name: 'ROOT', children: [1] },
          { name: 'CHILD', mesh: 0, translation: [1, 2, 3] },
        ],
      }),
    )
    expect(json.scenes[0].nodes).toEqual([0])
    expect(json.nodes[1].translation).toEqual([1, 2, 3])
  })
})
