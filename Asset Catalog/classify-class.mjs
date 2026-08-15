#!/usr/bin/env node
/**
 * Generalized deterministic classifier for playable-class asset sets
 * (Classes/Archer, Classes/Mage, Classes/Warrior...) — per ChatGPT audits.
 *
 * Each class package is two systems:
 *   1. The character animation set (Idle/rotations + Idle/animations/*)
 *   2. The effect package (AttackEffects/<Effect>/PNG|AI|EPS|Preview|.DS_Store)
 *
 * Semantic families per class:
 *   <class>_character      4 idle directional poses (east/north/south/west)
 *   <class>_movement       walk animation (6 x 4 dirs)
 *   <class>_combat         lead_jab animation (3 x 4 dirs)
 *   <class>_interaction    pickup animation (5 x 4 dirs) — REFERENCE, never promoted
 *   <class>_death          death_fall_back animation (7 x 4 dirs)
 *   <class>_spell_effect / _projectile_effect   effect PNG frames + AI/EPS/GIF authoring
 *   <class>_support        metadata.json + .DS_Store system files
 *
 * Every canonical name derives deterministically from the path; source files untouched.
 * Writes review entries into design/assets/asset-reviews.json (schema v3).
 *
 * Usage: node classify-class.mjs [class1 class2 ...]   (default: all configured classes)
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inventoryPath = join(root, "design", "assets", "asset-inventory.json");
const reviewsPath = join(root, "design", "assets", "asset-reviews.json");

const ANIM_INFO = {
  Walk: { familySuffix: "movement", animation: "walk", frames: 6 },
  Lead_Jab: { familySuffix: "combat", animation: "lead_jab", frames: 3 },
  Picking_Up: { familySuffix: "interaction", animation: "pickup", frames: 5 },
  Falling_Back_Death: { familySuffix: "death", animation: "death_fall_back", frames: 7 },
};

const CLASS_CONFIG = {
  archer: {
    pack: "Classes-Archer",
    prefix: "reference/assets/Classes/Archer/",
    effectFamily: "archer_projectile_effect",
    effectFamilyType: "projectile-effect",
    effectRole: "projectile-effect-frame",
    effects: {
      "Fire Arrow": { effect: "fire_arrow", element: "fire" },
      "Water Arrow": { effect: "water_arrow", element: "water" },
    },
  },
  mage: {
    pack: "Classes-Mage",
    prefix: "reference/assets/Classes/Mage/",
    effectFamily: "mage_spell_effect",
    effectFamilyType: "spell-effect",
    effectRole: "spell-effect-frame",
    effects: {
      "Fire Ball": { effect: "fire_ball", element: "fire", effectType: "projectile", shape: "ball" },
      "Fire Spell": { effect: "fire_spell", element: "fire", effectType: "spell", shape: "spell" },
      "Water Ball": { effect: "water_ball", element: "water", effectType: "projectile", shape: "ball" },
      "Water Spell": { effect: "water_spell", element: "water", effectType: "spell", shape: "spell" },
    },
  },
  warrior: {
    pack: "Classes-Warrior",
    prefix: "reference/assets/Classes/Warrior/",
    effectFamily: "warrior_slash_effect",
    effectFamilyType: "slash-effect",
    effectRole: "melee-effect-frame",
    effectMode: "numbered-variants",
    effect: "slash",
    effectSourceName: "Slash_sprite_effects",
  },
};

const FAMILY_TYPE_NAMES = {
  character: "Character (Idle Directions)",
  movement: "Movement (Walk)",
  combat: "Combat (Lead Jab)",
  interaction: "Interaction (Pick Up)",
  death: "Death (Fall Back)",
};

function familyMeta(cls, familyKey) {
  const cfg = CLASS_CONFIG[cls];
  if (familyKey === `${cls}_support`) {
    return {
      name: `${cls[0].toUpperCase()}${cls.slice(1)} Source & System Files`,
      type: "support",
      notes: "metadata.json + .DS_Store system files. Tracked for provenance only — not gameplay, not runtime-eligible, not placeable, catalogVisible false. Locked 2026-08-15.",
    };
  }
  if (familyKey === cfg.effectFamily) {
    if (cfg.effectMode === "numbered-variants") {
      return {
        name: `${cls[0].toUpperCase()}${cls.slice(1)} Slash Effects (10 variants)`,
        type: cfg.effectFamilyType,
        notes: `${cfg.effectSourceName} — 10 numbered slash-effect animations. Variants are explicit (01-10), NOT guessed elemental meanings from color alone. Variant 01 is runtime-confirmed; 02-10 stay reference until the runtime adopts them. PNG frames are spawned melee effects (${cfg.effectRole}); EPS frames map to their PNG via sourceOf. Locked 2026-08-15.`,
      };
    }
    const effectList = Object.values(cfg.effects)
      .map((e) => `${e.effect} (${e.element})`)
      .join(", ");
    return {
      name: `${cls[0].toUpperCase()}${cls.slice(1)} Effect Package (${effectList})`,
      type: cfg.effectFamilyType,
      notes: `${Object.keys(cfg.effects).length} effect identities — ${effectList}. PNG frames are spawned combat effects (${cfg.effectRole}); AI/EPS/GIF are authoring sources for the same effects (EPS preserves sourceOf -> PNG canonical). Locked 2026-08-15.`,
    };
  }
  const suffix = familyKey.replace(`${cls}_`, "");
  return {
    name: `${cls[0].toUpperCase()}${cls.slice(1)} ${FAMILY_TYPE_NAMES[suffix]}`,
    type: suffix,
    notes: `${FAMILY_TYPE_NAMES[suffix]} for the ${cls} class. Frames derive deterministically from path. Locked 2026-08-15.`,
  };
}

function classify(cls, rel, file) {
  const cfg = CLASS_CONFIG[cls];
  const parts = rel.split("/");
  const runtime = file.status === "runtime-used" ? "runtime-used" : "reference-only";
  const base = { classId: cls, placeable: false, reviewStatus: "reviewed" };

  if (rel === "metadata.json") {
    return {
      family: `${cls}_support`,
      asset: {
        ...base,
        assetRole: "metadata",
        runtimeEligible: false,
        displayName: `${cls} package metadata`,
        canonicalName: `class_${cls}_metadata`,
        runtimeStatus: "reference-only",
        renameStatus: "keep",
        description: `Package metadata JSON for the ${cls} class asset set.`,
      },
    };
  }
  if (parts[0] === "Idle" && parts[1] === "rotations") {
    const dir = parts[2].replace(/\.png$/, "");
    return {
      family: `${cls}_character`,
      asset: {
        ...base,
        assetRole: "character-frame",
        animation: "idle",
        direction: dir,
        frame: 0,
        frameCount: 1,
        runtimeEligible: true,
        displayName: `${cls} idle ${dir}`,
        canonicalName: `class_${cls}_idle_${dir}`,
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
      family: `${cls}_${info.familySuffix}`,
      asset: {
        ...base,
        assetRole: "animation-frame",
        animation: info.animation,
        direction: dir,
        frame,
        frameCount: info.frames,
        runtimeEligible: !isPickup,
        displayName: `${cls} ${info.animation.replace(/_/g, " ")} ${dir} ${frameLabel}`,
        canonicalName: `class_${cls}_${info.animation}_${dir}_${frameLabel}`,
        runtimeStatus: runtime,
        renameStatus: "keep",
        description: `${info.animation.replace(/_/g, " ")} animation frame ${frameLabel} (${dir}, ${file.width}x${file.height}).`,
      },
    };
  }
  if (parts[0] === "AttackEffects") {
    if (cfg.effectMode === "numbered-variants") {
      if (parts[1] === "PNG") {
        const variant = parts[2];
        const frame = parseInt(parts[3].replace(/\.png$/, ""), 10);
        const variantLabel = String(variant).padStart(2, "0");
        const frameLabel = String(frame).padStart(3, "0");
        return {
          family: cfg.effectFamily,
          asset: {
            ...base,
            assetRole: cfg.effectRole,
            effect: cfg.effect,
            effectVariant: variantLabel,
            frame,
            frameCount: null,
            runtimeEligible: true,
            displayName: `slash variant ${variantLabel} frame ${frameLabel}`,
            canonicalName: `effect_${cls}_${cfg.effect}_${variantLabel}_${frameLabel}`,
            runtimeStatus: runtime,
            renameStatus: "keep",
            description: `Slash effect variant ${variantLabel}, frame ${frameLabel} (${file.width}x${file.height}).`,
          },
        };
      }
      if (parts[1] === "EPS") {
        const m = parts[2].match(/FX_(\d+)_(\d+)\.eps$/);
        if (!m) return null;
        const variantLabel = String(m[1]).padStart(2, "0");
        const frameLabel = String(m[2]).padStart(3, "0");
        return {
          family: cfg.effectFamily,
          asset: {
            ...base,
            assetRole: "authoring-source",
            sourceRole: "authoring-frame",
            effect: cfg.effect,
            effectVariant: variantLabel,
            frame: parseInt(m[2], 10),
            sourceOf: `effect_${cls}_${cfg.effect}_${variantLabel}_${frameLabel}`,
            runtimeEligible: false,
            displayName: `slash variant ${variantLabel} EPS frame ${frameLabel}`,
            canonicalName: `source_${cls}_slash_v${variantLabel}_f${frameLabel}`,
            runtimeStatus: "reference-only",
            renameStatus: "keep",
            description: `EPS authoring frame ${frameLabel} for slash variant ${variantLabel} (source of the matching PNG frame).`,
          },
        };
      }
      if (parts[1] === "AI") {
        return {
          family: cfg.effectFamily,
          asset: {
            ...base,
            assetRole: "authoring-master",
            sourceRole: "effect-pack",
            format: "illustrator",
            effect: cfg.effect,
            runtimeEligible: false,
            displayName: "Slash sprite effects Illustrator master",
            canonicalName: `source_${cls}_slash_effects_ai`,
            runtimeStatus: "reference-only",
            renameStatus: "keep",
            description: `Illustrator master for the ${cfg.effectSourceName} package (all 10 variants).`,
          },
        };
      }
      return null;
    }
    const effectName = parts[1];
    const meta = cfg.effects[effectName];
    if (!meta) return null;
    const slug = meta.effect;
    if (parts[2] === "PNG") {
      const frame = parseInt(parts[3].replace(/\D/g, ""), 10);
      return {
        family: cfg.effectFamily,
        asset: {
          ...base,
          assetRole: cfg.effectRole,
          effect: meta.effect,
          element: meta.element,
          effectType: meta.effectType ?? null,
          shape: meta.shape ?? null,
          frame,
          frameCount: null, // set after per-effect scan (varies: 8/8/12/8)
          runtimeEligible: true,
          displayName: `${effectName} frame ${String(frame).padStart(2, "0")}`,
          canonicalName: `effect_${cls}_${slug}_${String(frame).padStart(2, "0")}`,
          runtimeStatus: runtime,
          renameStatus: "keep",
          description: `${effectName} effect frame ${frame} (${file.width}x${file.height}).`,
        },
      };
    }
    if (parts[2] === "AI") {
      return {
        family: cfg.effectFamily,
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-master",
          effect: meta.effect,
          element: meta.element,
          effectType: meta.effectType ?? null,
          runtimeEligible: false,
          displayName: `${effectName} Illustrator master`,
          canonicalName: `source_${cls}_${slug}_ai`,
          runtimeStatus: "reference-only",
          renameStatus: "keep",
          description: `Illustrator master for the ${effectName} effect.`,
        },
      };
    }
    if (parts[2] === "EPS") {
      const frame = parseInt(parts[3].replace(/\D/g, ""), 10);
      return {
        family: cfg.effectFamily,
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          effect: meta.effect,
          element: meta.element,
          effectType: meta.effectType ?? null,
          frame,
          sourceOf: `effect_${cls}_${slug}_${String(frame).padStart(2, "0")}`,
          runtimeEligible: false,
          displayName: `${effectName} EPS frame ${String(frame).padStart(2, "0")}`,
          canonicalName: `source_${cls}_${slug}_frame_${String(frame).padStart(2, "0")}`,
          runtimeStatus: "reference-only",
          renameStatus: "keep",
          description: `EPS authoring frame ${frame} for ${effectName} (source of the matching PNG frame).`,
        },
      };
    }
    if (/Preview\.gif$/.test(parts[2])) {
      return {
        family: cfg.effectFamily,
        asset: {
          ...base,
          assetRole: "animation-preview",
          effect: meta.effect,
          element: meta.element,
          runtimeEligible: false,
          displayName: `${effectName} preview`,
          canonicalName: `preview_${cls}_${slug}`,
          runtimeStatus: "reference-only",
          renameStatus: "keep",
          description: `Animated preview GIF for the ${effectName} effect.`,
        },
      };
    }
    if (parts[2] === ".DS_Store") {
      return {
        family: `${cls}_support`,
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
  const requested = process.argv.slice(2);
  const classes = requested.length ? requested.filter((c) => CLASS_CONFIG[c]) : Object.keys(CLASS_CONFIG);
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const reviews = JSON.parse(await readFile(reviewsPath, "utf8"));

  // Remove previous review families for the packs being re-run (idempotent).
  for (const cls of classes) {
    const pack = CLASS_CONFIG[cls].pack;
    for (const key of Object.keys(reviews.reviews)) {
      if (key.startsWith(`${pack}/`)) delete reviews.reviews[key];
    }
  }

  for (const cls of classes) {
    const cfg = CLASS_CONFIG[cls];
    const files = inventory.files.filter((f) => f.path.startsWith(cfg.prefix));
    const byFamily = {};
    let unclassified = 0;
    for (const f of files) {
      const rel = f.path.slice(cfg.prefix.length);
      const result = classify(cls, rel, f);
      if (!result) {
        unclassified++;
        console.warn(`UNCLASSIFIED: ${f.path}`);
        continue;
      }
      const famAssets = (byFamily[result.family] = byFamily[result.family] || {});
      famAssets[f.path] = { ...result.asset };
    }

    // Patch effect frameCounts per effect identity (PNG frame count varies per effect
    // and, for warrior, per effectVariant).
    for (const famAssets of Object.values(byFamily)) {
      const perEffect = {};
      for (const asset of Object.values(famAssets)) {
        if (asset.effect && asset.assetRole === cfg.effectRole) {
          const key = asset.effectVariant ? `${asset.effect}|${asset.effectVariant}` : asset.effect;
          perEffect[key] = (perEffect[key] ?? 0) + 1;
        }
      }
      for (const asset of Object.values(famAssets)) {
        if (asset.effect && asset.assetRole === cfg.effectRole) {
          const key = asset.effectVariant ? `${asset.effect}|${asset.effectVariant}` : asset.effect;
          asset.frameCount = perEffect[key];
        }
      }
    }

    for (const [familyKey, assets] of Object.entries(byFamily)) {
      const meta = familyMeta(cls, familyKey);
      reviews.reviews[`${cfg.pack}/${familyKey}`] = {
        familyKey,
        canonicalFamily: familyKey,
        suggestedFamilyName: meta.name,
        classFamilyType: meta.type,
        classId: cls,
        notes: meta.notes,
        assets,
      };
    }

    const counts = Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, Object.keys(v).length]));
    const classified = files.length - unclassified;
    console.log(`[${cls}] ${classified}/${files.length} classified (${unclassified} unclassified)`);
    console.log(JSON.stringify(counts));
  }

  reviews.generatedAt = new Date().toISOString();
  await writeFile(reviewsPath, JSON.stringify(reviews, null, 2) + "\n", "utf8");
  console.log("reviews written:", reviewsPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
