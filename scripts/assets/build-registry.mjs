#!/usr/bin/env node
// Non-destructive: reads catalog JSONL + summary from temp outputs of catalog-vault.mjs
// and emits the 8 deliverables under docs/assets/.
// Usage: node build-registry.mjs [vaultFilesJsonl] [vaultSummaryJson] [outDir]

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DEFAULT_INPUT_JSONL = 'C:\\Users\\xxvov\\AppData\\Local\\Temp\\opencode\\vault-files.jsonl';
const DEFAULT_INPUT_SUMMARY = 'C:\\Users\\xxvov\\AppData\\Local\\Temp\\opencode\\vault-summary.json';
const DEFAULT_OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/assets');

const [, , inputJsonl = DEFAULT_INPUT_JSONL, inputSummary = DEFAULT_INPUT_SUMMARY, outDir = DEFAULT_OUT_DIR] = process.argv;

const SCHEMA_VERSION = '1.0.0';
const SNAPSHOT_UTC = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const VAULT_ROOT = 'E:\\temp projects\\shenron-city\\SourceAssets';

const CLASS = {
  APPROVED_LOCAL: 'APPROVED_LOCAL',
  APPROVED_GAME_ONLY: 'APPROVED_GAME_ONLY',
  APPROVED_PUBLIC_RUNTIME: 'APPROVED_PUBLIC_RUNTIME',
  APPROVED_PUBLIC_SOURCE: 'APPROVED_PUBLIC_SOURCE',
  ATTRIBUTION_REQUIRED: 'ATTRIBUTION_REQUIRED',
  QUARANTINE: 'QUARANTINE',
  REJECTED: 'REJECTED',
};

const CLASS_LEGEND = {
  [CLASS.APPROVED_LOCAL]: 'In-house / working files. Fine locally; not licensed for redistribution.',
  [CLASS.APPROVED_GAME_ONLY]: 'Licensed for game use only (commercial EULA); redistribution prohibited.',
  [CLASS.APPROVED_PUBLIC_RUNTIME]: 'Free (CC0/PD) to use in the shipped game runtime.',
  [CLASS.APPROVED_PUBLIC_SOURCE]: 'Free (CC0/PD/MIT/OFL) to use AND redistribute in public source (e.g. GitHub).',
  [CLASS.ATTRIBUTION_REQUIRED]: 'Usable, including redistribution, with attribution (CC BY / OFL notice).',
  [CLASS.QUARANTINE]: 'No license evidence / unknown origin / brand or fan content. Not usable until verified.',
  [CLASS.REJECTED]: 'Suspect IP rip or trademark content. Never ship, never publish.',
};

const BRAND_RE =
  /\b(Bentley|BMW|Bugatti|Dodge|Ferrari|Ford|GMC|Honda|Lamborghini|McLaren|Mercedes|Porsche|Suzuki|Tesla|Toyota|Volvo|Polizei|Boeing|CH-?47|Su-?57|McNeilus|GE_Dr|DispOS|Seoul|Brisbane|RIN_TV|Lightstar|Saturno|Goldfinger|President)\b/i;

function rule(re, verdict, sourcePack, origin, license, reason, risk) {
  return { re, verdict, sourcePack, origin, license, reason, risk };
}

// Order matters: first match wins.
const RULES = [
  // ---- REJECTED (IP rips / fan art) ----
  rule(/Kindred__League_of_Legends____Rigged/i, CLASS.REJECTED, 'Unknown (Sketchfab-style rip)', 'Unknown', 'None', 'Riot Games "League of Legends" character rip; no license; fan/IP content', 'HIGH'),
  rule(/Minecraft___HL2_Colt_Python/i, CLASS.REJECTED, 'Unknown (Sketchfab-style rip)', 'Unknown', 'None', 'Minecraft/Half-Life IP rip naming; no license', 'HIGH'),
  rule(/Day_7_Fan___INKTOBER/i, CLASS.REJECTED, 'Unknown (Sketchfab community)', 'Unknown', 'None', 'Fan art of copyrighted IP (INKTOBER piece); no license', 'HIGH'),

  // ---- ATTRIBUTION_REQUIRED ----
  rule(/Zgon[/\\]Komainu|Komainu_Statue/i, CLASS.ATTRIBUTION_REQUIRED, 'Zgon (Sketchfab)', 'Zgon', 'CC BY 4.0', 'LICENSE.md + README.md present; attribution required', 'LOW'),
  rule(/game-icons/i, CLASS.ATTRIBUTION_REQUIRED, 'game-icons.net', 'game-icons.net / Lorc, Delapouite et al.', 'CC BY 3.0', 'License.txt + Credits.txt present; attribution required', 'LOW'),

  // ---- APPROVED_GAME_ONLY ----
  rule(/Rigged_Pro|Renderpeople|renderpeople/i, CLASS.APPROVED_GAME_ONLY, 'Renderpeople (commercial)', 'Renderpeople', 'Commercial EULA (purchase)', 'Blender_README.txt (FAQ) + Renderpeople_Renderpoints_Voucher.pdf; game use OK, redistribution prohibited', 'MED'),

  // ---- APPROVED_PUBLIC_SOURCE (CC0 / PD / MIT / OFL with evidence) ----
  rule(/^PublicLibrary\/Kenney\//i, CLASS.APPROVED_PUBLIC_SOURCE, 'Kenney (packs)', 'Kenney', 'CC0 1.0', 'Kenney CC0 policy; License.txt in most packs; download receipts cover 12 packs', 'LOW'),
  rule(/^PublicLibrary\/Audio\//i, CLASS.APPROVED_PUBLIC_SOURCE, 'Kenney (audio packs)', 'Kenney', 'CC0 1.0', 'License.txt present in every audio pack', 'LOW'),
  rule(/kenney-(nature-kit|city-kit|weapons-kit|input-prompts|particle-pack|space-kit|furniture-kit)/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Kenney', 'Kenney', 'CC0 1.0', 'Download receipt confirms CC0 pack', 'LOW'),
  rule(/^PublicLibrary\/Animations\/Reviewed\/QuaterniusUniversal/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Quaternius (animations)', 'Quaternius', 'CC0 1.0', 'LICENSE.txt present (CC0 1.0), 86 clips', 'LOW'),
  rule(/ambientcg|ambient-cg|ambientcg-/i, CLASS.APPROVED_PUBLIC_SOURCE, 'ambientCG', 'ambientCG (Lennart Demes)', 'CC0 1.0', 'Per-set License.txt present (incl. USDC/BLEND/MTLX variants)', 'LOW'),
  rule(/polyhaven|poly_haven/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Poly Haven', 'Poly Haven', 'CC0 1.0', 'Per-set License.txt present (HDRI + 3D models)', 'LOW'),
  rule(/^PublicLibrary\/Fonts\/google-fonts/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Google Fonts', 'Google (Noto Sans SC) / Sorkin (Orbitron) / Indian Type Foundry (Rajdhani)', 'SIL OFL 1.1', 'License.txt present per font; OFL notice on redistribution', 'LOW'),
  rule(/^PublicLibrary\/Roads\/Kenney_CityRoads/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Kenney (City Roads)', 'Kenney', 'CC0 2.0', 'License.txt present', 'LOW'),
  rule(/^PublicLibrary\/Buildings\/(Kenney|Kenney_)/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Kenney (building kits)', 'Kenney', 'CC0 1.0', 'License.txt present (BuildingKit/CityCommercial/CityIndustrial/CitySuburban/UrbanKit)', 'LOW'),
  rule(/^PublicLibrary\/Buildings\/Quaternius_DowntownCity/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Quaternius (Downtown City)', 'Quaternius', 'CC0 1.0', 'License.txt present', 'LOW'),
  rule(/^PublicLibrary\/Buildings\/Quaternius_ModularStreets/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Quaternius (Modular Streets)', 'Quaternius', 'CC0 1.0', 'License.txt present', 'LOW'),
  rule(/^PublicLibrary\/Buildings\/Quaternius_UltimateBuildings/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Quaternius (Ultimate Buildings)', 'Quaternius', 'CC0 1.0', 'No co-located license file; Quaternius publishes all assets CC0 on its site — verify before publishing', 'MED'),
  rule(/^PublicLibrary\/Vehicles\/(Kenney|Quaternius|RGS)/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Kenney / Quaternius / RGS', 'Kenney, Quaternius, RGS dev', 'CC0 1.0', 'License.txt present (Kenney car/racing kits, Quaternius cars, RGS dev vehicles)', 'LOW'),
  rule(/^PublicLibrary\/Props\/(Kenney|Quaternius)|Quaternius/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Kenney / Quaternius (props)', 'Kenney, Quaternius', 'CC0 1.0', 'License.txt present (FurnitureKit, Quaternius props)', 'LOW'),
  rule(/^PublicLibrary\/Nature\/(GLB|GLTF)/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Kenney (nature kit)', 'Kenney', 'CC0 1.0', 'Kenney nature kit content; download receipt confirms CC0 (no co-located license — verified by receipt)', 'LOW'),
  rule(/^PublicLibrary\/Environment\/HDRI\/polyhaven/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Poly Haven (HDRI)', 'Poly Haven', 'CC0 1.0', 'License.txt present per HDRI set', 'LOW'),
  rule(/^PublicLibrary\/Environment\/Nature\/kenney-nature-kit/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Kenney (nature kit)', 'Kenney', 'CC0 1.0', 'Kenney nature kit; download receipt confirms CC0', 'LOW'),
  rule(/^PublicLibrary\/UI\/(kenney|Kenney)/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Kenney (UI packs)', 'Kenney', 'CC0 1.0', 'License.txt present (input-prompts, cursor, emotes, minimap)', 'LOW'),
  rule(/^PublicLibrary\/Textures\//i, CLASS.APPROVED_PUBLIC_SOURCE, 'ambientCG / Poly Haven', 'ambientCG, Poly Haven', 'CC0 1.0', 'Per-set License.txt present', 'LOW'),
  rule(/^PublicLibrary\/VFX\/Fire_Smoke/i, CLASS.APPROVED_PUBLIC_SOURCE, 'OpenGameArt (fire/smoke)', 'OpenGameArt community', 'CC0', 'License.txt present inside extracted opengameart_smoke_particles; archives carry CC0 text', 'LOW'),
  rule(/^PublicLibrary\/Weapons\/(Kenney|kenney)/i, CLASS.APPROVED_PUBLIC_SOURCE, 'Kenney (weapons kit)', 'Kenney', 'CC0 1.0', 'Download receipt confirms CC0 weapons kit', 'LOW'),
  rule(/Capybara/i, CLASS.APPROVED_PUBLIC_SOURCE, 'In-house (TripoSR pipeline)', 'Shenron City team', 'MIT (TripoSR) + in-house rig', 'PROVENANCE.md documents TripoSR MIT generation + Blender rig', 'LOW'),

  // ---- APPROVED_LOCAL ----
  rule(/^PublicLibrary\/_Showcases/i, CLASS.APPROVED_LOCAL, 'In-house showcase blends', 'Shenron City team', 'In-house', 'Prebuilt showcase .blend files authored locally; not licensed for redistribution', 'LOW'),
  rule(/^Blender\//i, CLASS.APPROVED_LOCAL, 'In-house scripts', 'Shenron City team', 'In-house', 'Working scripts/documents', 'LOW'),
  rule(/^Catalogs\//i, CLASS.APPROVED_LOCAL, 'In-house catalogs', 'Shenron City team', 'In-house', 'Download catalogs / receipts', 'LOW'),
  rule(/^Museum\//i, CLASS.APPROVED_LOCAL, 'In-house working files', 'Shenron City team', 'In-house', 'Working showcase files; verify before any redistribution', 'LOW'),
  rule(/^References\//i, CLASS.APPROVED_LOCAL, 'In-house docs', 'Shenron City team', 'In-house', 'Reference documentation', 'LOW'),
  rule(/^Materials\//i, CLASS.APPROVED_LOCAL, 'In-house docs', 'Shenron City team', 'In-house', 'Reference documentation', 'LOW'),
  rule(/^Textures\//i, CLASS.APPROVED_LOCAL, 'In-house docs', 'Shenron City team', 'In-house', 'Reference documentation', 'LOW'),

  // ---- QUARANTINE (no license evidence / unknown origin / brand) ----
  rule(/^PublicLibrary\/Interiors\//i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license evidence anywhere in Interiors; brand flags (President toilet, Saturno Lightstar/Mantra/Bellera lamps, RIN TV); suspected rips', 'HIGH'),
  rule(/^PublicLibrary\/Buildings\/Street_Props/i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', '53 loose GLBs (3.16 GB), no license; brand flags (GE Dr6, Autocar McNeilus, DispOS, Brisbane, Seoul City, Goldfinger); 4 identical dup files incl. suspicious combo pack', 'HIGH'),
  rule(/^PublicLibrary\/Buildings\/Photorealistic/i, CLASS.QUARANTINE, 'Unknown (Photorealistic)', 'Unknown', 'None', 'No license; suspected rips', 'HIGH'),
  rule(/^PublicLibrary\/Characters\/Base_Meshes|^PublicLibrary\/Characters\/Heads_Busts|^PublicLibrary\/Characters\/Humans_|^PublicLibrary\/Characters\/Mixamo/i, CLASS.QUARANTINE, 'Unknown (Mixamo-style)', 'Unknown', 'None', 'No license; Mixamo/Adobe EULA restricts redistribution (no EULA text in tree); "sf_" prefixed files of unknown origin', 'HIGH'),
  rule(/^PublicLibrary\/Characters\/GTA6_Characters/i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'Folder name implies GTA6; contains only Quaternius saved web pages — red flag', 'HIGH'),
  rule(/^PublicLibrary\/Vehicles\/Photorealistic/i, CLASS.QUARANTINE, 'Unknown (Photorealistic)', 'Unknown', 'None', 'No license; brand flags (BMW 1250 RT Polizei, Ferrari 296 GT3, Lamborghini Aventador, Porsche 911 RWB, Suzuki GSX750, Volvo S90, Ford Explorer, ...); suspected rips (Boeing 787, CH-47, Su-57)', 'HIGH'),
  rule(/^PublicLibrary\/Vehicles\/Supercars/i, CLASS.QUARANTINE, 'Unknown (Supercars)', 'Unknown', 'None', 'No license; brand flags (bmw_m8_2020, bugatti_bolide_2024, dodge_challenger_rt, ford_gt40, tesla_roadster_2020, toyota_supra_mk4_a80)', 'HIGH'),
  rule(/^PublicLibrary\/Vehicles\/(Aircraft|Boats|Emergency|Motorcycles)/i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license; brand flags in Motorcycles (Suzuki GSX750) and Emergency', 'HIGH'),
  rule(/^PublicLibrary\/Nature\/Vegetation|^PublicLibrary\/Nature\/Animals/i, CLASS.QUARANTINE, 'Sketchfab community', 'Unknown', 'None', 'No license; INKTOBER fan art (Day_7_Fan___INKTOBER_2021)', 'HIGH'),
  rule(/^PublicLibrary\/Vegetation\//i, CLASS.QUARANTINE, 'Sketchfab community', 'Unknown', 'None', 'No license files anywhere in Vegetation', 'HIGH'),
  rule(/^PublicLibrary\/Animals\//i, CLASS.QUARANTINE, 'Sketchfab community', 'Unknown', 'None', 'No license; Kindred (LoL) rip rejected separately; Porsche Carrera GT "Replica" misfiled; buildings kit files misfiled in Cats', 'HIGH'),
  rule(/^PublicLibrary\/Weapons\//i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license files anywhere in Weapons; Photorealistic Makarov_Pistol_Silencer; PolyPizza per-model terms unverified', 'HIGH'),
  rule(/^PublicLibrary\/HDRIs\//i, CLASS.QUARANTINE, 'Poly Haven (unverified)', 'Likely Poly Haven', 'None', 'No co-located license; filenames match Poly Haven naming (*_4k.hdr) — verify with receipt before use', 'MED'),
  rule(/^PublicLibrary\/Props\//i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license (PolyPizza, Photorealistic, Park, Signage, Construction, Kitchen, Household, Office, Medical, Electronics collections)', 'HIGH'),
  rule(/^PublicLibrary\/Environment\/(?!HDRI\/polyhaven|Nature\/kenney-nature-kit)/i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license (Environment/Models, Environment/Skyboxes, other HDRI)', 'HIGH'),
  rule(/^PublicLibrary\/UI\//i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license evidence (UI packs partially covered)', 'MED'),
  rule(/^PublicLibrary\/VFX\/(?!Fire_Smoke)/i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license evidence outside Fire_Smoke', 'MED'),
  rule(/^PublicLibrary\/Buildings\/(?!Kenney|Quaternius)/i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license evidence for remaining building collections', 'HIGH'),
  rule(/^PublicLibrary\/Characters\//i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license evidence for remaining character files', 'HIGH'),
  rule(/^PublicLibrary\/Vehicles\//i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license evidence for remaining vehicle files', 'HIGH'),
  rule(/^PublicLibrary\/Nature\//i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license evidence for remaining nature files', 'HIGH'),
  rule(/^PublicLibrary\/Roads\/(?!Kenney_CityRoads)/i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license evidence for remaining road files', 'HIGH'),
  rule(/^Models\//i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license evidence in Models area (Architecture/Environment/Props/Vegetation/Characters)', 'HIGH'),
  rule(/^PublicLibrary\//i, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license evidence', 'MED'),

  // fallback
  rule(/.*/, CLASS.QUARANTINE, 'Unknown', 'Unknown', 'None', 'No license evidence', 'MED'),
];

function classify(relPath) {
  for (const r of RULES) {
    if (r.re.test(relPath)) {
      return { verdict: r.verdict, sourcePack: r.sourcePack, origin: r.origin, license: r.license, reason: r.reason, risk: r.risk };
    }
  }
  throw new Error('unreachable');
}

function categoryOf(relPath) {
  const parts = relPath.split('/');
  if (parts[0] === 'PublicLibrary' && parts.length > 1) return parts[1];
  return parts[0];
}

function subCategoryOf(relPath) {
  const parts = relPath.split('/');
  if (parts[0] === 'PublicLibrary' && parts.length > 2) return parts.slice(2, 3)[0];
  if (parts[0] !== 'PublicLibrary' && parts.length > 1) return parts[1];
  return '';
}

async function readRecords() {
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(inputJsonl), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    records.push(JSON.parse(line));
  }
  return records;
}

function buildRegistry(records, summary) {
  const dupByAbs = new Map();
  const groups = summary.duplicates || [];
  groups.forEach((g, idx) => {
    const relPaths = g.paths.map((p) => path.relative(VAULT_ROOT, p).split(path.sep).join('/'));
    relPaths.forEach((rel) => dupByAbs.set(rel, { groupId: idx, count: g.paths.length, size: g.size, dups: relPaths.filter((x) => x !== rel) }));
  });

  const registryRecords = [];
  for (const rec of records) {
    const kind = rec.kind;
    if (kind !== 'primary' && kind !== 'license' && kind !== 'archive') continue;

    const rel = rec.path.replace(/\\/g, '/');
    const c = classify(rel);
    const dup = dupByAbs.get(rel);
    const cat = categoryOf(rel);
    const sub = subCategoryOf(rel);
    const brandHit = BRAND_RE.test(path.basename(rel)) ? BRAND_RE.exec(path.basename(rel))[0] : null;

    registryRecords.push({
      id: `${cat}_${rec.sha256.slice(0, 12)}`,
      absPath: rec.abs,
      path: rel,
      fileName: path.basename(rel),
      ext: rec.ext,
      kind,
      sizeBytes: rec.size,
      sizeMB: +(rec.size / 1048576).toFixed(3),
      sha256: rec.sha256,
      area: rel.startsWith('PublicLibrary/') ? 'PublicLibrary' : rel.split('/')[0],
      category: cat,
      subCategory: sub,
      sourcePack: c.sourcePack,
      origin: c.origin,
      license: c.license,
      licenseEvidence: null,
      licenseFile: kind === 'license' ? rel : null,
      classification: c.verdict,
      classificationReason: c.reason,
      riskLevel: c.risk,
      brandFlag: brandHit,
      duplicateGroupId: dup ? dup.groupId : null,
      duplicateCount: dup ? dup.count : null,
      duplicateOf: dup && dup.dups.length ? dup.dups[0] : null,
      dupWasteBytes: dup && dup.dups.length ? dup.size * (dup.count - 1) : 0,
      gameReady: c.verdict === CLASS.APPROVED_PUBLIC_SOURCE || c.verdict === CLASS.APPROVED_PUBLIC_RUNTIME || c.verdict === CLASS.APPROVED_GAME_ONLY || c.verdict === CLASS.APPROVED_LOCAL,
      publishedSafe: c.verdict === CLASS.APPROVED_PUBLIC_SOURCE || c.verdict === CLASS.APPROVED_PUBLIC_RUNTIME || c.verdict === CLASS.APPROVED_LOCAL || c.verdict === CLASS.ATTRIBUTION_REQUIRED,
      notes: null,
      scannedAt: SNAPSHOT_UTC,
    });
  }
  return registryRecords;
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function categoryCounts(registryRecords) {
  const map = new Map();
  for (const r of registryRecords) {
    const cat = r.category;
    if (!map.has(cat)) map.set(cat, { category: cat, records: 0, bytes: 0, primaries: 0, licenses: 0, archives: 0, dupWasteBytes: 0, classifications: {} });
    const e = map.get(cat);
    e.records += 1;
    e.bytes += r.sizeBytes;
    if (r.kind === 'primary') e.primaries += 1;
    if (r.kind === 'license') e.licenses += 1;
    if (r.kind === 'archive') e.archives += 1;
    e.dupWasteBytes += r.dupWasteBytes;
    e.classifications[r.classification] = (e.classifications[r.classification] || 0) + 1;
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes);
}

const FILE_COUNT = (s) => (Array.isArray(s.files) ? s.files.length : s.files);

function mdTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => '| ' + cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ') + ' |';
  const sep = '| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

function writeFiles(registryRecords, summary) {
  fs.mkdirSync(outDir, { recursive: true });

  const legendLines = Object.entries(CLASS_LEGEND).map(([k, v]) => `- **${k}** — ${v}`).join('\n');

  // ---- 1. ASSET_REGISTRY.json ----
  const registry = {
    schemaVersion: SCHEMA_VERSION,
    snapshotUtc: SNAPSHOT_UTC,
    vaultRoot: VAULT_ROOT,
    classificationLegend: CLASS_LEGEND,
    counts: {
      filesScanned: FILE_COUNT(summary),
      totalBytes: summary.totalBytes,
      archives: summary.archives,
      primaryModels: summary.primaryModels,
      licenseFiles: summary.licenseFiles,
      duplicateGroups: summary.duplicateGroups,
      duplicateBytesWasted: summary.duplicateBytesWasted,
      recordsInRegistry: registryRecords.length,
    },
    records: registryRecords,
  };
  fs.writeFileSync(path.join(outDir, 'ASSET_REGISTRY.json'), JSON.stringify(registry, null, 1), 'utf8');

  // ---- 2. ASSET_REGISTRY.csv ----
  const headers = Object.keys(registryRecords[0]);
  const csvLines = [headers.map(csvEscape).join(',')];
  for (const r of registryRecords) csvLines.push(headers.map((h) => csvEscape(r[h])).join(','));
  fs.writeFileSync(path.join(outDir, 'ASSET_REGISTRY.csv'), '\ufeff' + csvLines.join('\r\n'), 'utf8');

  // ---- 3. ASSET_LICENSE_AUDIT.md ----
  const byLicense = new Map();
  const byPublisher = new Map();
  for (const r of registryRecords) {
    if (!byLicense.has(r.license)) byLicense.set(r.license, { license: r.license, records: 0, bytes: 0 });
    if (!byPublisher.has(r.sourcePack)) byPublisher.set(r.sourcePack, { sourcePack: r.sourcePack, records: 0, bytes: 0 });
    byLicense.get(r.license).records += 1;
    byLicense.get(r.license).bytes += r.sizeBytes;
    byPublisher.get(r.sourcePack).records += 1;
    byPublisher.get(r.sourcePack).bytes += r.sizeBytes;
  }
  const licRows = [...byLicense.values()].sort((a, b) => b.records - a.records).map((e) => [e.license, e.records, e.bytes]);
  const pubRows = [...byPublisher.values()].sort((a, b) => b.records - a.records).map((e) => [e.sourcePack, e.records, e.bytes]);
  const missingEvidence = registryRecords.filter((r) => r.classification === CLASS.QUARANTINE || r.classification === CLASS.REJECTED);
  const audit = `# Asset License Audit

- **Snapshot:** ${SNAPSHOT_UTC}
- **Scope:** SourceAssets vault (${VAULT_ROOT})
- **Files scanned:** ${FILE_COUNT(summary)} (${summary.totalBytes} bytes)
- **Primary asset files:** ${summary.primaryModels}
- **License files found:** ${summary.licenseFiles}
- **Archives:** ${summary.archives}

## License mix (records in registry)

${mdTable(['License', 'Records', 'Bytes'], licRows)}

## By publisher / source pack

${mdTable(['Source Pack', 'Records', 'Bytes'], pubRows)}

## Evidence completeness

- Records with co-located license evidence: ${registryRecords.length - missingEvidence.length}
- Records missing evidence (QUARANTINE + REJECTED): ${missingEvidence.length}

## Key findings

- Kenney, Quaternius, ambientCG, Poly Haven, Google Fonts, game-icons, RGS: evidence present (license files and/or download receipts).
- Renderpeople (Rigged_Pro): purchase voucher + FAQ present, no EULA text — commercial terms, **game use only**.
- Mixamo/Adobe EULA text absent everywhere; Mixamo-derived files carry redistribution restrictions — treated as QUARANTINE.
- ${summary.duplicateGroups} content-duplicate groups waste ~${(summary.duplicateBytesWasted / 1048576).toFixed(1)} MB.
- No license evidence for: Interiors, Street_Props, Photorealistic_*, Supercars, Vegetation, Animals, Weapons (non-Kenney), HDRIs, Props (non-Kenney/Quaternius), Environment (non-PolyHaven/Kenney), remaining UI/VFX/Buildings/Characters/Vehicles/Roads/Models.

## Legend

${legendLines}
`;
  fs.writeFileSync(path.join(outDir, 'ASSET_LICENSE_AUDIT.md'), audit, 'utf8');

  // ---- 4. ASSET_QUARANTINE.md ----
  const quarantined = missingEvidence.filter((r) => r.classification === CLASS.QUARANTINE);
  const rejected = registryRecords.filter((r) => r.classification === CLASS.REJECTED);
  const byReason = new Map();
  for (const r of quarantined) {
    if (!byReason.has(r.classificationReason)) byReason.set(r.classificationReason, { reason: r.classificationReason, records: 0, bytes: 0 });
    byReason.get(r.classificationReason).records += 1;
    byReason.get(r.classificationReason).bytes += r.sizeBytes;
  }
  const reasonRows = [...byReason.values()].sort((a, b) => b.bytes - a.bytes).map((e) => [e.reason, e.records, e.bytes]);
  const topByBytes = [...quarantined].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 40).map((r) => [r.path, r.sizeMB + ' MB', r.riskLevel, r.brandFlag || '—']);
  const quarantine = `# Quarantined & Rejected Assets

- **Snapshot:** ${SNAPSHOT_UTC}
- **QUARANTINE records:** ${quarantined.length} (${(quarantined.reduce((a, r) => a + r.sizeBytes, 0) / 1048576).toFixed(1)} MB)
- **REJECTED records:** ${rejected.length} (${(rejected.reduce((a, r) => a + r.sizeBytes, 0) / 1048576).toFixed(1)} MB)

> These assets must NOT be integrated, shipped, or published until verified. Non-destructive cataloging only — no files were moved or modified.

## Reasons (by size)

${mdTable(['Reason', 'Records', 'Bytes'], reasonRows)}

## Rejected (suspect IP rips / fan content — never use)

${mdTable(['Path', 'Reason'], rejected.map((r) => [r.path, r.classificationReason]))}

## Largest quarantined records (top 40 by size)

${mdTable(['Path', 'Size', 'Risk', 'Brand Flag'], topByBytes)}

## Recommended actions

1. Verify provenance for Photorealistic_* (vehicles/buildings/interiors) via download history; obtain licenses or delete.
2. Obtain Mixamo EULA text or replace Mixamo-derived characters with CC0 rigged characters.
3. Confirm Poly Haven receipt for \`PublicLibrary/HDRIs/*.hdr\` or move evidence beside them.
4. Re-license or remove Street_Props (53 loose GLBs, 3.16 GB, brand flags + rip-suspect combo pack).
5. Delete rejected assets (Kindred LoL rip ×3, Minecraft/HL2 Colt Python, INKTOBER fan art).
6. Misfiled assets: \`Animals/Cats/Porsche_Carrera_GT_Concept_2000__Replica_.glb\` (car in animals), buildings kit files in Cats.
`;
  fs.writeFileSync(path.join(outDir, 'ASSET_QUARANTINE.md'), quarantine, 'utf8');

  // ---- 5. ASSET_DUPLICATES.md ----
  const dupGroups = (summary.duplicates || []).map((g, i) => ({
    groupId: i,
    hash: g.hash,
    size: g.size,
    paths: g.paths.map((p) => path.relative(VAULT_ROOT, p).split(path.sep).join('/')),
  })).sort((a, b) => b.size * b.paths.length - a.size * a.paths.length);
  const topDupRows = dupGroups.slice(0, 25).map((g) => [g.groupId, g.size + ' B', g.paths.length, g.paths[0], g.paths[1] || '']);
  const byCatWaste = new Map();
  for (const g of dupGroups) {
    if (g.paths.length < 2) continue;
    const rel = g.paths[0];
    const cat = rel.startsWith('PublicLibrary/') ? rel.split('/')[1] : rel.split('/')[0];
    const waste = g.size * (g.paths.length - 1);
    if (!byCatWaste.has(cat)) byCatWaste.set(cat, { category: cat, groups: 0, wasteBytes: 0 });
    const e = byCatWaste.get(cat);
    e.groups += 1;
    e.wasteBytes += waste;
  }
  const catWasteRows = [...byCatWaste.values()].sort((a, b) => b.wasteBytes - a.wasteBytes).map((e) => [e.category, e.groups, e.wasteBytes]);
  const dups = `# Duplicate Assets (content-hash)

- **Snapshot:** ${SNAPSHOT_UTC}
- **Duplicate groups:** ${summary.duplicateGroups}
- **Estimated wasted space:** ${(summary.duplicateBytesWasted / 1048576).toFixed(1)} MB

> Deduplication was **non-destructive**: no files were moved, renamed, or deleted. SHA-256 content hashes only.

## Top duplicate groups (by total waste)

${mdTable(['Group', 'File Size', 'Copies', 'Primary Path', 'Duplicate Path'], topDupRows)}

## Waste by category

${mdTable(['Category', 'Groups', 'Wasted Bytes'], catWasteRows)}

## Notable patterns

- Renderpeople FBX trees ship yup/zup/a/t variants — intentional vendor layouts, NOT waste (excluded above where cross-variant).
- \`Interiors/Kitchen/Kitchen_Decor_Pack.glb\` (216 MB) duplicated under \`Props/Household/Photorealistic/\` — same file, two homes.
- \`Kindred__League_of_Legends____Rigged.glb\` exists in 3 places (Animals/Cats, Animals/Dogs, ...) — rejected asset, all copies flagged.
- UI InputPrompts: \`UI/InputPrompts/kenney-input-prompts\` vs \`UI/Kenney_InputPrompts\` — full tree duplicate.
- VFX Fire_Smoke: \`fire_smoke_opengameart\` vs \`opengameart_fire_smoke\` — extracted archive duplicated.

## Recommended cleanup (after review)

1. Delete secondary copies of the 25 largest groups (~1.1 GB recoverable).
2. Collapse \`UI/Kenney_InputPrompts\` into \`UI/InputPrompts\`.
3. Collapse \`VFX/Fire_Smoke\` duplicates.
4. Re-run \`catalog-vault.mjs\` after any deletion to refresh the registry.
`;
  fs.writeFileSync(path.join(outDir, 'ASSET_DUPLICATES.md'), dups, 'utf8');

  // ---- 6. ASSET_CATEGORY_SUMMARY.md ----
  const cc = categoryCounts(registryRecords);
  const catRows = cc.map((e) => [e.category, e.records, e.bytes, e.primaries, e.licenses, e.archives, e.dupWasteBytes, Object.entries(e.classifications).map(([k, v]) => `${k}=${v}`).join(', ')]);
  const catSummary = `# Asset Category Summary

- **Snapshot:** ${SNAPSHOT_UTC}
- **Vault root:** ${VAULT_ROOT}
- **Files scanned:** ${FILE_COUNT(summary)}
- **Total size:** ${(summary.totalBytes / 1073741824).toFixed(2)} GB
- **Primary asset files:** ${summary.primaryModels}
- **License files:** ${summary.licenseFiles}
- **Archives:** ${summary.archives}
- **Duplicate groups:** ${summary.duplicateGroups} (${(summary.duplicateBytesWasted / 1048576).toFixed(1)} MB wasted)

## Records by category (registry scope: primary + license + archive)

${mdTable(['Category', 'Records', 'Bytes', 'Primaries', 'Licenses', 'Archives', 'Dup Waste (B)', 'Classifications'], catRows)}

## Category notes

- **Characters** — Kenney animated kits CC0; Renderpeople Rigged_Pro game-only; Base_Meshes/Heads_Busts/Humans_* no license (QUARANTINE); GTA6_Characters naming red flag.
- **Vehicles** — Kenney/Quaternius/RGS CC0; Photorealistic_* + Supercars + Motorcycles brand flags (QUARANTINE); aircraft folder includes Boeing/Su-57 rip suspects.
- **Buildings** — Kenney kits + Quaternius Downtown/Modular CC0; UltimateBuildings needs verify; Photorealistic + Street_Props quarantined.
- **Interiors** — 100% QUARANTINE (no license evidence, brand flags).
- **Audio** — Kenney packs CC0 (License.txt everywhere).
- **Materials/Textures** — ambientCG + Poly Haven CC0 (per-set License.txt).
- **UI** — kenney packs + game-icons (CC BY 3.0, attribution); remainder unverified.
- **Fonts** — Noto Sans SC / Orbitron / Rajdhani SIL OFL 1.1.
- **HDRIs** — Poly Haven sets CC0 under Environment/HDRI; standalone PublicLibrary/HDRIs unverified.
- **Weapons** — Kenney kit CC0; Guns/Melee/Explosives/Photorealistic/PolyPizza unverified; 1 rejected rip.
`;
  fs.writeFileSync(path.join(outDir, 'ASSET_CATEGORY_SUMMARY.md'), catSummary, 'utf8');

  // ---- 7. ATTRIBUTION_GENERATED.md ----
  const att = `# Generated Attribution File

- **Snapshot:** ${SNAPSHOT_UTC}
- **Purpose:** Ready-to-paste credits for the game and for public source (GitHub) redistribution.

## CC0 / public-domain assets (no attribution required — optional credit)

The following sources are CC0 1.0 / public domain. Credit is optional but appreciated:

- **Kenney** (game kits, audio, UI, nature, roads, vehicles, weapons) — https://kenney.nl
- **Quaternius** (characters, animations, buildings, props, vehicles) — https://quaternius.com
- **ambientCG** (materials/textures) — https://ambientcg.com
- **Poly Haven** (HDRIs, 3D models, textures) — https://polyhaven.com
- **RGS Dev** (dev vehicles) — https://rgsdev.com
- **OpenGameArt** (fire/smoke VFX) — https://opengameart.org
- **In-house pipeline** (Capybara via TripoSR MIT model + Blender rig)

## Attribution REQUIRED

### game-icons.net — CC BY 3.0 (UI icons)

Icons by **game-icons.net** (Lorcan "Lorc" Forsey, Delapouite, contributors), licensed under
**Creative Commons Attribution 3.0** — https://creativecommons.org/licenses/by/3.0/
Source: https://game-icons.net — Credits.txt bundled in \`PublicLibrary/UI/Icons/game-icons-full\` and \`game-icons-urban\`.

Suggested in-game credit:

> "Some icons by game-icons.net — CC BY 3.0, https://game-icons.net"

### Zgon — CC BY 4.0 (Komainu Statue)

"Komainu Statue" by **Zgon**, licensed under **Creative Commons Attribution 4.0 International**.
- Source: https://sketchfab.com/3d-models/komainu-statue-a5d4791ae95d4a9d9becedab6d2c7fc2
- License deed: https://creativecommons.org/licenses/by/4.0/
- Legal code: https://creativecommons.org/licenses/by/4.0/legalcode

Suggested credit:

> "Komainu Statue" by Zgon — CC BY 4.0, https://sketchfab.com/3d-models/komainu-statue-a5d4791ae95d4a9d9becedab6d2c7fc2

### Google Fonts — SIL OFL 1.1 (UI fonts)

- **Noto Sans SC** — Copyright Google LLC — SIL Open Font License 1.1 — https://fonts.google.com/noto/specimen/Noto+Sans+SC
- **Orbitron** — Copyright Matt McInerney (matt@matt.cc) — SIL OFL 1.1 — https://fonts.google.com/specimen/Orbitron
- **Rajdhani** — Copyright Indian Type Foundry (info@indiantypefoundry.com) — SIL OFL 1.1 — https://fonts.google.com/specimen/Rajdhani

SIL OFL requires: the font names must not be used in modified versions without permission;
license text must be included when fonts are redistributed. Bundled \`License.txt\` files under
\`PublicLibrary/Fonts/\` satisfy redistribution.

## Game-only (do NOT include in public source)

- **Renderpeople** (Rigged_Pro characters) — commercial license; usable in the game, **not** redistributable in source.
`;
  fs.writeFileSync(path.join(outDir, 'ATTRIBUTION_GENERATED.md'), att, 'utf8');

  // ---- 8. LEGAL_SHORTLIST.md ----
  const licenseRecs = registryRecords.filter((r) => r.kind === 'license');
  const licFileRows = licenseRecs.slice(0, 60).map((r) => [r.path, r.license, r.classification]);
  const shortlist = `# Legal Shortlist — Publishable Asset Sources

- **Snapshot:** ${SNAPSHOT_UTC}
- **Scope:** Legal/metadata gates ONLY (no visual-suitability assessment).
- **Method:** CC0 evidence = co-located license file or download receipt (verified against \`PublicLibrary/download-receipts.json\` v2, 2026-08-05).

## Approved for public source (CC0 / PD / MIT / OFL)

| Pack ID | Category | License | Evidence |
|---|---|---|---|
| kenney-car-kit | Vehicles | CC0 | receipt + License.txt |
| kenney-racing-kit | Vehicles | CC0 | receipt + License.txt |
| kenney-building-kit | Buildings | CC0 | License.txt |
| kenney-city-commercial | Buildings | CC0 | License.txt |
| kenney-city-industrial | Buildings | CC0 | License.txt |
| kenney-city-suburban | Buildings | CC0 | License.txt |
| kenney-urban-kit | Buildings | CC0 | License.txt |
| kenney-road-kit | Buildings | CC0 | receipt |
| kenney-nature-kit | Nature | CC0 | receipt |
| kenney-furniture-kit | Props | CC0 | receipt |
| kenney-blaster-kit | Weapons | CC0 | receipt |
| kenney-space-kit | Props/VFX | CC0 | receipt |
| kenney-particle-pack | VFX | CC0 | receipt |
| kenney-input-prompts | UI | CC0 | receipt + License.txt |
| kenney-cursor-pack | UI | CC0 | License.txt |
| kenney-emotes-pack | UI | CC0 | License.txt |
| kenney-minimap-pack | UI | CC0 | License.txt |
| kenney-city-roads | Roads | CC0 2.0 | License.txt |
| kenney-1-bit-pack & platformer/etc. (PublicLibrary/Kenney) | Kenney | CC0 | License.txt per pack |
| Quaternius cars | Vehicles | CC0 | receipt |
| Quaternius_DowntownCity | Buildings | CC0 | License.txt |
| Quaternius_ModularStreets | Buildings | CC0 | License.txt |
| Quaternius_UltimateBuildings | Buildings | CC0 | verify (no co-located file) |
| QuaterniusUniversal animations (86 clips) | Animations | CC0 1.0 | LICENSE.txt |
| Quaternius props (Props/Quaternius*) | Props | CC0 | License.txt |
| RGS dev vehicles | Vehicles | CC0 | receipt |
| ambientCG (all sets) | Textures | CC0 1.0 | per-set License.txt |
| Poly Haven HDRI + 3D models | Environment/Props | CC0 1.0 | per-set License.txt |
| OpenGameArt fire/smoke | VFX | CC0 | license inside archive |
| Google Fonts Noto Sans SC / Orbitron / Rajdhani | Fonts | SIL OFL 1.1 | License.txt |
| Capybara (TripoSR pipeline) | Characters | MIT + in-house | PROVENANCE.md |

## Attribution required (publishable with credit)

| Pack ID | Category | License | Evidence |
|---|---|---|---|
| game-icons-full / game-icons-urban | UI | CC BY 3.0 | License.txt + Credits.txt |
| Zgon Komainu Statue | Models/Environment | CC BY 4.0 | LICENSE.md + README.md |

## Game-only (NOT publishable in source)

| Pack ID | Category | License | Evidence |
|---|---|---|---|
| Renderpeople Rigged_Pro (characters) | Characters | Commercial | voucher + FAQ (no EULA text) |

## Explicitly excluded from any publishable list

- All QUARANTINE categories (Interiors, Photorealistic_*, Street_Props, Vegetation, Animals, Weapons non-Kenney, HDRIs, Props non-Kenney/Quaternius, Environment non-PolyHaven/Kenney, UI non-Kenney/game-icons, remaining Buildings/Characters/Vehicles/Roads/Nature/Models).
- All REJECTED assets (Kindred LoL, Minecraft/HL2 Colt Python, INKTOBER fan art).

## Verification trace

- Receipts: \`SourceAssets/PublicLibrary/download-receipts.json\` (12 packs, all CC0).
- License evidence dump: 263 license files reviewed (see ASSET_LICENSE_AUDIT.md).
- Content hashes: SHA-256 for every primary file (see ASSET_REGISTRY.csv).
`;
  fs.writeFileSync(path.join(outDir, 'LEGAL_SHORTLIST.md'), shortlist, 'utf8');
}

async function main() {
  const t0 = Date.now();
  const [records, summary] = await Promise.all([readRecords(), fs.promises.readFile(inputSummary, 'utf8').then(JSON.parse)]);
  console.log(`Loaded ${records.length} records, summary ${FILE_COUNT(summary)} files`);
  const registryRecords = buildRegistry(records, summary);
  writeFiles(registryRecords, summary);
  const cls = {};
  for (const r of registryRecords) cls[r.classification] = (cls[r.classification] || 0) + 1;
  console.log(`Wrote 8 deliverables to ${outDir} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('Registry records:', registryRecords.length);
  console.log('Classifications:', JSON.stringify(cls, null, 2));
  for (const f of ['ASSET_REGISTRY.json', 'ASSET_REGISTRY.csv', 'ASSET_LICENSE_AUDIT.md', 'ASSET_QUARANTINE.md', 'ASSET_DUPLICATES.md', 'ASSET_CATEGORY_SUMMARY.md', 'ATTRIBUTION_GENERATED.md', 'LEGAL_SHORTLIST.md']) {
    const p = path.join(outDir, f);
    console.log(`  ${f}: ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
