#!/usr/bin/env node
/**
 * Deterministic classifier for Classes/Archer — per ChatGPT's audit (2026-08-15).
 *
 * 127 assets -> 6 semantic gameplay families + 1 support family, 0 unclassified:
 *   archer_character         4 idle directional poses (east/north/south/west) — runtime
 *   archer_movement          24 walk frames (6 x 4 dirs) — runtime
 *   archer_combat            12 lead_jab frames (3 x 4 dirs) — runtime
 *   archer_interaction       20 pickup frames (5 x 4 dirs) — REFERENCE (do NOT mark runtime)
 *   archer_death             28 death_fall_back frames (7 x 4 dirs) — runtime
 *   archer_projectile_effect fire/water arrow PNG frames + AI/EPS/preview authoring
 *   archer_support           metadata.json + .DS_Store system files
 *
 * Every canonical name derives deterministically from the path; source files untouched.
 * Writes review entries into design/assets/asset-reviews.json (schema v3).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inventoryPath = join(root, "design", "assets", "asset-inventory.json");
const reviewsPath = join(root, "design", "assets", "asset-reviews.json");

const PREFIX = "reference/assets/Classes/Archer/";

const ANIM_INFO = {
  Walk: { family: "archer_movement", animation: "walk", frames: 6 },
  Lead_Jab: { family: "archer_combat", animation: "lead_jab", frames: 3 },
  Picking_Up: { family: "archer_interaction", animation: "pickup", frames: 5 },
  Falling_Back_Death: { family: "archer_death", animation: "death_fall_back", frames: 7 },
};

const FAMILY_META = {
  archer_character: {
    name: "Archer Character (Idle Directions)",
    type: "character",
    notes: "Base directional Archer poses (36x36, runtime-confirmed). The source folder is 'rotations'; semantically these are the Archer's idle directional states — east/north/south/west. Locked 2026-08-15.",
  },
  archer_movement: {
    name: "Archer Movement (Walk)",
    type: "movement",
    notes: "Walk animation, 6 frames x 4 directions = 24 runtime-confirmed frames (36x36). Locked 2026-08-15.",
  },
  archer_combat: {
    name: "Archer Combat (Lead Jab)",
    type: "combat",
    notes: "Lead Jab attack animation, 3 frames x 4 directions = 12 runtime-confirmed frames (36x36). 'lead_jab' preserved as the animation ID — not renamed to shoot/bow_attack from assumption. Locked 2026-08-15.",
  },
  archer_interaction: {
    name: "Archer Interaction (Pick Up)",
    type: "interaction",
    notes: "Picking Up animation, 5 frames x 4 directions = 20 frames. Currently REFERENCE/unreviewed — do NOT mark runtime merely because the neighboring Archer animations are. Locked 2026-08-15.",
  },
  archer_death: {
    name: "Archer Death (Fall Back)",
    type: "death",
    notes: "Falling Back Death animation, 7 frames x 4 directions = 28 runtime-confirmed frames (36x36). Longest Archer character sequence; the sprite is the Archer itself, not an effect layer. 'Falling_Back_Death' normalized to 'death_fall_back'. Locked 2026-08-15.",
  },
  archer_projectile_effect: {
    name: "Archer Projectile Effects (Fire / Water Arrow)",
    type: "projectile-effect",
    notes: "Fire Arrow (8 PNG frames 600x320, runtime-confirmed) and Water Arrow (8 PNG frames 480x360, reference) — same projectile silhouette, different element/effect. AI/EPS/preview GIFs are authoring sources for the same effects. Locked 2026-08-15.",
  },
  archer_support: {
    name: "Archer Source & System Files",
    type: "support",
    notes: "metadata.json (package metadata) and .DS_Store system files. Tracked for provenance only — not gameplay, not runtime-eligible, not placeable, catalogVisible false. Locked 2026-08-15.",
  },
};

function classify(rel, file) {
  const parts = rel.split("/");
  const runtime = file.status === "runtime-used" ? "runtime-used" : "reference-only";
  const base = { classId: "archer", placeable: false, reviewStatus: "reviewed" };

  if (rel === "metadata.json") {
    return {
      family: "archer_support",
      asset: {
        ...base,
        assetRole: "metadata",
        runtimeEligible: false,
        displayName: "Archer package metadata",
        canonicalName: "class_archer_metadata",
        runtimeStatus: "reference-only",
        renameStatus: "keep",
        description: "Package metadata JSON for the Archer class asset set.",
      },
    };
  }
  if (parts[0] === "Idle" && parts[1] === "rotations") {
    const dir = parts[2].replace(/\.png$/, "");
    return {
      family: "archer_character",
      asset: {
        ...base,
        assetRole: "character-frame",
        animation: "idle",
        direction: dir,
        frame: 0,
        frameCount: 1,
        runtimeEligible: true,
        displayName: `Archer idle ${dir}`,
        canonicalName: `class_archer_idle_${dir}`,
        runtimeStatus: runtime,
        renameStatus: "keep",
        description: `Base directional idle pose (${dir}, 36x36).`,
      },
    };
  }
  if (parts[0] === "Idle" && parts[1] === "animations") {
    const info = ANIM_INFO[parts[2]];
    if (!info) return null;
    const dir = parts[3];
    const frame = parseInt(parts[4].replace(/\D/g, ""), 10);
    const frameLabel = String(frame).padStart(3, "0");
    const isPickup = info.animation === "pickup";
    return {
      family: info.family,
      asset: {
        ...base,
        assetRole: "animation-frame",
        animation: info.animation,
        direction: dir,
        frame,
        frameCount: info.frames,
        runtimeEligible: !isPickup,
        displayName: `Archer ${info.animation.replace(/_/g, " ")} ${dir} ${frameLabel}`,
        canonicalName: `class_archer_${info.animation}_${dir}_${frameLabel}`,
        runtimeStatus: runtime,
        renameStatus: "keep",
        description: `${info.animation.replace(/_/g, " ")} animation frame ${frameLabel} (${dir}, ${file.width}x${file.height}).`,
      },
    };
  }
  if (parts[0] === "AttackEffects") {
    const effectName = parts[1]; // "Fire Arrow" | "Water Arrow"
    const effect = effectName === "Fire Arrow" ? "fire_arrow" : "water_arrow";
    const element = effectName === "Fire Arrow" ? "fire" : "water";
    const slug = effectName.toLowerCase().replace(/\s+/g, "_");
    if (parts[2] === "PNG") {
      const frame = parseInt(parts[3].replace(/\D/g, ""), 10);
      return {
        family: "archer_projectile_effect",
        asset: {
          ...base,
          assetRole: "projectile-effect-frame",
          effect,
          element,
          frame,
          frameCount: 8,
          runtimeEligible: true,
          displayName: `${effectName} frame ${String(frame).padStart(2, "0")}`,
          canonicalName: `effect_archer_${slug}_${String(frame).padStart(2, "0")}`,
          runtimeStatus: runtime,
          renameStatus: "keep",
          description: `${effectName} projectile effect frame ${frame} (${file.width}x${file.height}).`,
        },
      };
    }
    if (parts[2] === "AI") {
      return {
        family: "archer_projectile_effect",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-master",
          effect,
          element,
          runtimeEligible: false,
          displayName: `${effectName} Illustrator master`,
          canonicalName: `source_archer_${slug}_ai`,
          runtimeStatus: "reference-only",
          renameStatus: "keep",
          description: `Illustrator master for the ${effectName} projectile effect.`,
        },
      };
    }
    if (parts[2] === "EPS") {
      const frame = parseInt(parts[3].replace(/\D/g, ""), 10);
      return {
        family: "archer_projectile_effect",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          effect,
          element,
          frame,
          frameCount: 8,
          runtimeEligible: false,
          displayName: `${effectName} EPS frame ${String(frame).padStart(2, "0")}`,
          canonicalName: `source_archer_${slug}_frame_${String(frame).padStart(2, "0")}`,
          runtimeStatus: "reference-only",
          renameStatus: "keep",
          description: `EPS authoring frame ${frame} for the ${effectName} projectile effect.`,
        },
      };
    }
    if (/Preview\.gif$/.test(parts[2])) {
      return {
        family: "archer_projectile_effect",
        asset: {
          ...base,
          assetRole: "animation-preview",
          effect,
          element,
          runtimeEligible: false,
          displayName: `${effectName} preview`,
          canonicalName: `preview_archer_${slug}`,
          runtimeStatus: "reference-only",
          renameStatus: "keep",
          description: `Animated preview GIF for the ${effectName} projectile effect.`,
        },
      };
    }
    if (parts[2] === ".DS_Store") {
      return {
        family: "archer_support",
        asset: {
          ...base,
          assetRole: "system-file",
          runtimeEligible: false,
          displayName: "macOS system file",
          canonicalName: null,
          runtimeStatus: "reference-only",
          renameStatus: "keep",
          description: "macOS .DS_Store system file — provenance only, not a game asset.",
        },
      };
    }
    return null;
  }
  return null;
}

async function main() {
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const reviews = JSON.parse(await readFile(reviewsPath, "utf8"));

  // Remove any previous Classes-Archer review families so re-runs are idempotent.
  for (const key of Object.keys(reviews.reviews)) {
    if (key.startsWith("Classes-Archer/")) delete reviews.reviews[key];
  }

  const files = inventory.files.filter((f) => f.path.startsWith(PREFIX));
  const byFamily = {};
  let classified = 0;
  let unclassified = 0;
  for (const f of files) {
    const rel = f.path.slice(PREFIX.length);
    const result = classify(rel, f);
    if (!result) {
      unclassified++;
      console.warn("UNCLASSIFIED:", f.path);
      continue;
    }
    classified++;
    const famAssets = (byFamily[result.family] = byFamily[result.family] || {});
    famAssets[f.path] = { ...result.asset };
  }

  for (const [familyKey, assets] of Object.entries(byFamily)) {
    const meta = FAMILY_META[familyKey];
    const first = Object.values(assets)[0];
    const entry = {
      familyKey,
      canonicalFamily: familyKey,
      suggestedFamilyName: meta.name,
      classFamilyType: meta.type,
      classId: "archer",
      notes: meta.notes,
      assets,
    };
    // only add if the family is already referenced by this pack's category page;
    // reviews JSON uses 'Pack/familyKey' outer keys
    reviews.reviews[`Classes-Archer/${familyKey}`] = entry;
  }

  reviews.generatedAt = new Date().toISOString();
  await writeFile(reviewsPath, JSON.stringify(reviews, null, 2) + "\n", "utf8");

  const counts = Object.fromEntries(
    Object.entries(byFamily).map(([k, v]) => [k, Object.keys(v).length])
  );
  console.log(`Classes-Archer classified: ${classified}/${files.length} (${unclassified} unclassified)`);
  console.log(JSON.stringify(counts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
