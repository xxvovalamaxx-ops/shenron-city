import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKTREE = path.resolve(__dirname, "..", "..");
const REGISTRY = path.join(WORKTREE, "docs", "assets", "ASSET_TECHNICAL_REGISTRY.json");
const OUT = path.join(WORKTREE, "staging", "assets", "preview-list.json");

const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
const ok = reg.entries.filter((e) => e.status === "OK");

const picks = [
  { id: "Characters_Animated_kenney-animated-characters-protagonists_Model_characterMedium.fbx", role: "pedestrian-rig", turntable: true },
  { id: "Characters_Animated_kenney-animated-characters-retro_Model_characterMedium.fbx", role: "pedestrian-rig" },
  { id: "Characters_Animated_kenney-animated-characters-survivors_Model_characterMedium.fbx", role: "pedestrian-rig" },
  { id: "Characters_Animated_kenney-mini-characters_Models_FBX_format_character-male-a.fbx", role: "pedestrian-rig" },
  { id: "Vehicles_Cars_kenney-car-kit_Models_FBX_format_race.fbx", role: "vehicle", turntable: true },
  { id: "Vehicles_Cars_kenney-car-kit_Models_FBX_format_ambulance.fbx", role: "vehicle" },
  { id: "Vehicles_Cars_kenney-car-kit_Models_OBJ_format_taxi.obj", role: "vehicle" },
  { id: "Vehicles_Cars_kenney-racing-kit_Models_GLTF_format_", role: "vehicle" },
  { id: "Props_Quaternius_quaternius-lowpoly-cars_Realistic_Car_Pack_-_Nov_2018_OBJ_Cop.obj", role: "vehicle" },
  { id: "Buildings_City_kenney-city-kit-commercial_Models_FBX_format_building-a.fbx", role: "building", turntable: true },
  { id: "Buildings_City_kenney-city-kit-commercial_Models_FBX_format_building-skyscraper-d.fbx", role: "building" },
  { id: "Buildings_Modular_kenney-building-kit_Models_OBJ_format_wall-doorway-round.obj", role: "building-module" },
  { id: "Buildings_City_kenney-city-kit-suburban_Models_FBX_format_building-type-a.fbx", role: "building" },
  { id: "Props_Quaternius_quaternius-lowpoly-modular-street_OBJ_Street_Straight.obj", role: "street" },
  { id: "Props_Quaternius_quaternius-lowpoly-modular-street_OBJ_Streetlight_Triple.obj", role: "street-prop" },
  { id: "Props_Quaternius_quaternius-lowpoly-modular-street_OBJ_Street_3Way_2.obj", role: "street" },
  { id: "Props_Interior_kenney-furniture-kit_Models_OBJ_format_cabinetBedDrawer.obj", role: "interior" },
  { id: "Props_Market_kenney-food-kit_Models_OBJ_format_advocado-half.obj", role: "prop" },
  { id: "Environment_Nature_kenney-nature-kit_Models_GLTF_format_tree_pineDefaultA.glb", role: "nature" },
  { id: "Environment_Models_polyhaven-boulder_01_boulder_01_1k.gltf", role: "nature", turntable: true },
  { id: "Environment_Models_polyhaven-fire_hydrant_fire_hydrant_1k.gltf", role: "street-prop" },
  { id: "Environment_Models_polyhaven-Lantern_01_Lantern_01_1k.gltf", role: "street-prop" },
  { id: "Environment_Models_polyhaven-WetFloorSign_01_WetFloorSign_01_1k.gltf", role: "prop" },
  { id: "Buildings_City_kenney-city-kit-roads_Models_FBX_format_road-bend.fbx", role: "street" },
];

const jobs = [];
for (const p of picks) {
  const e = ok.find((x) => x.id.startsWith(p.id));
  if (!e) {
    console.log("MISS:", p.id);
    continue;
  }
  jobs.push({ id: e.id, relPath: e.relPath, ext: e.ext, pack: e.pack, category: e.packCategory, role: p.role, turntable: !!p.turntable });
}

const clips = [
  { char: "Characters_Animated_kenney-animated-characters-protagonists_Model_characterMedium.fbx", anim: "Characters_Animated_kenney-animated-characters-protagonists_Animations_idle.fbx", name: "idle" },
  { char: "Characters_Animated_kenney-animated-characters-protagonists_Model_characterMedium.fbx", anim: "Characters_Animated_kenney-animated-characters-protagonists_Animations_run.fbx", name: "run" },
  { char: "Characters_Animated_kenney-animated-characters-protagonists_Model_characterMedium.fbx", anim: "Characters_Animated_kenney-animated-characters-protagonists_Animations_jump.fbx", name: "jump" },
];
const charJobs = [];
for (const c of clips) {
  const e = ok.find((x) => x.id.startsWith(c.anim));
  if (e) charJobs.push({ id: e.id, charRelPath: ok.find((x) => x.id.startsWith(c.char)).relPath, relPath: e.relPath, ext: "fbx", pack: e.pack, category: e.packCategory, role: "character-clip", clipName: c.name });
}

fs.writeFileSync(OUT, JSON.stringify({ jobs, charJobs }, null, 2));
console.log("preview jobs:", jobs.length, "clip jobs:", charJobs.length);
for (const j of jobs) console.log(" ", j.role.padEnd(16), j.ext.padEnd(5), j.relPath.slice(0, 85));
