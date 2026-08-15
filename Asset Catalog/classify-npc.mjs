#!/usr/bin/env node
/**
 * Clover Village NPC deterministic classifier.
 *
 * Derives canonical identity for all 1,378 NPC assets from their path:
 *   character -> role -> animation/component -> direction -> variant/frame
 *
 * Families (per audit):
 *   clover_npc_character   — logical identities (Artist/Astrologer/Citizen)
 *   clover_npc_animation   — complete-character animation frames
 *   clover_npc_component   — reusable vector body parts
 *   clover_npc_dialogue_ui — shared speech-bubble popup PNGs
 *   clover_npc_source      — AI/EPS/TXT authoring + documentation
 *
 * Writes the derived reviews into design/assets/asset-reviews.json (keyed
 * CloverVillage/clover_npc_*) and prints a coverage report. No source paths
 * are touched.
 */
import { readFile, writeFile } from "node:fs/promises";

const INV_PATH = "design/assets/asset-inventory.json";
const REV_PATH = "design/assets/asset-reviews.json";

const CHARACTERS = ["Artist", "Astrologer", "Citizen"];
const ANIMATIONS = { "Greeting": "greeting", "Idle": "idle", "Walk": "walk", "Communication": "communication", "Idle Blinking": "idle_blink" };
const BODY_PARTS = ["Body", "Head", "Left_Arm", "Right_Arm", "Left_Hand", "Right_Hand", "Left_Leg", "Right_Leg"];

function parseBodyPart(name) {
  // returns { bodyPart, side, variant } or null
  const m = name.match(/^Face_(\d+)$/);
  if (m) return { bodyPart: "face", side: "none", variant: String(m[1]).padStart(2, "0") };
  if (name === "Body") return { bodyPart: "body", side: "none", variant: null };
  if (name === "Head") return { bodyPart: "head", side: "none", variant: null };
  const lm = name.match(/^(Left|Right)_(Arm|Hand|Leg)$/);
  if (lm) return { bodyPart: lm[2].toLowerCase(), side: lm[1].toLowerCase(), variant: null };
  return null;
}

async function main() {
  const inv = JSON.parse(await readFile(INV_PATH, "utf8"));
  const npcFiles = inv.files.filter((f) => /\/CloverVillage\/NPC\//.test(f.path));

  const families = {
    clover_npc_character: { count: 0, assets: {} },
    clover_npc_animation: { count: 0, assets: {} },
    clover_npc_component: { count: 0, assets: {} },
    clover_npc_dialogue_ui: { count: 0, assets: {} },
    clover_npc_source: { count: 0, assets: {} },
  };
  const unclassified = [];

  for (const f of npcFiles) {
    const rel = f.path.replace(/^reference\/assets\/maps\/CloverVillage\/NPC\//, "");
    const parts = rel.split("/");
    const character = parts[0];
    const area = parts[1]; // AI | EPS | PNG | TXT | popup
    const fileName = parts[parts.length - 1];

    // --- popup (dialogue UI or popup source) ---
    if (area === "popup") {
      if (fileName.endsWith(".png")) {
        const size = fileName.includes("popup_1") ? "small" : "large";
        families.clover_npc_dialogue_ui.assets[f.path] = {
          assetRole: "dialogue-ui",
          npcId: character.toLowerCase(),
          sharedVisual: true,
          placeable: false,
          npcSpecific: false,
          uiAsset: `ui_dialogue_bubble_${size}`,
          displayName: size === "small" ? "Dialogue Bubble (small)" : "Dialogue Bubble (large)",
          canonicalName: `ui_dialogue_bubble_${size}`,
          runtimeStatus: f.status === "runtime-used" ? "runtime-used" : "reference-only",
          reviewStatus: "reviewed",
          description: "Shared cream speech-bubble UI (identical across NPCs — logical dedupe; source files untouched).",
          renameStatus: "keep",
        };
        families.clover_npc_dialogue_ui.count++;
      } else {
        families.clover_npc_source.assets[f.path] = {
          assetRole: "authoring-source",
          sourceRole: fileName.endsWith(".ai") ? "authoring-master" : "authoring-source",
          npcId: character.toLowerCase(),
          placeable: false,
          runtimeEligible: false,
          renderMode: "source",
          displayName: `Popup ${fileName.split(".")[0]}`,
          canonicalName: `popup_source_${character.toLowerCase()}_${fileName.split(".")[0].replace(/[^a-z0-9]/gi, "_").toLowerCase()}`,
          runtimeStatus: "reference-only",
          reviewStatus: "reviewed",
          description: `${fileName.endsWith(".ai") ? "Illustrator master" : "Vector"} source for the dialogue popup.`,
          renameStatus: "keep",
        };
        families.clover_npc_source.count++;
      }
      continue;
    }

    // --- TXT (license / readme) ---
    if (area === "TXT") {
      families.clover_npc_source.assets[f.path] = {
        assetRole: "documentation",
        sourceRole: fileName.includes("license") ? "license" : "documentation",
        npcId: character.toLowerCase(),
        placeable: false,
        runtimeEligible: false,
        renderMode: "source",
        displayName: fileName.split(".")[0],
        canonicalName: `${character.toLowerCase()}_${fileName.replace(".txt", "").toLowerCase()}`,
        runtimeStatus: "reference-only",
        reviewStatus: "reviewed",
        description: "License / readme documentation for the NPC source package.",
        renameStatus: "keep",
      };
      families.clover_npc_source.count++;
      continue;
    }

    // --- AI masters ---
    if (area === "AI") {
      const dir = fileName.match(/_(back|front|side)\.ai$/i);
      families.clover_npc_source.assets[f.path] = {
        assetRole: "authoring-source",
        sourceRole: "authoring-master",
        npcId: character.toLowerCase(),
        direction: dir ? dir[1].toLowerCase() : null,
        placeable: false,
        runtimeEligible: false,
        renderMode: "source",
        displayName: fileName.replace(".ai", ""),
        canonicalName: `npc_${character.toLowerCase()}_ai_${dir ? dir[1].toLowerCase() : "master"}`,
        runtimeStatus: "reference-only",
        reviewStatus: "reviewed",
        description: "Illustrator authoring master.",
        renameStatus: "keep",
      };
      families.clover_npc_source.count++;
      continue;
    }

    // --- EPS (component vector parts per direction) ---
    if (area === "EPS") {
      const direction = parts[2].toLowerCase(); // Back | Front | Side
      const bp = parseBodyPart(fileName.replace(/\.eps$/i, "").replace(new RegExp(`^${character}_${direction}_`, "i"), ""));
      families.clover_npc_source.assets[f.path] = {
        assetRole: "authoring-source",
        sourceRole: "component-vector",
        npcId: character.toLowerCase(),
        direction,
        bodyPart: bp?.bodyPart ?? null,
        side: bp?.side ?? "none",
        variant: bp?.variant ?? null,
        placeable: false,
        runtimeEligible: false,
        renderMode: "source",
        displayName: fileName.replace(".eps", ""),
        canonicalName: `npc_component_${character.toLowerCase()}_${direction}_${(bp ? `${bp.bodyPart}${bp.variant ? `_${bp.variant}` : ""}${bp.side !== "none" ? `_${bp.side}` : ""}` : "unknown").toLowerCase()}_vector`,
        runtimeStatus: "reference-only",
        reviewStatus: "reviewed",
        description: "Vector (EPS) character component source.",
        renameStatus: "keep",
      };
      families.clover_npc_source.count++;
      continue;
    }

    // --- PNG ---
    if (area === "PNG") {
      const direction = parts[2].toLowerCase(); // Back | Front | Side
      const sub = parts[3]; // "PNG Sequences" | "Vector Parts"

      if (sub === "Vector Parts") {
        if (fileName.endsWith(".scml")) {
          families.clover_npc_component.assets[f.path] = {
            assetRole: "character-component",
            npcId: character.toLowerCase(),
            direction,
            placeable: false,
            renderMode: "component",
            displayName: `${character} ${direction} Animations (scml)`,
            canonicalName: `npc_component_${character.toLowerCase()}_${direction}_animations_scml`,
            runtimeStatus: f.status === "runtime-used" ? "runtime-used" : "reference-only",
            reviewStatus: "reviewed",
            description: "Spine animation project file for the character direction.",
            renameStatus: "keep",
          };
          families.clover_npc_component.count++;
          continue;
        }
        const bp = parseBodyPart(fileName.replace(/\.png$/i, ""));
        families.clover_npc_component.assets[f.path] = {
          assetRole: "character-component",
          npcId: character.toLowerCase(),
          direction,
          bodyPart: bp?.bodyPart ?? "unknown",
          side: bp?.side ?? "none",
          variant: bp?.variant ?? null,
          placeable: false,
          renderMode: "component",
          displayName: `${character} ${direction} ${fileName.replace(".png", "")}`,
          canonicalName: `npc_component_${character.toLowerCase()}_${direction}_${(bp ? `${bp.bodyPart}${bp.variant ? `_${bp.variant}` : ""}${bp.side !== "none" ? `_${bp.side}` : ""}` : "unknown").toLowerCase()}`,
          runtimeStatus: f.status === "runtime-used" ? "runtime-used" : "reference-only",
          reviewStatus: "reviewed",
          description: "Reusable character assembly component (not individually placeable).",
          renameStatus: "keep",
        };
        families.clover_npc_component.count++;
        continue;
      }

      if (sub === "PNG Sequences") {
        const animationFolder = parts[4];
        const anim = ANIMATIONS[animationFolder];
        const frameMatch = fileName.match(/_(\d{3})\.png$/);
        const frame = frameMatch ? Number(frameMatch[1]) : null;
        if (!anim || frame === null) { unclassified.push(rel); continue; }
        const npcId = character.toLowerCase();
        families.clover_npc_animation.assets[f.path] = {
          assetRole: "animation-frame",
          npcId,
          animation: anim,
          direction,
          frame,
          frameCount: 30,
          renderMode: "complete-character",
          placeable: false,
          displayName: `${character} ${animationFolder} ${direction} ${String(frame).padStart(3, "0")}`,
          canonicalName: `npc_clover_${npcId}_${anim}_${direction}_${String(frame).padStart(3, "0")}`,
          runtimeStatus: f.status === "runtime-used" ? "runtime-used" : "reference-only",
          reviewStatus: "reviewed",
          description: `${animationFolder} animation frame (${direction}, complete character render).`,
          renameStatus: "keep",
        };
        families.clover_npc_animation.count++;
        continue;
      }

      unclassified.push(rel);
      continue;
    }

    unclassified.push(rel);
  }

  // Character identity family (logical — no physical assets)
  const charAssets = {};
  for (const c of CHARACTERS) {
    charAssets[`CloverVillage/NPC/${c}/`] = {
      assetRole: "character",
      npcId: c.toLowerCase(),
      placeable: true,
      renderMode: "complete-character",
      runtimeStatus: "reference-only",
      reviewStatus: "reviewed",
      displayName: `${c}`,
      canonicalName: `npc_clover_${c.toLowerCase()}`,
      description: `Logical NPC identity — ${c}. Owns directional render sets and animation sets.`,
      renameStatus: "keep",
    };
  }
  families.clover_npc_character.count = CHARACTERS.length;
  families.clover_npc_character.assets = charAssets;

  // Write reviews
  const rev = JSON.parse(await readFile(REV_PATH, "utf8"));
  for (const [key, fam] of Object.entries({
    clover_npc_character: {
      familyKey: "clover_npc_character",
      canonicalFamily: "clover_npc_character",
      suggestedFamilyName: "NPC Characters",
      npcFamilyType: "identity",
      notes: "Logical NPC identities: Artist, Astrologer, Citizen. Not physical sprites — each owns directional render sets and animation sets. Locked 2026-08-15.",
      assets: families.clover_npc_character.assets,
    },
    clover_npc_animation: {
      familyKey: "clover_npc_animation",
      canonicalFamily: "clover_npc_animation",
      suggestedFamilyName: "NPC Animations",
      npcFamilyType: "animation",
      notes: "Complete-character animation frames. 5 states: greeting (back/front/side x30), idle (back/front/side x30), walk (back/front/side x30), communication (front/side x30 — NO back direction in source), idle_blink (front/side x30). 3 NPCs x 3 directions x 30 frames per state. Derived deterministically from paths. Locked 2026-08-15.",
      assets: families.clover_npc_animation.assets,
    },
    clover_npc_component: {
      familyKey: "clover_npc_component",
      canonicalFamily: "clover_npc_component",
      suggestedFamilyName: "NPC Components",
      npcFamilyType: "component",
      notes: "Reusable character assembly components (body/head/face/arms/hands/legs + scml) per NPC and direction. Never individually placeable in the game editor. Locked 2026-08-15.",
      assets: families.clover_npc_component.assets,
    },
    clover_npc_dialogue_ui: {
      familyKey: "clover_npc_dialogue_ui",
      canonicalFamily: "clover_npc_dialogue_ui",
      suggestedFamilyName: "Dialogue UI",
      npcFamilyType: "ui",
      notes: "Shared cream speech-bubble popup assets. popup_2.png is pixel-identical across all three NPCs; popup_1 likewise. Logically deduplicated into ui_dialogue_bubble_small / _large — physical source files untouched; all source paths recorded as aliases. Locked 2026-08-15.",
      assets: families.clover_npc_dialogue_ui.assets,
    },
    clover_npc_source: {
      familyKey: "clover_npc_source",
      canonicalFamily: "clover_npc_source",
      suggestedFamilyName: "Source / Authoring",
      npcFamilyType: "source",
      notes: "AI/EPS/TXT authoring material — Illustrator masters, vector component sources, popup sources, license.txt and readme.txt per NPC. Inventoried for provenance; NOT runtime-eligible and not placeable. Locked 2026-08-15.",
      assets: families.clover_npc_source.assets,
    },
  })) {
    rev.reviews[`CloverVillage/${key}`] = fam;
  }
  await writeFile(REV_PATH, JSON.stringify(rev, null, 2), "utf8");

  // Coverage report
  const total = npcFiles.length;
  const classified = total - unclassified.length;
  console.log(`NPC files: ${total}`);
  console.log(`Classified: ${classified}  Unclassified: ${unclassified.length}`);
  for (const [k, v] of Object.entries(families)) console.log(`  ${k}: ${v.count}`);
  if (unclassified.length) {
    console.log("Unclassified paths:");
    for (const u of unclassified) console.log("  ", u);
  }
  // Runtime confirmation summary
  const animAssets = Object.values(families.clover_npc_animation.assets);
  const runtimeFrames = animAssets.filter((a) => a.runtimeStatus === "runtime-used");
  console.log(`\nAnimation frames total: ${animAssets.length} | runtime-confirmed: ${runtimeFrames.length}`);
  const byAnim = {};
  for (const a of animAssets) byAnim[a.animation] = (byAnim[a.animation] || 0) + 1;
  console.log("Frames per animation:", JSON.stringify(byAnim));
  const byDir = {};
  for (const a of animAssets) byDir[a.direction] = (byDir[a.direction] || 0) + 1;
  console.log("Frames per direction:", JSON.stringify(byDir));
  const runtimeByIdentity = {};
  for (const a of runtimeFrames) {
    const k = `${a.npcId}-${a.animation}-${a.direction}`;
    runtimeByIdentity[k] = (runtimeByIdentity[k] || 0) + 1;
  }
  console.log("Runtime frames by identity/animation/direction:", JSON.stringify(runtimeByIdentity, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
