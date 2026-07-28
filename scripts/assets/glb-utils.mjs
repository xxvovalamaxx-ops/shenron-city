import { readFileSync } from 'node:fs'

export function readGlb(path) {
  const file = readFileSync(path)
  if (file.length < 20 || file.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error(`${path}: invalid GLB magic`)
  }
  if (file.readUInt32LE(4) !== 2 || file.readUInt32LE(8) !== file.length) {
    throw new Error(`${path}: invalid GLB header`)
  }

  let document
  let offset = 12
  while (offset < file.length) {
    const length = file.readUInt32LE(offset)
    const type = file.readUInt32LE(offset + 4)
    const chunk = file.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) {
      document = JSON.parse(chunk.toString('utf8').replace(/\0+$/, '').trimEnd())
      break
    }
    offset += 8 + length
  }
  if (!document) throw new Error(`${path}: missing JSON chunk`)
  return { file, document }
}

export function glbMetrics(document) {
  let triangles = 0
  let primitives = 0
  let missingMaterials = 0
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      primitives += 1
      if (primitive.material === undefined) missingMaterials += 1
      const count = primitive.indices === undefined
        ? document.accessors?.[primitive.attributes?.POSITION]?.count
        : document.accessors?.[primitive.indices]?.count
      if (typeof count === 'number') triangles += Math.floor(count / 3)
    }
  }

  const meshNodes = (document.nodes ?? []).filter((node) => node.mesh !== undefined)
  const missingAssetIds = meshNodes
    .filter((node) => !(node.extras?.asset_id ?? node.extras?.assetId))
    .map((node) => node.name ?? '<unnamed>')

  return {
    animations: document.animations?.length ?? 0,
    images: document.images?.length ?? 0,
    materials: document.materials?.length ?? 0,
    meshes: document.meshes?.length ?? 0,
    missingAssetIds,
    missingMaterials,
    nodes: document.nodes?.length ?? 0,
    primitives,
    textures: document.textures?.length ?? 0,
    triangles,
  }
}
