#!/usr/bin/env node
/**
 * Deterministic classifier for the HappyValley NPC pack
 * (reference/assets/maps/HappyValley/NPC/*) — per ChatGPT audit.
 *
 * The package is centered on 3 NPC identities (blacksmith, jeweler, sage)
 * with 7 complete 30-frame animation states, reusable vector components,
 * profession props, dialogue UI, and authoring sources.
 *
 * Semantic families (5):
 *   happyvalley_npc_animation       630 complete-character PNG frames (7 states × 3 NPCs × 30)
 *   happyvalley_npc_component        51 body/head/face/limb PNG parts + 3 Animations.scml = 54
 *   happyvalley_npc_profession_prop   4 PNGs (anvil ×3 shared copies + Sage stick)
 *   happyvalley_npc_dialogue_ui       6 popup PNGs (logically deduped to 2 bubbles)
 *   happyvalley_npc_source           61 EPS (sourceOf-linked) + 6 AI masters = 67
 *
 * KEY DIFFERENCE from CloverVillage NPCs: this is NOT a directional movement
 * set. It's a frontal expressive/dialogue package (chagrin, communication,
 * greeting, greeting_2, idle, idle_blink, joy). No front/back/side dirs in
 * source — direction: front is used for the complete-character frontal renders.
 * greeting_2 is preserved as its own animation ID, not guessed.
 * Everything stays reference — nothing runtime-confirmed on this page.
 * Writes review entries into design/assets/asset-reviews.json (schema v3).
 *
 * Usage: node classify-happyvalley-npc.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inventoryPath = join(root, "design", "assets", "asset-inventory.json");
const reviewsPath = join(root, "design", "assets", "asset-reviews.json");

const PACK = "HappyValley";
const PREFIX = "reference/assets/maps/HappyValley/NPC/";

const NPCS = ["Blacksmith", "Jeweler", "Sage"];

// Source folder name -> normalized animation id (7 states × 3 NPCs × 30 = 630).
const ANIM_MAP = {
  Chagrin: "chagrin",
  Communication: "communication",
  Greeting: "greeting",
  Greeting_2: "greeting_2",
  "Idle Blinking": "idle_blink",
  Idle: "idle",
  Joy: "joy",
};

// Standard body-part components (same across all 3 NPCs).
const PART_MAP = {
  Body: { component: "body", side: "none" },
  Head: { component: "head", side: "none" },
  Left_Arm: { component: "arm", side: "left" },
  Right_Arm: { component: "arm", side: "right" },
  Left_Hand: { component: "hand", side: "left" },
  Right_Hand: { component: "hand", side: "right" },
  Left_Leg: { component: "leg", side: "left" },
  Right_Leg: { component: "leg", side: "right" },
};

const FAMILY_META = {
  happyvalley_npc_animation: {
    suggestedFamilyName: "HappyValley NPC Animation Frames",
    hvNpcFamilyType: "animation",
    runtimeEligible: true,
    worldRole: "PVE_1_20",
    notes: "630 complete-character PNG frames — 7 emotional/social animation states × 3 NPCs × 30 frames (chagrin, communication, greeting, greeting_2, idle, idle_blink, joy). Frontal complete-character renders; NOT a directional movement set (no front/back/side dirs in source) — direction: front reflects the source. greeting_2 preserved as its own ID, not guessed. Spawnable dialogue/expressive entity resources. Entire package stays REFERENCE until runtime usage proves otherwise. Locked 2026-08-15.",
  },
  happyvalley_npc_component: {
    suggestedFamilyName: "HappyValley NPC Vector Components",
    hvNpcFamilyType: "component",
    runtimeEligible: false,
    worldRole: "PVE_1_20",
    notes: "Reusable character assembly parts (Body, Head, Face_01-09, Left/Right arm/hand/leg) + Animations.scml per NPC. Never individually placeable. Canonical npc_component_happyvalley_<npc>_<part>. Locked 2026-08-15.",
  },
  happyvalley_npc_profession_prop: {
    suggestedFamilyName: "HappyValley NPC Profession Props",
    hvNpcFamilyType: "profession-prop",
    runtimeEligible: true,
    worldRole: "PVE_1_20",
    notes: "Profession-specific assembly props: blacksmith anvil (anvil.png shared across all 3 NPC folders — sharedVisual), sage stick. Jeweler gems and sage shield exist as EPS authoring sources in the source family (EPS-only identities until runtime art exists). These are NPC assembly props, not world-decor props unless runtime later uses them independently. Locked 2026-08-15.",
  },
  happyvalley_npc_dialogue_ui: {
    suggestedFamilyName: "HappyValley NPC Dialogue UI",
    hvNpcFamilyType: "ui",
    runtimeEligible: true,
    worldRole: "PVE_1_20",
    notes: "6 popup PNGs (popup_1 ×3, popup_2 ×3) logically deduped to ui_dialogue_bubble_small (415x376) and ui_dialogue_bubble_large (767x540). Identical sizes across all 3 NPCs — sharedVisual, not 6 separate logical assets. Source files kept as aliases. Locked 2026-08-15.",
  },
  happyvalley_npc_source: {
    suggestedFamilyName: "HappyValley NPC Authoring Sources",
    hvNpcFamilyType: "source",
    runtimeEligible: false,
    worldRole: "PVE_1_20",
    notes: "61 EPS authoring sources (body parts, profession props, popups — each sourceOf-linked to its PNG/component/prop canonical) + 6 AI masters (3 character masters + 3 popup masters). Authoring material for provenance; never runtime-eligible or placeable. Locked 2026-08-15.",
  },
};

function classify(rel, file) {
  const fileName = rel.split("/").pop();
  const ext = file.extension;
  const base = { reviewStatus: "reviewed", runtimeStatus: "reference-only", npcPackage: "happyvalley" };
  const npcName = rel.split("/")[0];
  const npcId = npcName.toLowerCase();

  // --- AI masters ---
  if (ext === ".ai") {
    const isPopup = /\/popup\//.test(rel);
    return {
      family: "happyvalley_npc_source",
      asset: {
        ...base,
        assetRole: "authoring-master",
        sourceRole: isPopup ? "popup-master" : "character-master",
        format: "illustrator",
        npcId,
        runtimeEligible: false,
        placeable: false,
        displayName: `${npcName} ${isPopup ? "popup" : ""} Illustrator master`,
        canonicalName: isPopup ? `source_happyvalley_${npcId}_popup_master_ai` : `source_happyvalley_${npcId}_master_ai`,
        renameStatus: "keep",
        description: `Illustrator master for the ${npcName} ${isPopup ? "dialogue popup" : "character"} package.`,
      },
    };
  }

  // --- Popup PNGs (dialogue UI) ---
  if (/\/popup\/PNG\//.test(rel)) {
    const isLarge = fileName === "popup_2.png";
    return {
      family: "happyvalley_npc_dialogue_ui",
      asset: {
        ...base,
        assetRole: "dialogue-ui",
        npcId,
        sharedVisual: true,
        uiAsset: isLarge ? "ui_dialogue_bubble_large" : "ui_dialogue_bubble_small",
        runtimeEligible: true,
        placeable: false,
        displayName: `dialogue bubble ${isLarge ? "large" : "small"} (${npcName} copy)`,
        canonicalName: isLarge ? "ui_dialogue_bubble_large" : "ui_dialogue_bubble_small",
        renameStatus: "keep",
        description: `${isLarge ? "Large" : "Small"} cream dialogue speech bubble (${file.width}x${file.height}) — identical across all 3 NPCs, sharedVisual.`,
      },
    };
  }

  // --- Animation frames ---
  const seqMatch = rel.match(/\/PNG Sequences\/([^/]+)\//);
  if (seqMatch) {
    const anim = ANIM_MAP[seqMatch[1]];
    if (!anim) return null;
    // Filenames are 0_<Npc>_<Anim>_NNN.png — take only the trailing frame digits.
    const frameMatch = fileName.match(/(\d{3})\.png$/);
    if (!frameMatch) return null;
    const frame = parseInt(frameMatch[1], 10);
    const frameLabel = String(frame).padStart(3, "0");
    return {
      family: "happyvalley_npc_animation",
      asset: {
        ...base,
        assetRole: "animation-frame",
        npcId,
        animation: anim,
        direction: "front",
        frame,
        frameCount: 30,
        renderMode: "complete-character",
        runtimeEligible: true,
        placeable: false,
        displayName: `${npcName} ${anim.replace(/_/g, " ")} ${frameLabel}`,
        canonicalName: `npc_happyvalley_${npcId}_${anim}_${frameLabel}`,
        renameStatus: "keep",
        description: `${anim.replace(/_/g, " ")} animation frame ${frameLabel} for ${npcName} (${file.width}x${file.height}, complete-character frontal render).`,
      },
    };
  }

  // --- Vector Parts ---
  if (/\/Vector Parts\//.test(rel)) {
    // Animations.scml -> animation source
    if (ext === ".scml") {
      return {
        family: "happyvalley_npc_component",
        asset: {
          ...base,
          assetRole: "animation-source",
          format: "scml",
          npcId,
          runtimeEligible: false,
          placeable: false,
          displayName: `${npcName} Animations SCML`,
          canonicalName: `source_happyvalley_${npcId}_animations_scml`,
          renameStatus: "keep",
          description: `Spriter-style animation definition file for ${npcName} (Animations.scml).`,
        },
      };
    }
    const partName = fileName.replace(/\.png$/i, "");
    // Profession props first (anvil shared across all 3; stick only in Sage)
    if (/^anvil$/i.test(partName)) {
      return {
        family: "happyvalley_npc_profession_prop",
        asset: {
          ...base,
          assetRole: "profession-prop",
          npcId,
          propRole: "anvil",
          sharedVisual: true,
          runtimeEligible: true,
          placeable: false,
          displayName: `blacksmith anvil (${npcName} copy)`,
          canonicalName: "npc_prop_happyvalley_blacksmith_anvil",
          renameStatus: "keep",
          description: `Standalone blacksmith anvil (${file.width}x${file.height}) — same artwork present in all 3 NPC vector-parts folders, sharedVisual.`,
        },
      };
    }
    if (/^Stick$/i.test(partName)) {
      return {
        family: "happyvalley_npc_profession_prop",
        asset: {
          ...base,
          assetRole: "profession-prop",
          npcId,
          propRole: "stick",
          runtimeEligible: true,
          placeable: false,
          displayName: "sage stick",
          canonicalName: "npc_prop_happyvalley_sage_stick",
          renameStatus: "keep",
          description: `Sage stick prop (${file.width}x${file.height}). Source says Sage_Stick — preserved as stick, not guessed to staff.`,
        },
      };
    }
    const face = partName.match(/^Face_(\d{2})$/);
    if (face) {
      const variant = face[1];
      return {
        family: "happyvalley_npc_component",
        asset: {
          ...base,
          assetRole: "character-component",
          npcId,
          component: "face",
          side: "none",
          variant,
          runtimeEligible: false,
          placeable: false,
          displayName: `${npcName} face ${variant}`,
          canonicalName: `npc_component_happyvalley_${npcId}_face_${variant}`,
          renameStatus: "keep",
          description: `Face variant ${variant} for ${npcName} (${file.width}x${file.height}).`,
        },
      };
    }
    const part = PART_MAP[partName];
    if (part) {
      return {
        family: "happyvalley_npc_component",
        asset: {
          ...base,
          assetRole: "character-component",
          npcId,
          component: part.component,
          side: part.side,
          runtimeEligible: false,
          placeable: false,
          displayName: `${npcName} ${part.side !== "none" ? part.side + " " : ""}${part.component}`,
          canonicalName: `npc_component_happyvalley_${npcId}_${part.side !== "none" ? part.side + "_" : ""}${part.component}`,
          renameStatus: "keep",
          description: `${part.side !== "none" ? part.side + " " : ""}${part.component} component for ${npcName} (${file.width}x${file.height}).`,
        },
      };
    }
    return null;
  }

  // --- EPS authoring sources ---
  if (ext === ".eps") {
    // popup EPS
    if (/\/popup\//.test(rel)) {
      const isLarge = /pop_up_2/.test(fileName);
      return {
        family: "happyvalley_npc_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          npcId,
          sourceOf: isLarge ? "ui_dialogue_bubble_large" : "ui_dialogue_bubble_small",
          runtimeEligible: false,
          placeable: false,
          displayName: `${npcName} popup ${isLarge ? "large" : "small"} EPS source`,
          canonicalName: `source_happyvalley_${npcId}_popup_${isLarge ? "large" : "small"}_eps`,
          renameStatus: "keep",
          description: `EPS authoring source for the ${npcName} ${isLarge ? "large" : "small"} dialogue bubble.`,
        },
      };
    }
    const epsName = fileName.replace(/\.eps$/i, "");
    const epsNpc = NPCS.find((n) => epsName.startsWith(n));
    if (!epsNpc) return null;
    const epsId = epsNpc.toLowerCase();
    const rest = epsName.slice(epsNpc.length + 1);

    // Profession prop EPS
    if (rest === "Anvil") {
      return {
        family: "happyvalley_npc_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          npcId: epsId,
          sourceOf: "npc_prop_happyvalley_blacksmith_anvil",
          runtimeEligible: false,
          placeable: false,
          displayName: "blacksmith anvil EPS source",
          canonicalName: "source_happyvalley_blacksmith_anvil_eps",
          renameStatus: "keep",
          description: "EPS authoring source for the blacksmith anvil prop.",
        },
      };
    }
    if (rest === "Gems") {
      return {
        family: "happyvalley_npc_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          npcId: epsId,
          sourceOf: "npc_prop_happyvalley_jeweler_gems",
          runtimeEligible: false,
          placeable: false,
          displayName: "jeweler gems EPS source",
          canonicalName: "source_happyvalley_jeweler_gems_eps",
          renameStatus: "keep",
          description: "EPS authoring source for the jeweler gems prop (EPS-only identity — no PNG counterpart in this pack).",
        },
      };
    }
    if (rest === "Shield") {
      return {
        family: "happyvalley_npc_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          npcId: epsId,
          sourceOf: "npc_prop_happyvalley_sage_shield",
          runtimeEligible: false,
          placeable: false,
          displayName: "sage shield EPS source",
          canonicalName: "source_happyvalley_sage_shield_eps",
          renameStatus: "keep",
          description: "EPS authoring source for the sage shield prop (EPS-only identity — no PNG counterpart in this pack).",
        },
      };
    }
    if (rest === "Stick") {
      return {
        family: "happyvalley_npc_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          npcId: epsId,
          sourceOf: "npc_prop_happyvalley_sage_stick",
          runtimeEligible: false,
          placeable: false,
          displayName: "sage stick EPS source",
          canonicalName: "source_happyvalley_sage_stick_eps",
          renameStatus: "keep",
          description: "EPS authoring source for the sage stick prop.",
        },
      };
    }

    // Body part EPS -> map to component canonical (Face_1..Face_9 and Face_08/Face_09 both occur)
    const face = rest.match(/^Face_(\d{1,2})$/);
    if (face) {
      const variant = String(face[1]).padStart(2, "0");
      return {
        family: "happyvalley_npc_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          npcId: epsId,
          sourceOf: `npc_component_happyvalley_${epsId}_face_${variant}`,
          runtimeEligible: false,
          placeable: false,
          displayName: `${epsNpc} face ${variant} EPS source`,
          canonicalName: `source_happyvalley_${epsId}_face_${variant}_eps`,
          renameStatus: "keep",
          description: `EPS authoring source for ${epsNpc} face variant ${variant}.`,
        },
      };
    }
    const part = PART_MAP[rest];
    if (part) {
      const compName = part.side !== "none" ? `${part.side}_${part.component}` : part.component;
      return {
        family: "happyvalley_npc_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          npcId: epsId,
          sourceOf: `npc_component_happyvalley_${epsId}_${compName}`,
          runtimeEligible: false,
          placeable: false,
          displayName: `${epsNpc} ${compName} EPS source`,
          canonicalName: `source_happyvalley_${epsId}_${compName}_eps`,
          renameStatus: "keep",
          description: `EPS authoring source for ${epsNpc} ${compName} component.`,
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

  // Idempotent: remove previous HappyValley NPC review families.
  for (const key of Object.keys(reviews.reviews)) {
    if (key.startsWith(`${PACK}/happyvalley_npc_`)) delete reviews.reviews[key];
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
      hvNpcFamilyType: meta.hvNpcFamilyType,
      runtimeEligible: meta.runtimeEligible,
      worldRole: meta.worldRole,
      notes: meta.notes,
      assets,
    };
  }

  const counts = Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, Object.keys(v).length]));
  const classified = files.length - unclassified;
  console.log(`[happyvalley-npc] ${classified}/${files.length} classified (${unclassified} unclassified)`);
  console.log(JSON.stringify(counts, null, 1));

  // Verify animation math: 7 states × 3 NPCs × 30 = 630
  const frames = files.filter((f) => f.path.includes("PNG Sequences") && f.extension === ".png");
  const byAnim = {};
  for (const f of frames) {
    const m = f.path.match(/PNG Sequences\/([^/]+)\//);
    if (m) byAnim[m[1]] = (byAnim[m[1]] || 0) + 1;
  }
  console.log("animation frames per state:", JSON.stringify(byAnim));

  reviews.generatedAt = new Date().toISOString();
  await writeFile(reviewsPath, JSON.stringify(reviews, null, 2) + "\n", "utf8");
  console.log("reviews written:", reviewsPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
