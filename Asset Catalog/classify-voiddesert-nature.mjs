#!/usr/bin/env node
/**
 * Deterministic classifier for the VoidDesert nature pack
 * (reference/assets/maps/VoidDesert/Map/PNG/stones_*.png + tree_*.png) — per ChatGPT audit.
 *
 * 24 source assets -> 6 semantic families:
 *   voiddesert_rock            6   natural standalone rocks
 *   voiddesert_cut_stone       2   cut sandstone pieces (wedge + block)
 *   voiddesert_stone_formation 1   stacked stone ring
 *   voiddesert_mesa            3   large geological formations (tiered/wide/irregular)
 *   voiddesert_palm            7   palm trees (twin_a, mature, young, tall_dry, ragged, leaning, twin_b)
 *   voiddesert_desert_tree     5   non-palm desert trees (broad, baobab, umbrella, dead ×2)
 *
 * KEY RULES per the audit:
 * - stones_2/3 are CUT STONE (sandstone), not natural rocks — never called "ruins".
 * - stones_4 is a STONE RING FORMATION, not a well (no water/bucket evidence).
 * - stones_10-12 are LANDMARK-scale mesa formations (occlusion candidates), not rocks.
 * - tree_1 vs tree_9 are genuine TWIN PALM VARIANTS (a/b) — not collapsed.
 * - tree_8 is baobab (extremely characteristic silhouette); tree_10 stays umbrella, not acacia.
 * - tree_11/12 are dead trees — handled via treeType: dead, not a 7th family.
 * - None are tiles — no tileMode/topology edges/corners. All transparent standalone overlays.
 * - Collision: trunk for trees (trunk footprint, not sprite rect/canopy), footprint for rocks/mesas.
 * - Everything stays reference — nothing runtime-confirmed on this page.
 * Writes review entries into design/assets/asset-reviews.json (schema v3).
 *
 * Usage: node classify-voiddesert-nature.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inventoryPath = join(root, "design", "assets", "asset-inventory.json");
const reviewsPath = join(root, "design", "assets", "asset-reviews.json");

const PACK = "VoidDesert";
const PREFIX = "reference/assets/maps/VoidDesert/Map/PNG/";

// stones_N -> { family, canonicalName, variant, extra }
const STONES = {
  stones_1: { family: "voiddesert_rock", canonicalName: "nature_voiddesert_rock_small_jagged", variant: "small-jagged", description: "Small pale jagged natural rock." },
  stones_2: { family: "voiddesert_cut_stone", canonicalName: "nature_voiddesert_cut_stone_wedge", variant: "wedge", description: "Roughly pyramidal/wedge-shaped cut sandstone piece. Cut stone is visually established; ruin would infer history/function not shown." },
  stones_3: { family: "voiddesert_cut_stone", canonicalName: "nature_voiddesert_cut_stone_block", variant: "block", description: "Squared sandstone block. Cut stone is visually established; ruin would infer history/function not shown." },
  stones_4: { family: "voiddesert_stone_formation", canonicalName: "nature_voiddesert_stone_ring", variant: "ring", description: "Substantial circular arrangement of stacked brown stones surrounding a recessed/open center. NOT a well — no water/bucket/architectural evidence." },
  stones_5: { family: "voiddesert_rock", canonicalName: "nature_voiddesert_rock_pointed", variant: "pointed", description: "Dark pointed natural rock." },
  stones_6: { family: "voiddesert_rock", canonicalName: "nature_voiddesert_boulder_cluster", variant: "boulder-cluster", description: "Large rounded boulder with a raised stone." },
  stones_7: { family: "voiddesert_rock", canonicalName: "nature_voiddesert_rock_smooth", variant: "smooth", description: "Small smooth rounded rock." },
  stones_8: { family: "voiddesert_rock", canonicalName: "nature_voiddesert_rock_long", variant: "long", description: "Elongated irregular rock." },
  stones_9: { family: "voiddesert_rock", canonicalName: "nature_voiddesert_rock_cluster", variant: "cluster", description: "Rounded rock with small satellite stones." },
  stones_10: { family: "voiddesert_mesa", canonicalName: "nature_voiddesert_mesa_tiered", variant: "tiered", description: "Tall two-tier desert rock/mesa formation. Landmark-scale world geometry." },
  stones_11: { family: "voiddesert_mesa", canonicalName: "nature_voiddesert_mesa_wide", variant: "wide", description: "Very wide low flat-topped mesa/plateau (widest asset in the pack). Landmark-scale world geometry." },
  stones_12: { family: "voiddesert_mesa", canonicalName: "nature_voiddesert_mesa_irregular", variant: "irregular", description: "Large irregular raised mesa with angular footprint. Landmark-scale world geometry." },
};

// tree_N -> { family, canonicalName, variant, treeType, description }
const TREES = {
  tree_1: { family: "voiddesert_palm", canonicalName: "nature_voiddesert_palm_twin_a", variant: "twin_a", treeType: "palm", description: "Twin bright-green palms growing from a shared V-shaped base." },
  tree_2: { family: "voiddesert_palm", canonicalName: "nature_voiddesert_palm_mature", variant: "mature", treeType: "palm", description: "Large mature curved-trunk palm." },
  tree_3: { family: "voiddesert_palm", canonicalName: "nature_voiddesert_palm_young", variant: "young", treeType: "palm", description: "Smaller bent/young palm." },
  tree_4: { family: "voiddesert_palm", canonicalName: "nature_voiddesert_palm_tall_dry", variant: "tall_dry", treeType: "palm", description: "Very tall narrow palm with yellow/olive foliage." },
  tree_5: { family: "voiddesert_palm", canonicalName: "nature_voiddesert_palm_ragged", variant: "ragged", treeType: "palm", description: "Curved trunk with rough/drooping foliage." },
  tree_6: { family: "voiddesert_palm", canonicalName: "nature_voiddesert_palm_leaning", variant: "leaning", treeType: "palm", description: "Strongly leaning palm." },
  tree_7: { family: "voiddesert_desert_tree", canonicalName: "nature_voiddesert_tree_broad", variant: "default", treeType: "broad", description: "Short, broad, densely crowned tree with a thick exposed trunk/root structure." },
  tree_8: { family: "voiddesert_desert_tree", canonicalName: "nature_voiddesert_baobab", variant: "default", treeType: "baobab", description: "Baobab-like tree — enormous swollen trunk with compact canopy. Silhouette is extremely characteristic." },
  tree_9: { family: "voiddesert_palm", canonicalName: "nature_voiddesert_palm_twin_b", variant: "twin_b", treeType: "palm", description: "Twin-trunk palm, considerably larger/taller than twin_a with a different silhouette — genuine variant, not collapsed." },
  tree_10: { family: "voiddesert_desert_tree", canonicalName: "nature_voiddesert_tree_umbrella", variant: "default", treeType: "umbrella", description: "Small flat umbrella-canopy desert tree (acacia-like). Kept as umbrella, not asserted as a botanical species." },
  tree_11: { family: "voiddesert_desert_tree", canonicalName: "nature_voiddesert_dead_tree_large", variant: "large", treeType: "dead", description: "Large leafless dead tree with many cut/broken branches." },
  tree_12: { family: "voiddesert_desert_tree", canonicalName: "nature_voiddesert_dead_tree_twisted", variant: "twisted", treeType: "dead", description: "Dark, twisted leafless tree." },
};

const FAMILY_META = {
  voiddesert_rock: {
    suggestedFamilyName: "Desert Rocks",
    natureFamilyType: "rock",
    worldRole: "PVE_1_20",
    notes: "6 natural standalone rock silhouettes (small-jagged, pointed, boulder-cluster, smooth, long, cluster) — genuinely distinct shapes, NOT reduced to rock_a-f. collision: footprint, walkable: false. placementMode: manual, topology: standalone. Locked 2026-08-15.",
  },
  voiddesert_cut_stone: {
    suggestedFamilyName: "Cut Stone Blocks",
    natureFamilyType: "cut-stone",
    worldRole: "PVE_1_20",
    notes: "2 cut sandstone pieces — wedge + block. CUT STONE is visually established (material: sandstone); deliberately NOT called ruins — ruin would infer history/function that isn't shown. placementMode: manual, topology: standalone. Locked 2026-08-15.",
  },
  voiddesert_stone_formation: {
    suggestedFamilyName: "Stone Ring Formation",
    natureFamilyType: "stone-formation",
    worldRole: "PVE_1_20",
    notes: "1 circular stacked-stone ring surrounding a recessed/open center. NOT a well — no visible water, bucket, or architectural evidence proving that function. formationType: ring, collision: footprint. Locked 2026-08-15.",
  },
  voiddesert_mesa: {
    suggestedFamilyName: "Desert Mesa Formations",
    natureFamilyType: "mesa",
    worldRole: "PVE_1_20",
    notes: "3 huge orange/brown geological formations (tiered, wide, irregular) — landmark-scale world geometry, NOT ground clutter. scaleClass: landmark, occlusion: true recommended. walkable: false, collision: footprint. NOT tiles — no tileMode/topology. Locked 2026-08-15.",
  },
  voiddesert_palm: {
    suggestedFamilyName: "Desert Palms",
    natureFamilyType: "palm",
    worldRole: "PVE_1_20",
    notes: "7 palm trees — twin_a + twin_b preserved as genuine variants (different silhouettes), mature, young, tall_dry, ragged, leaning. collision: trunk (trunk footprint, NOT the transparent sprite rectangle/canopy), walkable: false. Locked 2026-08-15.",
  },
  voiddesert_desert_tree: {
    suggestedFamilyName: "Desert Trees",
    natureFamilyType: "desert-tree",
    worldRole: "PVE_1_20",
    notes: "5 non-palm desert trees — broad, baobab (extremely characteristic silhouette), umbrella (kept conservative, not acacia), dead-large, dead-twisted. Dead trees handled via treeType: dead rather than a 7th family. collision: trunk, walkable: false. Locked 2026-08-15.",
  },
};

function classify(rel, file) {
  const fileName = rel.split("/").pop();
  const name = fileName.replace(/\.png$/i, "");
  const base = {
    reviewStatus: "reviewed",
    runtimeStatus: "reference-only",
    assetRole: "nature",
    worldRole: "PVE_1_20",
    placementMode: "manual",
    topology: "standalone",
    runtimeEligible: true,
    placeable: false,
    renameStatus: "keep",
  };
  const stone = STONES[name];
  if (stone) {
    const meta = FAMILY_META[stone.family];
    const fam = stone.family;
    const isMesa = fam === "voiddesert_mesa";
    const isRock = fam === "voiddesert_rock";
    const isCut = fam === "voiddesert_cut_stone";
    const isRing = fam === "voiddesert_stone_formation";
    const familyType = meta.natureFamilyType;
    const displayName = stone.canonicalName.replace(/^nature_voiddesert_/, "").replace(/_/g, " ");
    return {
      family: fam,
      asset: {
        ...base,
        natureFamilyType: familyType,
        natureRole: isMesa ? "rock-formation" : isCut ? "cut-stone" : isRing ? "stone-formation" : "rock",
        formationType: isMesa ? stone.variant : isRing ? "ring" : null,
        material: isCut ? "sandstone" : null,
        scaleClass: isMesa ? "landmark" : null,
        occlusion: isMesa ? true : null,
        variant: stone.variant,
        collision: isRock || isMesa || isCut || isRing ? "footprint" : "trunk",
        walkable: false,
        displayName,
        canonicalName: stone.canonicalName,
        description: stone.description,
      },
    };
  }
  const tree = TREES[name];
  if (tree) {
    const isPalm = tree.family === "voiddesert_palm";
    const displayName = tree.canonicalName.replace(/^nature_voiddesert_/, "").replace(/_/g, " ");
    return {
      family: tree.family,
      asset: {
        ...base,
        natureFamilyType: FAMILY_META[tree.family].natureFamilyType,
        natureRole: "tree",
        treeType: tree.treeType,
        variant: tree.variant,
        collision: "trunk",
        walkable: false,
        displayName,
        canonicalName: tree.canonicalName,
        description: tree.description,
      },
    };
  }
  return null;
}

async function main() {
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const reviews = JSON.parse(await readFile(reviewsPath, "utf8"));

  // Idempotent: remove previous VoidDesert NATURE review families only (never touch the
  // map families owned by classify-voiddesert-other.mjs: ground/stone_road/building/decor/
  // cactus/dry_grass/water/preview/source).
  const OWNED = Object.keys(FAMILY_META);
  for (const key of Object.keys(reviews.reviews)) {
    if (key.startsWith(`${PACK}/`) && OWNED.includes(key.split("/")[1])) delete reviews.reviews[key];
  }

  const files = inventory.files.filter((f) => f.path.startsWith(PREFIX) && /\.png$/i.test(f.path) && /^(stones|tree)_\d+\.png$/i.test(f.path.split("/").pop()));
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
      natureFamilyType: meta.natureFamilyType,
      worldRole: meta.worldRole,
      notes: meta.notes,
      assets,
    };
  }

  const counts = Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, Object.keys(v).length]));
  const classified = files.length - unclassified;
  console.log(`[voiddesert-nature] ${classified}/${files.length} classified (${unclassified} unclassified)`);
  console.log(JSON.stringify(counts, null, 1));

  // Verify: 6 + 2 + 1 + 3 + 7 + 5 = 24
  const expected = { voiddesert_rock: 6, voiddesert_cut_stone: 2, voiddesert_stone_formation: 1, voiddesert_mesa: 3, voiddesert_palm: 7, voiddesert_desert_tree: 5 };
  const ok = Object.keys(expected).every((k) => counts[k] === expected[k]) && classified === 24;
  console.log(ok ? "✓ 24/24 classified, counts match audit (6+2+1+3+7+5)" : "✗ COUNT MISMATCH");

  reviews.generatedAt = new Date().toISOString();
  await writeFile(reviewsPath, JSON.stringify(reviews, null, 2) + "\n", "utf8");
  console.log("reviews written:", reviewsPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
