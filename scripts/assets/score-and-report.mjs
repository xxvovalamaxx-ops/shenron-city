import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKTREE = path.resolve(__dirname, "..", "..");
const REPORTS = path.join(WORKTREE, "staging", "assets", "reports");
const CANDIDATES = path.join(WORKTREE, "staging", "assets", "candidates.json");
const OUT_REGISTRY = path.join(WORKTREE, "docs", "assets", "ASSET_TECHNICAL_REGISTRY.json");
const OUT_SHORTLIST = path.join(WORKTREE, "docs", "assets", "ASSET_TECHNICAL_SHORTLIST.md");
const OUT_REPAIR = path.join(WORKTREE, "docs", "assets", "ASSET_REPAIR_QUEUE.md");

const manifest = JSON.parse(fs.readFileSync(CANDIDATES, "utf8"));
const reports = {};
for (const f of fs.readdirSync(REPORTS)) {
  if (!f.endsWith(".json")) continue;
  const r = JSON.parse(fs.readFileSync(path.join(REPORTS, f), "utf8"));
  reports[r.id] = r;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function expectedScale(cat, ext) {
  if (cat.startsWith("Characters")) return { min: 1.2, max: 2.6, note: "character 1.2-2.6m" };
  if (cat.startsWith("Vehicles")) return { min: 2.5, max: 9, note: "vehicle 2.5-9m" };
  if (cat.startsWith("Buildings")) return { min: 3, max: 200, note: "building 3-200m" };
  if (cat.includes("Interior") || cat.includes("Market") || cat.includes("Prototype") || cat.includes("Furniture")) return { min: 0.2, max: 4, note: "prop 0.2-4m" };
  if (cat.includes("Nature")) return { min: 0.2, max: 30, note: "nature 0.2-30m" };
  return { min: 0.05, max: 30, note: "prop/env 0.05-30m" };
}

function scoreGeometry(r) {
  let s = 20;
  if (!r.vertexCount) return 0;
  const nm = r.meshes?.reduce((a, m) => a + (m.nonManifoldEdges || 0), 0) || 0;
  s -= Math.min(6, nm / 100);
  const udp = r.meshes?.reduce((a, m) => a + (m.uvDegeneratePolys || 0), 0) || 0;
  if (udp > 2 && !String(r.pack || "").startsWith("kenney-")) s -= 2;
  if (r.meshes?.some((m) => !m.hasUV) && r.textureCount > 0) s -= 3;
  if (r.negativeScale) s -= 4;
  if (r.meshes?.some((m) => m.verts === 0)) s -= 2;
  if (r.meshes?.some((m) => !m.hasCustomNormals)) s -= 2;
  return clamp(Math.round(s), 0, 20);
}

function scoreMaterials(r) {
  let s = 20;
  if (r.status !== "OK") return 0;
  if (r.materialCount === 0) s -= 6;
  if (r.principledCount === 0 && r.materialCount > 0) s -= 4;
  if (r.missingTextureRefs?.length) s -= Math.min(8, r.missingTextureRefs.length * 2);
  if (r.textureCount === 0 && r.materialCount > 0) s -= 3;
  if (r.unsupportedNodeTypes?.length) s -= Math.min(4, r.unsupportedNodeTypes.length * 2);
  if (r.alphaModes?.length && !r.alphaModes.includes("OPAQUE")) s -= 1;
  return clamp(Math.round(s), 0, 20);
}

function scoreRigAnim(r, cat) {
  let s = 20;
  if (cat.startsWith("Characters")) {
    if (!r.armatureCount) s -= 8;
    if (r.armatureCount && !r.hasSkinWeights) s -= 4;
    if (r.actionCount === 0) s -= 4;
  } else {
    if (r.armatureCount || r.actionCount) {
      if (r.actionCount === 0) s -= 6;
      if (r.armatureCount && !r.hasSkinWeights) s -= 4;
    }
  }
  if (r.actionCount > 0 && r.maxAnimationDuration > 0 && r.maxAnimationDuration < 0.5) s -= 2;
  return clamp(Math.round(s), 0, 20);
}

function scoreOptimization(r, cat) {
  let s = 15;
  const tris = r.triangleCount || 0;
  if (tris > 10000) s -= 3;
  if (tris > 50000) s -= 3;
  if (tris > 100000) s -= 3;
  if (r.objectCount > 50) s -= 3;
  if (r.objectCount > 200) s -= 3;
  if (r.estimatedVRAMMB > 32) s -= 2;
  if (r.estimatedVRAMMB > 64) s -= 2;
  if (r.textureCount > 12) s -= 1;
  if (cat.startsWith("Vehicles") && tris > 40000) s -= 2;
  return clamp(Math.round(s), 0, 15);
}

function scoreScale(r, cat) {
  let s = 10;
  const dim = r.maxDimensionM;
  if (dim == null) return 5;
  const exp = expectedScale(cat);
  if (dim < exp.min * 0.5 || dim > exp.max * 2.5) s -= 4;
  else if (dim < exp.min * 0.7 || dim > exp.max * 1.8) s -= 2;
  const off = Math.max(...(r.pivotOffsetM || []).map(Math.abs));
  if (off > 1.5) s -= 3;
  else if (off > 0.5) s -= 1;
  return clamp(Math.round(s), 0, 10);
}

function scoreRuntime(r) {
  let s = 10;
  if (r.importSeconds > 10) s -= 2;
  if (r.importSeconds > 30) s -= 3;
  const warns = r.importWarnings?.length || 0;
  s -= Math.min(4, warns);
  if (r.missingTextureRefs?.length) s -= 2;
  if (r.textureCount > 0 && r.embeddedTextureCount === 0) s -= 1;
  return clamp(Math.round(s), 0, 10);
}

const entries = [];
for (const c of manifest.candidates) {
  const r = reports[c.id];
  const base = {
    id: c.id,
    pack: c.pack,
    packCategory: c.packCategory,
    license: c.license,
    relPath: c.relPath,
    ext: c.ext,
    bytes: c.bytes,
    status: r?.status || "NO_REPORT",
  };
  if (r && r.status === "OK") {
    const geo = scoreGeometry(r);
    const mat = scoreMaterials(r);
    const rig = scoreRigAnim(r, c.packCategory);
    const opt = scoreOptimization(r, c.packCategory);
    const scl = scoreScale(r, c.packCategory);
    const run = scoreRuntime(r);
    const meta = r.missingTextureRefs?.length ? 3 : 5;
    base.scores = { GEOMETRY: geo, MATERIALS: mat, RIG_ANIMATION: rig, OPTIMIZATION: opt, SCALE_PIVOT: scl, RUNTIME: run, METADATA: meta };
    base.total = geo + mat + rig + opt + scl + run + meta;
    base.metrics = {
      objectCount: r.objectCount,
      meshCount: r.meshCount,
      vertexCount: r.vertexCount,
      triangleCount: r.triangleCount,
      materialCount: r.materialCount,
      textureCount: r.textureCount,
      textureDims: r.textureDims?.slice(0, 12),
      estimatedVRAMMB: r.estimatedVRAMMB,
      maxDimensionM: r.maxDimensionM,
      boundsSize: r.boundsSize,
      pivotOffsetM: r.pivotOffsetM,
      hasUV: r.meshes?.some((m) => m.hasUV),
      uvDegeneratePolys: r.meshes?.reduce((a, m) => a + (m.uvDegeneratePolys || 0), 0),
      nonManifoldEdges: r.meshes?.reduce((a, m) => a + (m.nonManifoldEdges || 0), 0),
      negativeScale: r.negativeScale,
      armatureCount: r.armatureCount,
      boneCount: r.boneCount,
      hasSkinWeights: r.hasSkinWeights,
      actionCount: r.actionCount,
      animationDurations: r.animationDurations,
      hasRootMotion: r.hasRootMotion,
      shapeKeyCount: r.meshes?.reduce((a, m) => a + (m.shapeKeyCount || 0), 0),
      lodCount: r.lodCount,
      collisionCount: r.collisionCount,
      embeddedTextureCount: r.embeddedTextureCount,
      externalTextureCount: r.externalTextureCount,
      missingTextureRefs: r.missingTextureRefs,
      unsupportedNodeTypes: r.unsupportedNodeTypes,
      alphaModes: r.alphaModes,
      importSeconds: r.importSeconds,
      importWarnings: r.importWarnings,
    };
    base.flags = [];
    if ((base.metrics.uvDegeneratePolys || 0) > 2 && !String(base.pack || "").startsWith("kenney-")) base.flags.push("uv-overlap");
    if ((base.metrics.nonManifoldEdges || 0) > 200) base.flags.push("non-manifold");
    if (base.metrics.negativeScale) base.flags.push("negative-scale");
    if (base.metrics.missingTextureRefs?.length) base.flags.push("missing-textures");
    if (base.metrics.estimatedVRAMMB > 32) base.flags.push("high-vram");
    if (base.metrics.triangleCount > 50000) base.flags.push("heavy-mesh");
    if (base.metrics.pivotOffsetM && Math.max(...base.metrics.pivotOffsetM.map(Math.abs)) > 1.5) base.flags.push("off-center-pivot");
  } else if (r) {
    base.importError = r.importError || r.error || "";
    base.flags = ["import-failed"];
  }
  entries.push(base);
}

entries.sort((a, b) => (b.total || 0) - (a.total || 0));

fs.mkdirSync(path.dirname(OUT_REGISTRY), { recursive: true });
fs.writeFileSync(
  OUT_REGISTRY,
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scope: "Legally eligible 3D model files from PublicLibrary (204 registered packs). 468 sampled candidates.",
      scoring: { GEOMETRY: 20, MATERIALS: 20, RIG_ANIMATION: 20, OPTIMIZATION: 15, SCALE_PIVOT: 10, RUNTIME: 10, METADATA: 5, total: 100 },
      exclusions: ["Characters/Renderpeople (no legal record)", "Characters/Mixamo (policy-blocked)", "Characters/Sketchfab (no legal record)"],
      entries,
    },
    null,
    2
  )
);
console.log("registry:", entries.length, "entries, OK:", entries.filter((e) => e.status === "OK").length);

function mdTable(rows) {
  const w = rows.map((r) => r.map((x) => String(x).length));
  return rows
    .map((r, i) =>
      r
        .map((x, j) => String(x).padEnd(Math.max(...w.map((row) => row[j]))))
        .join(" | ")
    )
    .join("\n");
}

const ok = entries.filter((e) => e.status === "OK");
const byCat = {};
for (const e of ok) {
  const k = e.packCategory.split("/")[0];
  (byCat[k] ||= []).push(e);
}

const shortlist = [];
for (const [cat, list] of Object.entries(byCat)) {
  list.sort((a, b) => b.total - a.total);
  const top = list.slice(0, 5);
  const anchors = list.findIndex((e) => e.total >= 80);
  shortlist.push({ cat, top });
}

const md = [];
md.push("# ASSET TECHNICAL SHORTLIST");
md.push("");
md.push(`Generated ${new Date().toISOString().slice(0, 10)} — Blender 5.1 headless, ${ok.length} candidates imported OK of ${entries.length}.`);
md.push("");
md.push("Scores: GEOMETRY 0-20 | MATERIALS 0-20 | RIG/ANIMATION 0-20 | OPTIMIZATION 0-15 | SCALE/PIVOT 0-10 | RUNTIME 0-10 | METADATA 0-5 (total 0-100).");
md.push("");
md.push("## Flagship picks (recommended per gameplay role)");
md.push("");
const flagships = [
  ["Pedestrian rig (CC0)", (e) => e.id.includes("characterMedium.fbx"), "Characters/Animated"],
  ["Idle/run/jump clips", (e) => e.id.includes("Animations") && e.id.includes("run.fbx"), "Characters/Animated"],
  ["Traffic sedan", (e) => e.id.includes("sedan.fbx") || e.id.includes("race.fbx"), "Vehicles/Cars"],
  ["Emergency vehicle", (e) => e.id.includes("ambulance") || e.id.includes("police"), "Vehicles/Cars"],
  ["Commercial facade", (e) => e.id.includes("commercial") && (e.id.includes("building-a") || e.id.includes("building-i")), "Buildings/City"],
  ["Modular facade part", (e) => e.id.includes("building-kit") && e.id.includes("wall"), "Buildings/Modular"],
  ["Road/street mesh", (e) => e.id.includes("Street_Straight") || e.id.includes("road-split"), "Props/Quaternius"],
  ["Street furniture", (e) => e.id.includes("Streetlight") || e.id.includes("sign"), "Props/Quaternius"],
  ["Interior furniture", (e) => e.id.includes("furniture-kit"), "Props/Interior"],
  ["Nature (tree)", (e) => e.id.includes("tree") && e.id.includes("nature"), "Environment/Nature"],
  ["Nature (rock)", (e) => e.id.includes("boulder") || e.id.includes("rock"), "Environment/Nature"],
  ["Environment prop (PBR)", (e) => e.id.includes("polyhaven"), "Environment/Models"],
];
for (const [label, match, cat] of flagships) {
  const hit = ok.filter((e) => match(e)).sort((a, b) => b.total - a.total)[0];
  if (hit) {
    const m = hit.metrics || {};
    md.push(`- **${label}**: \`${hit.id}\` — score ${hit.total}, ${m.triangleCount ?? 0} tris, ${m.boneCount ?? 0} bones, ${m.actionCount ?? 0} actions, ${m.maxDimensionM ?? "-"} m`);
  }
}
md.push("");
md.push("## Top by category (score)");
md.push("");
for (const { cat, top } of shortlist) {
  md.push(`## ${cat}`);
  md.push("");
  md.push(mdTable([
    ["id", "ext", "tris", "VRAM MB", "mats", "tex", "score", "status"],
    ...top.map((e) => [e.id.slice(0, 58), e.ext, e.metrics?.triangleCount ?? "-", e.metrics?.estimatedVRAMMB ?? "-", e.metrics?.materialCount ?? "-", e.metrics?.textureCount ?? "-", e.total, e.status]),
  ]));
  md.push("");
}
fs.writeFileSync(OUT_SHORTLIST, md.join("\n"));
console.log("shortlist written");

const repair = [];
for (const e of entries) {
  if (e.status === "IMPORT_FAILED" || e.status === "ASCII_FBX_UNSUPPORTED") {
    const hint = e.importError?.includes("ASCII FBX")
      ? "ASCII FBX — Blender cannot import. Convert to glTF/FBX binary via FBX2glTF/Assimp or use the pack's GLB/OBJ twin."
      : e.importError?.includes("Collada")
        ? "DAE — Collada importer removed in Blender 5.1. Use the pack's FBX/OBJ/GLB twin."
        : e.importError;
    repair.push({ id: e.id, pack: e.pack, category: e.packCategory, ext: e.ext, issue: "import-failed", detail: hint });
  } else {
    const f = [];
    if (e.flags?.includes("missing-textures")) f.push(`missing texture refs: ${e.metrics.missingTextureRefs.length}`);
    if (e.flags?.includes("uv-overlap")) f.push("UV overlap");
    if (e.flags?.includes("non-manifold")) f.push(`non-manifold edges: ${e.metrics.nonManifoldEdges}`);
    if (e.flags?.includes("negative-scale")) f.push("negative scale");
    if (e.flags?.includes("high-vram")) f.push(`VRAM ${e.metrics.estimatedVRAMMB}MB`);
    if (e.flags?.includes("heavy-mesh")) f.push(`tris ${e.metrics.triangleCount}`);
    if (e.flags?.includes("off-center-pivot")) f.push("off-center pivot");
    if (e.total < 60) f.push(`score ${e.total}`);
    if (f.length) repair.push({ id: e.id, pack: e.pack, category: e.packCategory, ext: e.ext, issue: "quality", detail: f.join("; ") });
  }
}

const md2 = [];
md2.push("# ASSET REPAIR QUEUE");
md2.push("");
md2.push("Reversible staging conversions and quality issues. Originals are never edited in place; work happens on `staging/assets/files` copies.");
md2.push("");
for (const kind of ["import-failed", "quality"]) {
  const items = repair.filter((r) => r.issue === kind);
  md2.push(`## ${kind === "import-failed" ? "Import failures (30)" : `Quality issues (${items.length})`}`);
  md2.push("");
  md2.push(mdTable([
    ["id", "ext", "pack", "detail"],
    ...items.map((r) => [r.id.slice(0, 55), r.ext, r.pack.slice(0, 30), r.detail.slice(0, 120)]),
  ]));
  md2.push("");
}
fs.writeFileSync(OUT_REPAIR, md2.join("\n"));
console.log("repair queue:", repair.length, "items");
