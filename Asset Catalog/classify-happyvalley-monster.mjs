#!/usr/bin/env node
/**
 * Deterministic classifier for the HappyValley monster pack
 * (reference/assets/maps/HappyValley/Mob/*) — per ChatGPT audit.
 *
 * The pack is a 5-creature animal/mob package (black_grouse, boar, deer, fox,
 * hare) with animation source files, sprite sheets (with/without shadow),
 * optional standalone shadow sprites, and a Tiled export copy.
 *
 * Semantic families (4 + 1 support):
 *   happyvalley_monster_animation  52 sprite sheets (26 without-shadow + 26 embedded-shadow)
 *   happyvalley_monster_shadow      5 standalone shadow sprites
 *   happyvalley_monster_source    104 Aseprite authoring sources (directions explicit in filename)
 *   happyvalley_monster_tiled      58 Tiled export resources (57 duplicate PNGs + Animals.tmx)
 *   happyvalley_monster_system      4 .DS_Store system files (catalogVisible false)
 *
 * The creature identity is METADATA (monsterId), not a family. Shadow is a
 * rendering variant (shadowMode: embedded | none | separate), not a family.
 * Everything stays reference — nothing runtime-confirmed on this page.
 * Writes review entries into design/assets/asset-reviews.json (schema v3).
 *
 * Usage: node classify-happyvalley-monster.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inventoryPath = join(root, "design", "assets", "asset-inventory.json");
const reviewsPath = join(root, "design", "assets", "asset-reviews.json");

const PACK = "HappyValley";
const PREFIX = "reference/assets/maps/HappyValley/Mob/";

const MONSTERS = ["Black_grouse", "Boar", "Deer", "Fox", "Hare"];
const ID_OF = (name) => name.toLowerCase().replace(/ /g, "_");

// Per-monster animation sets (source-confirmed; do NOT infer attack for deer/fox/hare).
const ANIM_SET = {
  black_grouse: ["idle", "walk", "flight", "hurt", "death"],
  boar: ["idle", "walk", "run", "attack", "hurt", "death"],
  deer: ["idle", "walk", "run", "hurt", "death"],
  fox: ["idle", "walk", "run", "hurt", "death"],
  hare: ["idle", "walk", "run", "hurt", "death"],
};

// Canonical identity per animation (logical, shadow-agnostic).
function logicalCanonical(monId, anim) {
  return `monster_happyvalley_${monId}_${anim}`;
}

// Parse direction token from an aseprite filename (explicit in source names).
function dirFromName(fileName) {
  const n = fileName.replace(/\.aseprite$/i, "");
  const lower = n.toLowerCase();
  for (const d of ["back", "front", "left", "right"]) {
    if (lower.includes(`_${d}`)) return d;
    if (lower.includes(`${d}_`)) return d;
  }
  return null;
}

// Parse animation token from a sheet/asprite filename.
function animFromName(fileName) {
  const n = fileName.replace(/\.(png|aseprite)$/i, "");
  const lower = n.toLowerCase();
  for (const a of ["attack", "flight", "death", "hurt", "idle", "run", "walk"]) {
    if (lower.includes(`_${a}`) || lower.includes(`${a}_`)) return a;
  }
  return null;
}

const FAMILY_META = {
  happyvalley_monster_animation: {
    suggestedFamilyName: "HappyValley Monster Animation Sheets",
    monsterFamilyType: "animation",
    runtimeEligible: true,
    worldRole: "PVE_1_20",
    notes: "Creature animation sprite sheets (with/without shadow per animation). shadowMode is a RENDERING VARIANT (embedded | none), not a different family. Directions come from the Aseprite sources, not guessed from sheets. Spawnable entity resources — place via mob/entity definitions, not as level-decoration sprites. Entire package stays REFERENCE until runtime usage proves otherwise. Locked 2026-08-15.",
  },
  happyvalley_monster_shadow: {
    suggestedFamilyName: "HappyValley Monster Standalone Shadows",
    monsterFamilyType: "shadow",
    runtimeEligible: true,
    worldRole: "PVE_1_20",
    notes: "Standalone shadow sprites (shadowMode: separate). Runtime may choose either precomposited sheets (embedded) or render shadows separately (separate). Locked 2026-08-15.",
  },
  happyvalley_monster_source: {
    suggestedFamilyName: "HappyValley Monster Aseprite Sources",
    monsterFamilyType: "source",
    runtimeEligible: false,
    worldRole: "PVE_1_20",
    notes: "Aseprite authoring sources — the filenames establish DIRECTION EXPLICITLY (front/back/left/right), so direction metadata is deterministic without visual inference. Never runtime-eligible or placeable. Locked 2026-08-15.",
  },
  happyvalley_monster_tiled: {
    suggestedFamilyName: "HappyValley Monster Tiled Export",
    monsterFamilyType: "tiled",
    runtimeEligible: false,
    worldRole: "PVE_1_20",
    notes: "Tiled map editor export — Animals.tmx plus duplicate copies of the monster PNG sheets used in the PNG directories. The copied PNGs are NOT duplicate monster identities; each is marked duplicateOf its canonical sheet. runtimeEligible can be changed later if the runtime loads this TMX directly. Locked 2026-08-15.",
  },
  happyvalley_monster_system: {
    suggestedFamilyName: "HappyValley Monster System Files",
    monsterFamilyType: "system",
    runtimeEligible: false,
    worldRole: "PVE_1_20",
    notes: ".DS_Store macOS system files — catalogVisible false, not gameplay, not counted in family tallies. Locked 2026-08-15.",
  },
};

function classify(rel, file) {
  const fileName = rel.split("/").pop();
  const ext = file.extension;
  const base = { reviewStatus: "reviewed", runtimeStatus: "reference-only", monsterFamilyType: null };

  // --- System files ---
  if (fileName === ".DS_Store") {
    return {
      family: "happyvalley_monster_system",
      asset: {
        ...base,
        assetRole: "system-file",
        runtimeEligible: false,
        placeable: false,
        catalogVisible: false,
        displayName: "macOS system file",
        canonicalName: null,
        renameStatus: "keep",
        description: "macOS .DS_Store system file — provenance only, not a game asset.",
      },
    };
  }

  // --- Tiled section ---
  if (rel.startsWith("Tiled/")) {
    if (ext === ".tmx") {
      return {
        family: "happyvalley_monster_tiled",
        asset: {
          ...base,
          assetRole: "tiled-map",
          format: "tmx",
          sourceRole: "map-editor-map",
          runtimeEligible: false,
          placeable: false,
          displayName: "HappyValley Animals Tiled map",
          canonicalName: "tiled_happyvalley_animals_map",
          renameStatus: "keep",
          description: "Tiled map editor file (Animals.tmx) for the HappyValley animal pack.",
        },
      };
    }
    // Duplicate monster PNG inside Tiled/: find canonical of the main sheet it mirrors.
    const n = fileName.replace(/\.png$/i, "");
    const withShadow = /_with_shadow$/i.test(n);
    const baseName = n.replace(/_with_shadow$/i, "");
    const mon = MONSTERS.find((m) => baseName.toLowerCase().startsWith(m.toLowerCase()));
    if (!mon) return null;
    const monId = ID_OF(mon);
    const isShadow = /_shadow$/i.test(baseName);
    let duplicateOf;
    if (isShadow) duplicateOf = `monster_happyvalley_${monId}_shadow`;
    else {
      const anim = animFromName(baseName);
      if (!anim) return null;
      duplicateOf = logicalCanonical(monId, anim) + (withShadow ? "_with_shadow" : "");
    }
    return {
      family: "happyvalley_monster_tiled",
      asset: {
        ...base,
        assetRole: "tiled-resource",
        sourceRole: "map-editor-copy",
        monsterId: monId,
        duplicateOf,
        format: "png",
        runtimeEligible: false,
        placeable: false,
        displayName: `Tiled copy of ${duplicateOf}`,
        canonicalName: `tiled_copy_${n.toLowerCase().replace(/ /g, "_")}`,
        renameStatus: "keep",
        description: `Duplicate ${monId} PNG exported into the Tiled folder — same artwork as ${duplicateOf}, NOT a separate monster identity.`,
      },
    };
  }

  // --- PNG section (With_Shadow / Without_shadow) ---
  if (rel.startsWith("PNG/")) {
    const shadowDir = /^PNG\/(With_Shadow|Without_shadow)\//.exec(rel);
    if (!shadowDir) return null;
    const embedded = shadowDir[1] === "With_Shadow";
    const mon = MONSTERS.find((m) => rel.slice(shadowDir[0].length).startsWith(m));
    if (!mon) return null;
    const monId = ID_OF(mon);
    const relName = rel.slice(shadowDir[0].length + mon.length + 1);
    const n = relName.replace(/\.png$/i, "");

    // Standalone shadow sprite: remainder after the monster name is exactly Shadow
    const rest = n.slice(mon.length + 1);
    if (/^shadow$/i.test(rest)) {
      return {
        family: "happyvalley_monster_shadow",
        asset: {
          ...base,
          assetRole: "shadow",
          shadowMode: "separate",
          monsterId: monId,
          format: "png",
          runtimeEligible: true,
          placeable: false,
          displayName: `${mon} standalone shadow`,
          canonicalName: `monster_happyvalley_${monId}_shadow`,
          renameStatus: "keep",
          description: `Standalone shadow sprite for ${mon} (${file.width}x${file.height}).`,
        },
      };
    }

    const anim = animFromName(n);
    if (!anim) return null;
    const canonical = logicalCanonical(monId, anim) + (embedded ? "_with_shadow" : "");
    return {
      family: "happyvalley_monster_animation",
      asset: {
        ...base,
        assetRole: "animation-sheet",
        monsterId: monId,
        animation: anim,
        shadowMode: embedded ? "embedded" : "none",
        directions: ["front", "back", "left", "right"],
        format: "png",
        runtimeEligible: true,
        placeable: false,
        displayName: `${mon} ${anim}${embedded ? " (with shadow)" : ""}`,
        canonicalName: canonical,
        renameStatus: "keep",
        description: `${anim} animation sheet for ${mon} (${file.width}x${file.height}, ${embedded ? "shadow embedded" : "no shadow"}). Directions from the Aseprite sources: front/back/left/right.`,
      },
    };
  }

  // --- Aseprite section ---
  if (rel.startsWith("ASEPRITE/")) {
    const mon = MONSTERS.find((m) => rel.slice("ASEPRITE/".length).startsWith(m));
    if (!mon) return null;
    const monId = ID_OF(mon);
    const anim = animFromName(fileName);
    const dir = dirFromName(fileName);
    if (!anim || !dir) return null;
    return {
      family: "happyvalley_monster_source",
      asset: {
        ...base,
        assetRole: "authoring-source",
        sourceRole: "authoring-frame",
        format: "aseprite",
        monsterId: monId,
        animation: anim,
        direction: dir,
        runtimeEligible: false,
        placeable: false,
        displayName: `${mon} ${anim} ${dir} Aseprite source`,
        canonicalName: `source_happyvalley_${monId}_${anim}_${dir}`,
        renameStatus: "keep",
        description: `Aseprite authoring source — ${mon} ${anim}, ${dir} direction (direction explicit in filename).`,
      },
    };
  }

  return null;
}

async function main() {
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const reviews = JSON.parse(await readFile(reviewsPath, "utf8"));

  // Idempotent: remove previous HappyValley monster review families.
  for (const key of Object.keys(reviews.reviews)) {
    if (key.startsWith(`${PACK}/happyvalley_monster_`)) delete reviews.reviews[key];
  }

  const files = inventory.files.filter((f) => f.path.startsWith(PREFIX));
  const byFamily = {};
  let unclassified = 0;
  for (const f of files) {
    const rel = f.path.slice(PREFIX.length);
    const result = classify(rel, f);
    if (!result) {
      unclassified++;
      console.warn(`UNCLASSIFIED: ${f.path}`);
      continue;
    }
    const famAssets = (byFamily[result.family] = byFamily[result.family] || {});
    famAssets[f.path] = { ...result.asset };
  }

  for (const [familyKey, assets] of Object.entries(byFamily)) {
    const meta = FAMILY_META[familyKey];
    reviews.reviews[`${PACK}/${familyKey}`] = {
      familyKey,
      canonicalFamily: familyKey,
      suggestedFamilyName: meta.suggestedFamilyName,
      monsterFamilyType: meta.monsterFamilyType,
      runtimeEligible: meta.runtimeEligible,
      worldRole: meta.worldRole,
      notes: meta.notes,
      assets,
    };
  }

  const counts = Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, Object.keys(v).length]));
  const classified = files.length - unclassified;
  console.log(`[happyvalley-monster] ${classified}/${files.length} classified (${unclassified} unclassified)`);
  console.log(JSON.stringify(counts, null, 1));

  // Verify per-monster PNG sheet totals (57) and aseprite (104)
  const base = (f) => f.path.split("/").pop().replace(/\.png$/i, "");
  const isStandaloneShadow = (f) => {
    const mon = MONSTERS.find((m) => base(f).startsWith(m));
    return !!mon && /^shadow$/i.test(base(f).slice(mon.length + 1));
  };
  const shadows = files.filter((f) => f.extension === ".png" && /\/PNG\//.test(f.path) && isStandaloneShadow(f));
  const withShadow = files.filter((f) => f.extension === ".png" && /\/PNG\//.test(f.path) && /_with_shadow$/i.test(base(f)));
  const anim = files.filter((f) => f.extension === ".png" && /\/PNG\//.test(f.path) && !isStandaloneShadow(f) && !/_with_shadow$/i.test(base(f)));
  console.log(`without-shadow sheets: ${anim.length} + embedded-shadow sheets: ${withShadow.length} + standalone shadows: ${shadows.length} = ${anim.length + withShadow.length + shadows.length} primary PNG resources`);
  const aseprite = files.filter((f) => f.extension === ".aseprite").length;
  console.log(`aseprite sources: ${aseprite}`);

  reviews.generatedAt = new Date().toISOString();
  await writeFile(reviewsPath, JSON.stringify(reviews, null, 2) + "\n", "utf8");
  console.log("reviews written:", reviewsPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
