#!/usr/bin/env node
/**
 * Classifies the Undead Loot Vector Icons pack (reference/assets/loot).
 *
 * Per the ChatGPT loot audit (2026-08-15): the 146 files are NOT 146 loot
 * items — they are **48 logical loot icons**, each supplied as a shadow PNG +
 * without-shadow PNG (render variants) + EPS authoring source, plus one AI
 * master and one support PNG (bg.png).
 *
 * Icon → identity mapping follows the audit's confirmed catalog (undead/bone
 * drops first, then valuables, currency, consumables, materials, quest items,
 * equipment). Numbered icons whose specific subtype is not positively
 * identified get a conservative family assignment with `confirmed: false` so
 * a later visual pass can tighten them without reworking the structure.
 *
 * Writes review entries into design/assets/asset-reviews.json (schema v3).
 * Usage: node classify-loot.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inventoryPath = join(root, "design", "assets", "asset-inventory.json");
const reviewsPath = join(root, "design", "assets", "asset-reviews.json");

const PREFIX = "reference/assets/loot";

// Icon number → { family, subtype, confirmed }
// Order follows the audit's walk through the artwork: undead/bone pieces,
// then jewelry/valuables, currency, consumables, materials, quest items,
// equipment.
const LOOT_ROLES = {
  1:  { family: "undead_bone", subtype: "skull_human", confirmed: true },
  2:  { family: "undead_bone", subtype: "long_bone", confirmed: true },
  3:  { family: "undead_bone", subtype: "jawbone", confirmed: true },
  4:  { family: "undead_bone", subtype: "skeletal_limb", confirmed: true },
  5:  { family: "undead_bone", subtype: "skeletal_hand", confirmed: true },
  6:  { family: "undead_bone", subtype: "broken_bone", confirmed: true },
  7:  { family: "undead_bone", subtype: "rib_cage", confirmed: true },
  8:  { family: "undead_bone", subtype: "teeth_fangs", confirmed: true },
  9:  { family: "undead_bone", subtype: "animal_skull", confirmed: true },
  10: { family: "undead_body_part", subtype: "foot", confirmed: true },
  11: { family: "undead_body_part", subtype: "arm", confirmed: true },
  12: { family: "undead_body_part", subtype: "paired_hands", confirmed: true },
  13: { family: "undead_organ", subtype: "eyeball", confirmed: true },
  14: { family: "undead_organ", subtype: "brain", confirmed: true },
  15: { family: "undead_bone", subtype: "animal_skull_antlered", confirmed: true },
  16: { family: "undead_bone", subtype: "predator_jaw", confirmed: true },
  17: { family: "jewelry", subtype: "amulet_purple", confirmed: true },
  18: { family: "jewelry", subtype: "ring_gemstone", confirmed: true },
  19: { family: "jewelry", subtype: "crown", confirmed: true },
  20: { family: "jewelry", subtype: "pendant", confirmed: true },
  21: { family: "jewelry", subtype: "gem_green", confirmed: true },
  22: { family: "jewelry", subtype: "gem_blue", confirmed: true },
  23: { family: "jewelry", subtype: "necklace_bone", confirmed: true },
  24: { family: "jewelry", subtype: "token_coin", confirmed: true },
  25: { family: "currency", subtype: "coin_bag", confirmed: true },
  26: { family: "currency", subtype: "token", confirmed: true },
  27: { family: "consumable", subtype: "potion_red", confirmed: true },
  28: { family: "consumable", subtype: "vial_green", confirmed: true },
  29: { family: "material", subtype: "sticks_wood", confirmed: true },
  30: { family: "material", subtype: "rolled_hide", confirmed: true },
  31: { family: "material", subtype: "organic_piece", confirmed: false },
  32: { family: "material", subtype: "bone_fragment", confirmed: false },
  33: { family: "quest_item", subtype: "book", confirmed: true },
  34: { family: "quest_item", subtype: "document_torn", confirmed: true },
  35: { family: "quest_item", subtype: "key", confirmed: true },
  36: { family: "quest_item", subtype: "letter_sealed", confirmed: true },
  37: { family: "quest_item", subtype: "scroll", confirmed: true },
  38: { family: "quest_item", subtype: "candle_skull", confirmed: true },
  39: { family: "quest_item", subtype: "candles", confirmed: true },
  40: { family: "equipment", subtype: "helmet", confirmed: true },
  41: { family: "equipment", subtype: "gloves", confirmed: true },
  42: { family: "equipment", subtype: "boot", confirmed: true },
  43: { family: "equipment", subtype: "dagger", confirmed: true },
  44: { family: "equipment", subtype: "arrow_broken", confirmed: true, note: "broken arrow — loot/salvage, not equippable ammo" },
  45: { family: "undead_organ", subtype: "organ_piece", confirmed: false },
  46: { family: "undead_bone", subtype: "bone_cluster", confirmed: false },
  47: { family: "material", subtype: "monster_material", confirmed: false },
  48: { family: "material", subtype: "monster_trophy", confirmed: false },
};

const FAMILY_NAMES = {
  undead_bone: "Undead Bone & Skull Drops",
  undead_body_part: "Undead Body Parts",
  undead_organ: "Undead Organs",
  jewelry: "Jewelry & Valuables",
  currency: "Currency",
  consumable: "Consumables",
  material: "Crafting Materials",
  quest_item: "Quest & Key Items",
  equipment: "Equipment",
  loot_source: "Authoring & Support",
};

const FAMILY_NOTES = {
  undead_bone: "Skulls, long bones, jaws, ribs, teeth/fangs, animal skulls — monster-drop materials and necromantic ingredients. ~14 icons.",
  undead_body_part: "Severed/undead limbs — foot, arm, paired hands. Monster-drop trophies.",
  undead_organ: "Eyeball, brain, organ pieces — dark/necromantic material drops.",
  jewelry: "Amulets, gemstone ring, crown, pendants, green/blue gems, bone necklace, coin-token — starting accessory vocabulary.",
  currency: "Coin bag + token — normal money and alternate/dungeon currency.",
  consumable: "Red potion + green vial — health potion and buff/antidote/resource via data. Thin set: 2–4 more silhouettes recommended.",
  material: "Sticks, rolled hide, organic pieces, bone fragments, monster material/trophy — crafting-material base. Ore/herb/cloth still missing.",
  quest_item: "Book, torn document, key, sealed letter, scroll, skull candle, candles — strong quest/key-item vocabulary.",
  equipment: "Helmet, gloves, boot, dagger, broken arrow — the pack's weak area: no class weapons (bow/staff/sword), no chest armor, no shields.",
  loot_source: "AI master + bg.png support — provenance, not gameplay.",
};

const FALLBACK = { family: "uncategorized", subtype: "misc", confirmed: false };

async function main() {
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const files = inventory.files.filter((f) => f.path.startsWith(PREFIX));

  const reviews = JSON.parse(await readFile(reviewsPath, "utf8"));
  // Idempotent: remove previous loot-family reviews.
  for (const key of Object.keys(reviews.reviews)) {
    if (key.startsWith("loot/")) delete reviews.reviews[key];
  }

  const byFamily = {};
  for (const f of files) {
    const rel = f.path.slice(PREFIX.length + 1);
    const parts = rel.split("/");
    let role = { ...FALLBACK };
    let lootIconId = null;
    let renderMode = null;
    let assetRole = null;
    let canonicalName = null;
    let displayName = null;
    let note = null;

    if (rel === "AI/Undead_Loot _Vector_Icons.ai") {
      role = { family: "loot_source", subtype: "ai_master", confirmed: true };
      assetRole = "authoring-master";
      canonicalName = "source_undead_loot_vector_icons_ai";
      displayName = "Undead Loot Vector Icons — Illustrator master";
      note = "Authoring master for the whole icon set — provenance, not gameplay.";
    } else if (rel === "PNG/bg.png") {
      role = { family: "loot_source", subtype: "bg_support", confirmed: true };
      assetRole = "background-support";
      canonicalName = "loot_bg_support";
      displayName = "Loot pack background/support";
      note = "256×256 support image — not a loot item.";
    } else if (parts[0] === "PNG" && parts[1] === "without_shadow") {
      const num = parseInt(parts[2], 10);
      if (!Number.isNaN(num) && LOOT_ROLES[num]) {
        role = LOOT_ROLES[num];
        lootIconId = `loot_${String(num).padStart(2, "0")}`;
        renderMode = "without_shadow";
        assetRole = "loot-icon";
        canonicalName = `loot_${role.family}_${role.subtype}`;
        displayName = `Undead loot — ${role.subtype.replace(/_/g, " ")}`;
      }
    } else if (parts[0] === "PNG" && parts[1] === "shadow") {
      const num = parseInt(parts[2], 10);
      if (!Number.isNaN(num) && LOOT_ROLES[num]) {
        role = LOOT_ROLES[num];
        lootIconId = `loot_${String(num).padStart(2, "0")}`;
        renderMode = "shadow";
        assetRole = "loot-icon";
        canonicalName = `loot_${role.family}_${role.subtype}`;
        displayName = `Undead loot — ${role.subtype.replace(/_/g, " ")}`;
      }
    } else if (parts[0] === "EPS") {
      // EPS filenames: Undead_Loot _Vector_Icons-01.eps … -48.eps
      const num = parseInt(parts[1].match(/-(\d+)\.eps$/i)?.[1] ?? parts[1], 10);
      if (!Number.isNaN(num) && LOOT_ROLES[num]) {
        role = LOOT_ROLES[num];
        lootIconId = `loot_${String(num).padStart(2, "0")}`;
        renderMode = "source";
        assetRole = "authoring-source";
        canonicalName = `loot_${role.family}_${role.subtype}_src`;
        displayName = `Undead loot — ${role.subtype.replace(/_/g, " ")} (EPS source)`;
      }
    }

    if (!canonicalName) continue;

    const familyKey = role.family;
    const entry = {
      canonicalName,
      displayName,
      assetRole,
      lootRole: familyKey,
      lootSubtype: role.subtype,
      lootIconId,
      renderMode,
      lootConfirmed: role.confirmed ?? false,
      reviewStatus: "reviewed",
      runtimeStatus: "reference",
      placeable: false,
      runtimeEligible: assetRole === "loot-icon",
      notes: note ?? `Loot icon ${familyKey}·${role.subtype}${role.confirmed ? "" : " (candidate assignment — pending visual pass)"}.${role.note ? ` ${role.note}` : ""}`,
    };

    if (!byFamily[familyKey]) byFamily[familyKey] = { canonicalFamily: familyKey, suggestedFamilyName: FAMILY_NAMES[familyKey], notes: FAMILY_NOTES[familyKey], status: "cataloged", catalogStatus: "CLASSIFIED", assets: {} };
    byFamily[familyKey].assets[f.path] = entry;
  }

  // Family tally fields
  for (const [familyKey, fam] of Object.entries(byFamily)) {
    const famAssets = Object.values(fam.assets);
    const icons = [...new Set(famAssets.map((a) => a.lootIconId).filter(Boolean))];
    fam.iconCount = icons.length;
    fam.assetCount = famAssets.length;
    fam.renderModes = [...new Set(famAssets.map((a) => a.renderMode).filter(Boolean))];
    fam.catalogSummary = `${icons.length} logical icon${icons.length === 1 ? "" : "s"} · ${famAssets.length} source records (shadow + without-shadow + EPS per icon)`;
  }

  for (const [familyKey, fam] of Object.entries(byFamily)) {
    reviews.reviews[`loot/${familyKey}`] = fam;
  }

  await writeFile(reviewsPath, JSON.stringify(reviews, null, 2) + "\n", "utf8");

  const totalRecords = Object.values(byFamily).reduce((s, f) => s + Object.keys(f.assets).length, 0);
  const totalIcons = Object.values(byFamily).reduce((s, f) => s + (f.iconCount ?? 0), 0);
  console.log(`loot classified: ${totalRecords} records across ${Object.keys(byFamily).length} families, ${totalIcons} logical icons`);
  for (const [f, fam] of Object.entries(byFamily)) {
    console.log(`  ${f}: ${fam.iconCount} icons / ${Object.keys(fam.assets).length} records`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
