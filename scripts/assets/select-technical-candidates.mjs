import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKTREE = path.resolve(__dirname, "..", "..");
const LIB = path.join(WORKTREE, "SourceAssets", "PublicLibrary");
const REGISTRY = path.join(WORKTREE, "SourceAssets", "PublicLibrary", "ASSET_MANIFEST.json");
const STAGING = path.join(WORKTREE, "staging", "assets");

const MODEL_EXTS = new Set([".fbx", ".glb", ".gltf", ".obj", ".dae", ".blend"]);
const TEXTURE_EXTS = new Set([".png", ".jpg", ".jpeg", ".tga", ".tif", ".tiff", ".mtl", ".bin", ".ktx2"]);

const registry = JSON.parse(fs.readFileSync(REGISTRY, "utf8").replace(/^\uFEFF/, ""));
const packById = new Map((registry.packs || []).map((p) => [p.id, p]));

const SAMPLING = {
  "Characters/Animated": { mode: "all-small", max: 24 },
  "Vehicles/Cars": { mode: "sample", max: 20 },
  "Buildings/City": { mode: "sample", max: 14 },
  "Buildings/Modular": { mode: "sample", max: 16 },
  "Props/Interior": { mode: "sample", max: 14 },
  "Props/Market": { mode: "sample", max: 12 },
  "Props/Prototype": { mode: "sample", max: 12 },
  "Props/Quaternius": { mode: "sample", max: 18 },
  "Environment/Models": { mode: "all", max: 12 },
  "Environment/Nature": { mode: "sample", max: 18 },
  "Kenney": { mode: "sample", max: 8 },
};

function listModels(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listModels(full, out);
    else if (MODEL_EXTS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function sampleFiles(files, max) {
  if (files.length <= max) return files;
  const picked = [];
  const step = files.length / max;
  for (let i = 0; i < max; i++) picked.push(files[Math.min(files.length - 1, Math.floor(i * step))]);
  const unique = [...new Set(picked)];
  while (unique.length < max) {
    const extra = files[Math.floor(Math.random() * files.length)];
    if (!unique.includes(extra)) unique.push(extra);
  }
  return unique.slice(0, max);
}

const candidates = [];
for (const cat of Object.keys(SAMPLING)) {
  const catRoot = path.join(LIB, cat);
  if (!fs.existsSync(catRoot)) continue;
  const packs = fs.readdirSync(catRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const packDir of packs) {
    const packId = packById.has(packDir.name) ? packDir.name : null;
    const packRoot = path.join(catRoot, packDir.name);
    const files = listModels(packRoot);
    if (!files.length) continue;
    const { mode, max } = SAMPLING[cat];
    let picked = files;
    if (mode === "sample" || mode === "all-small") picked = sampleFiles(files, mode === "all" ? max : max);
    for (const f of picked) {
      const rel = path.relative(LIB, f).split(path.sep).join("/");
      candidates.push({
        id: rel.replace(/[^A-Za-z0-9._-]/g, "_"),
        pack: packId || packDir.name,
        packCategory: packById.get(packId)?.category || cat,
        license: packById.get(packId)?.license || "CC0-1.0",
        relPath: rel,
        ext: path.extname(f).slice(1).toLowerCase(),
        bytes: fs.statSync(f).size,
      });
    }
  }
}

candidates.sort((a, b) => a.relPath.localeCompare(b.relPath));

const outManifest = path.join(STAGING, "candidates.json");
fs.mkdirSync(STAGING, { recursive: true });

let copiedBytes = 0;
let copiedFiles = 0;
for (const c of candidates) {
  const src = path.join(LIB, c.relPath);
  const dst = path.join(STAGING, "files", c.relPath);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copiedBytes += c.bytes;
  copiedFiles++;
  const dir = path.dirname(src);
  for (const entry of fs.readdirSync(dir)) {
    const ext = path.extname(entry).toLowerCase();
    if (!TEXTURE_EXTS.has(ext)) continue;
    if (path.join(dir, entry) === src) continue;
    const tDst = path.join(STAGING, "files", path.relative(LIB, path.join(dir, entry)).split(path.sep).join("/"));
    if (!fs.existsSync(tDst)) {
      fs.mkdirSync(path.dirname(tDst), { recursive: true });
      fs.copyFileSync(path.join(dir, entry), tDst);
      copiedFiles++;
    }
  }
  const texDir = path.join(dir, "Textures");
  if (fs.existsSync(texDir)) {
    for (const entry of fs.readdirSync(texDir)) {
      const tDst = path.join(STAGING, "files", path.relative(LIB, path.join(texDir, entry)).split(path.sep).join("/"));
      if (!fs.existsSync(tDst)) {
        fs.mkdirSync(path.dirname(tDst), { recursive: true });
        fs.copyFileSync(path.join(texDir, entry), tDst);
        copiedFiles++;
      }
    }
  }
}

fs.writeFileSync(outManifest, JSON.stringify({ generated: new Date().toISOString(), library: LIB, count: candidates.length, candidates }, null, 2));
console.log(`candidates: ${candidates.length}`);
console.log(`staged files: ${copiedFiles}, staged bytes: ${copiedBytes}`);
const byExt = {};
for (const c of candidates) byExt[c.ext] = (byExt[c.ext] || 0) + 1;
console.log("by ext:", JSON.stringify(byExt));
const byCat = {};
for (const c of candidates) byCat[c.packCategory] = (byCat[c.packCategory] || 0) + 1;
console.log("by pack category:", JSON.stringify(byCat, null, 1));
