/**
 * Writing a GLB from generated geometry.
 *
 * Stage 2 needs authored assets and this repo has no writer — `glb-utils.mjs`
 * reads, `@gltf-transform` is not a dependency (and the CI guard exists
 * specifically to keep it out of production deps). So the container is built
 * here: a small, exact glTF 2.0 binary writer covering what authored props and
 * vehicles actually use — positions, normals, indices, a PBR material per
 * primitive, and a node hierarchy.
 *
 * Deliberately narrow. No skins, no animations, no textures, no Draco. Each of
 * those is a real chunk of specification, and a half-implemented one that
 * writes a file some loaders accept is worse than not having it: the failure
 * surfaces as a mesh that renders wrong in one browser.
 *
 * Alignment is the part that is easy to get subtly wrong. glTF requires each
 * chunk's length to be a multiple of four, the JSON chunk padded with spaces
 * and the BIN chunk with zeros, and every accessor's byteOffset to be a
 * multiple of its component size. A file that violates any of those loads fine
 * in some parsers and throws in others, which is the worst kind of bug to own.
 */

const MAGIC = 0x46546c67 // 'glTF'
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

const FLOAT = 5126
const UNSIGNED_INT = 5125
const UNSIGNED_SHORT = 5123

/** Byte alignment for a component type. */
function componentSize(componentType) {
  if (componentType === FLOAT || componentType === UNSIGNED_INT) return 4
  if (componentType === UNSIGNED_SHORT) return 2
  throw new Error(`unsupported componentType ${componentType}`)
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

/**
 * Accumulates typed arrays into one buffer, keeping each accessor aligned.
 */
class BufferBuilder {
  constructor() {
    this.parts = []
    this.length = 0
    this.bufferViews = []
    this.accessors = []
  }

  /** Pad to `align` bytes so the next view starts on a legal boundary. */
  _align(align) {
    const over = this.length % align
    if (over === 0) return
    const pad = Buffer.alloc(align - over)
    this.parts.push(pad)
    this.length += pad.length
  }

  /**
   * Add one accessor, returning its index.
   *
   * `min`/`max` are required by the specification for POSITION and are how a
   * loader computes bounds without walking the vertices. Omitting them is
   * legal for other accessors and produces a file whose bounding box some
   * viewers compute as empty.
   */
  add(array, componentType, type, { target, minMax = false } = {}) {
    const size = componentSize(componentType)
    this._align(size)
    const byteOffset = this.length
    const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
    this.parts.push(buffer)
    this.length += buffer.length

    const view = { buffer: 0, byteOffset, byteLength: buffer.length }
    if (target !== undefined) view.target = target
    this.bufferViews.push(view)

    const count = array.length / COMPONENTS[type]
    const accessor = {
      bufferView: this.bufferViews.length - 1,
      componentType,
      count,
      type,
    }
    if (minMax) {
      const n = COMPONENTS[type]
      const min = new Array(n).fill(Infinity)
      const max = new Array(n).fill(-Infinity)
      for (let i = 0; i < array.length; i++) {
        const c = i % n
        if (array[i] < min[c]) min[c] = array[i]
        if (array[i] > max[c]) max[c] = array[i]
      }
      accessor.min = min
      accessor.max = max
    }
    this.accessors.push(accessor)
    return this.accessors.length - 1
  }

  finish() {
    // The BIN chunk itself must be a multiple of four.
    this._align(4)
    return Buffer.concat(this.parts, this.length)
  }
}

/**
 * Build a GLB.
 *
 * `meshes` is `[{ name, positions, normals, indices, material }]` with plain
 * arrays or typed arrays; `materials` is `[{ name, baseColor: [r,g,b,a],
 * metallic, roughness, emissive: [r,g,b], emissiveStrength }]`.
 *
 * `nodes` is optional `[{ name, mesh, translation, rotation, scale, children }]`.
 * Without it every mesh becomes a node of the same name at the origin, which
 * is what a single-object export looks like.
 */
export function buildGlb({ meshes, materials = [], nodes = null, generator = 'shenron-city' }) {
  const bin = new BufferBuilder()
  const gltfMeshes = []

  for (const mesh of meshes) {
    const positions = Float32Array.from(mesh.positions)
    const position = bin.add(positions, FLOAT, 'VEC3', { target: 34962, minMax: true })
    const attributes = { POSITION: position }

    if (mesh.normals) {
      const normals = Float32Array.from(mesh.normals)
      attributes.NORMAL = bin.add(normals, FLOAT, 'VEC3', { target: 34962 })
    }

    const primitive = { attributes, mode: 4 }
    if (mesh.indices) {
      // 16-bit where it fits: a 4,000-vertex car does not need 32-bit indices,
      // and the file is meaningfully smaller for it.
      const vertexCount = positions.length / 3
      const array =
        vertexCount <= 65535 ? Uint16Array.from(mesh.indices) : Uint32Array.from(mesh.indices)
      const componentType = vertexCount <= 65535 ? UNSIGNED_SHORT : UNSIGNED_INT
      primitive.indices = bin.add(array, componentType, 'SCALAR', { target: 34963 })
    }
    if (mesh.material !== undefined) primitive.material = mesh.material

    gltfMeshes.push({ name: mesh.name, primitives: [primitive] })
  }

  const gltfMaterials = materials.map((m) => {
    const out = {
      name: m.name,
      pbrMetallicRoughness: {
        baseColorFactor: m.baseColor ?? [0.8, 0.8, 0.8, 1],
        metallicFactor: m.metallic ?? 0,
        roughnessFactor: m.roughness ?? 0.8,
      },
      doubleSided: m.doubleSided ?? false,
    }
    if (m.emissive) out.emissiveFactor = m.emissive
    if (m.alphaMode) out.alphaMode = m.alphaMode
    return out
  })

  const gltfNodes =
    nodes ??
    gltfMeshes.map((m, i) => ({ name: m.name, mesh: i }))

  const json = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ nodes: gltfNodes.map((_, i) => i).filter((i) => !isChild(gltfNodes, i)) }],
    nodes: gltfNodes,
    meshes: gltfMeshes,
    accessors: bin.accessors,
    bufferViews: bin.bufferViews,
    buffers: [{ byteLength: 0 }],
  }
  if (gltfMaterials.length) json.materials = gltfMaterials

  const binary = bin.finish()
  json.buffers[0].byteLength = binary.length

  // JSON chunk padded with spaces, BIN with zeros — both required to be a
  // multiple of four, and the pad byte is specified per chunk type.
  let jsonText = JSON.stringify(json)
  while (jsonText.length % 4 !== 0) jsonText += ' '
  const jsonBuffer = Buffer.from(jsonText, 'utf8')

  const total = 12 + 8 + jsonBuffer.length + 8 + binary.length
  const out = Buffer.alloc(total)
  out.writeUInt32LE(MAGIC, 0)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonBuffer.length, 12)
  out.writeUInt32LE(JSON_CHUNK, 16)
  jsonBuffer.copy(out, 20)
  const binHeader = 20 + jsonBuffer.length
  out.writeUInt32LE(binary.length, binHeader)
  out.writeUInt32LE(BIN_CHUNK, binHeader + 4)
  binary.copy(out, binHeader + 8)
  return out
}

/** Whether a node is referenced as someone's child. */
function isChild(nodes, index) {
  return nodes.some((n) => Array.isArray(n.children) && n.children.includes(index))
}
