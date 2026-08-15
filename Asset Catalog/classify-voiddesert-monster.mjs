#!/usr/bin/env node
/**
 * Deterministic classifier for the VoidDesert monster pack
 * (reference/assets/maps/VoidDesert/Mob/*) — per ChatGPT audit.
 *
 * 2,993 source records -> 7 monster identities -> 6 semantic families:
 *   voiddesert_monster_animation    combat 480x480 directional frames + sheets (6 mobs) + Warlord 700x700 expressive frames
 *   voiddesert_monster_component    Body/Head/Face/limb parts (+ SCML) — 160x160 combat, 400x400 Warlord
 *   voiddesert_monster_weapon       melee weapons (character-weapon, weaponType: melee)
 *   voiddesert_monster_combat_fx    Slash FX 00/01/02 (effect: slash, variants)
 *   voiddesert_monster_dialogue_ui  Warlord popup_1/popup_2
 *   voiddesert_monster_source       AI masters + EPS authoring sources + .DS_Store system files
 *
 * CRITICAL DISTINCTION per the audit:
 * - 6 COMBAT MOBS (assassin, chief_goblin, female_goblin, male_goblin, robber, thug)
 *   share one directional character system: 480x480 frames, states (idle, idle_blink,
 *   walk, run, attack, hurt, death) x directions (front, back, left, right).
 * - WARLORD is a SEPARATE 700x700 expressive/boss-style package (chagrin, communication,
 *   greeting, greeting_2, idle, idle_blink, joy x 30 frames) — NOT forced into the
 *   directional combat-mob schema. Encoded as monsterType: boss_npc vs combat_mob.
 *
 * Deterministic decisions (no visual guessing):
 * - Animation states from folder names, normalized: Attacking->attack, Hurt->hurt,
 *   Idle->idle, "Idle Blinking"->idle_blink, Running->run, Walking->walk, Dying->death.
 * - Directions: Front/Back/Left/Right, "L View"->left, "R View"->right.
 * - Components/weapons/slash FX parsed from source naming (EPS mirrors PNG Vector Parts).
 * - Weapons stay weaponType: melee — no sword/dagger/club/axe guessed.
 * - Slash FX 00/01/02 are VARIANTS of one effect, not three families.
 * - Warlord popup bubbles logically deduped to ui_dialogue_bubble_small/large (identical
 *   sizes to the Clover/HappyValley bubbles); source paths kept as aliases.
 * Everything stays reference — nothing runtime-confirmed on this page.
 * Writes review entries into design/assets/asset-reviews.json (schema v3).
 *
 * Usage: node classify-voiddesert-monster.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inventoryPath = join(root, "design", "assets", "asset-inventory.json");
const reviewsPath = join(root, "design", "assets", "asset-reviews.json");

const PACK = "VoidDesert";
const PREFIX = "reference/assets/maps/VoidDesert/Mob/";

const COMBAT_MOBS = ["Assassin", "Chief Goblin", "Female Goblin", "Male Goblin", "Robber", "Thug"];
const mobId = (name) => name.toLowerCase().replace(/\s+/g, "_");

// Animation state normalization (source folder -> canonical animation id)
const ANIM_MAP = {
  "Attacking": "attack",
  "Hurt": "hurt",
  "Idle": "idle",
  "Idle Blinking": "idle_blink",
  "Running": "run",
  "Walking": "walk",
  "Dying": "death",
  "Chagrin": "chagrin",
  "Communication": "communication",
  "Greeting": "greeting",
  "Greeting_2": "greeting_2",
  "Joy": "joy",
};

const DIR_MAP = {
  "Front": "front",
  "Back": "back",
  "Left": "left",
  "Right": "right",
  "L View": "left",
  "R View": "right",
  "Front View": "front",
};

// Component part parsing for combat mobs. Key: part token -> { component, side }
const PART_MAP = {
  "Body": { component: "body", side: "none" },
  "Head": { component: "head", side: "none" },
  "Left Arm": { component: "arm", side: "left" },
  "Right Arm": { component: "arm", side: "right" },
  "Left Hand": { component: "hand", side: "left" },
  "Right Hand": { component: "hand", side: "right" },
  "Left Leg": { component: "leg", side: "left" },
  "Right Leg": { component: "leg", side: "right" },
};

const FAMILY_META = {
  voiddesert_monster_animation: {
    suggestedFamilyName: "VoidDesert Monster Animation Frames",
    vdMonsterFamilyType: "animation",
    runtimeEligible: true,
    worldRole: "PVE_1_20",
    notes: "2,130 animation frames: 1,980 combat-mob directional frames (6 mobs x 330: idle/idle_blink/walk/run/attack/hurt x 4 dirs + death) + 210 Warlord expressive frames (7 states x 30). Combat mobs are 480x480 directional complete-character frames; Warlord is 700x700 frontal expressive — NOT forced into directional metadata (monsterType: boss_npc). Walking normalized to walk. Spawnable entity resources, placeable false. Everything stays REFERENCE. Locked 2026-08-15.",
  },
  voiddesert_monster_component: {
    suggestedFamilyName: "VoidDesert Monster Components",
    vdMonsterFamilyType: "component",
    runtimeEligible: false,
    worldRole: "PVE_1_20",
    notes: "Reusable assembly parts: 44 per combat mob (Body/Head/Face 01-04/Left+Right arm-hand-leg x 4 directions, 160x160) + 18 Warlord parts (Body 400x400, Head 500x500, Face_01-09, limbs, anvil) + 13 Animations.scml. Never individually placeable. Combat parts parsed deterministically from source naming (EPS mirrors PNG Vector Parts). Locked 2026-08-15.",
  },
  voiddesert_monster_weapon: {
    suggestedFamilyName: "VoidDesert Monster Melee Weapons",
    vdMonsterFamilyType: "weapon",
    runtimeEligible: true,
    worldRole: "PVE_1_20",
    notes: "Character melee weapons (2 per combat mob: front + L View; Warlord has Swords EPS source). weaponType stays melee — no sword/dagger/club/axe guessed from naming alone. Character assembly weapons, not world-decor props unless runtime uses them independently. Locked 2026-08-15.",
  },
  voiddesert_monster_combat_fx: {
    suggestedFamilyName: "VoidDesert Monster Combat FX",
    vdMonsterFamilyType: "combat-fx",
    runtimeEligible: true,
    worldRole: "PVE_1_20",
    notes: "Slash FX 00/01/02 per combat mob — ONE effect family (effect: slash) with 3 variants, NOT three unrelated families. EPS sources mirror the PNG parts with sourceOf links. Spawned combat effects, placeable false. Locked 2026-08-15.",
  },
  voiddesert_monster_dialogue_ui: {
    suggestedFamilyName: "VoidDesert Monster Dialogue UI",
    vdMonsterFamilyType: "dialogue-ui",
    runtimeEligible: true,
    worldRole: "PVE_1_20",
    notes: "Warlord popup_1 (415x376) + popup_2 (767x540) — same dimensions as the Clover/HappyValley bubbles, logically deduped to ui_dialogue_bubble_small/large (hash-equivalence to be confirmed; source paths kept as aliases). sharedVisual. Locked 2026-08-15.",
  },
  voiddesert_monster_source: {
    suggestedFamilyName: "VoidDesert Monster Authoring Sources",
    vdMonsterFamilyType: "source",
    runtimeEligible: false,
    worldRole: "PVE_1_20",
    notes: "314 EPS authoring sources (body parts, weapons, slash FX, Warlord popups — each sourceOf-linked to its PNG/component canonical) + 8 AI masters (7 character + 1 Warlord popup) + 10 .DS_Store system files (catalogVisible false). AI/EPS are formats, not families. Provenance only. Locked 2026-08-15.",
  },
};

/**
 * Classify a single file. Returns { family, asset } or null.
 * rel is the path relative to PREFIX, e.g. "Assassin/PNG/PNG Sequences/Front - Idle/Front - Idle_000.png"
 */
function classify(rel, file) {
  const fileName = rel.split("/").pop();
  const ext = file.extension?.toLowerCase() ?? "";
  const parts = rel.split("/");
  const identityName = parts[0];
  const rest = parts.slice(1).join("/");
  const base = { reviewStatus: "reviewed", runtimeStatus: "reference-only", worldRole: "PVE_1_20" };

  // --- .DS_Store system files ---
  if (fileName === ".DS_Store") {
    return {
      family: "voiddesert_monster_source",
      asset: {
        ...base,
        assetRole: "system-file",
        catalogVisible: false,
        runtimeEligible: false,
        placeable: false,
        displayName: "system file",
        canonicalName: `system_voiddesert_${mobId(identityName)}_ds_store`,
        renameStatus: "keep",
        description: ".DS_Store system file — catalogVisible false, not counted in family tallies.",
      },
    };
  }

  const isWarlord = identityName === "Warlord";
  const mid = mobId(identityName);

  // --- AI masters ---
  if (ext === ".ai") {
    const isPopup = /popup/i.test(fileName);
    return {
      family: "voiddesert_monster_source",
      asset: {
        ...base,
        assetRole: "authoring-master",
        sourceRole: isPopup ? "popup-master" : "character-master",
        format: "illustrator",
        monsterId: mid,
        monsterType: isWarlord ? "boss_npc" : "combat_mob",
        runtimeEligible: false,
        placeable: false,
        displayName: `${identityName} ${isPopup ? "popup" : ""} Illustrator master`,
        canonicalName: isPopup ? `source_voiddesert_${mid}_popup_master_ai` : `source_voiddesert_${mid}_master_ai`,
        renameStatus: "keep",
        description: `Illustrator master for the ${identityName} ${isPopup ? "dialogue popup" : "character"} package (${isWarlord ? "expressive boss NPC" : "directional combat mob"}).`,
      },
    };
  }

  // --- Popup PNGs (Warlord dialogue UI) ---
  if (/popup\/PNG\//.test(rest) && ext === ".png") {
    const isLarge = fileName === "popup_2.png";
    return {
      family: "voiddesert_monster_dialogue_ui",
      asset: {
        ...base,
        assetRole: "dialogue-ui",
        monsterId: mid,
        monsterType: "boss_npc",
        sharedVisual: true,
        uiAsset: isLarge ? "ui_dialogue_bubble_large" : "ui_dialogue_bubble_small",
        runtimeEligible: true,
        placeable: false,
        displayName: `dialogue bubble ${isLarge ? "large" : "small"} (Warlord copy)`,
        canonicalName: isLarge ? "ui_dialogue_bubble_large" : "ui_dialogue_bubble_small",
        renameStatus: "keep",
        description: `${isLarge ? "Large" : "Small"} dialogue speech bubble (${file.width}x${file.height}) — same dimensions as Clover/HappyValley bubbles, logically deduped.`,
      },
    };
  }

  // --- Animation frames (PNG Sequences) ---
  if (/PNG Sequences\//.test(rest)) {
    const stateDir = rest.match(/PNG Sequences\/([^/]+)\//)[1];
    // Combat mobs: "<Dir> - <Anim>"; Warlord: "<Anim>" only. Dying has no direction.
    // State names can have case variants (e.g. "Idle blinking" vs "Idle Blinking") —
    // resolve case-insensitively against ANIM_MAP keys.
    const stateAnim = stateDir.includes(" - ") ? stateDir.split(" - ").pop() : stateDir;
    const anim = ANIM_MAP[stateAnim] ?? ANIM_MAP[stateDir] ?? Object.entries(ANIM_MAP).find(([k]) => k.toLowerCase() === stateAnim.toLowerCase())?.[1];
    if (!anim) return null;
    const frameMatch = fileName.match(/(\d{3})\.png$/);
    if (!frameMatch) return null;
    const frame = parseInt(frameMatch[1], 10);
    const frameLabel = String(frame).padStart(3, "0");
    if (isWarlord) {
      return {
        family: "voiddesert_monster_animation",
        asset: {
          ...base,
          assetRole: "animation-frame",
          monsterId: mid,
          monsterType: "boss_npc",
          animation: anim,
          direction: null,
          frame,
          frameCount: 30,
          renderMode: "complete-character",
          runtimeEligible: true,
          placeable: false,
          displayName: `${identityName} ${anim.replace(/_/g, " ")} ${frameLabel}`,
          canonicalName: `monster_voiddesert_${mid}_${anim}_${frameLabel}`,
          renameStatus: "keep",
          description: `${anim.replace(/_/g, " ")} animation frame ${frameLabel} for ${identityName} (${file.width}x${file.height}, 700x700 expressive boss NPC — NOT directional).`,
        },
      };
    }
    // combat mob: direction from state prefix
    const dir = stateDir.includes(" - ") ? (DIR_MAP[stateDir.split(" - ")[0]] ?? null) : null;
    const animId = anim === "death" ? "death" : anim;
    return {
      family: "voiddesert_monster_animation",
      asset: {
        ...base,
        assetRole: "animation-frame",
        monsterId: mid,
        monsterType: "combat_mob",
        animation: animId,
        direction: dir,
        frame,
        frameCount: 10,
        renderMode: "complete-character",
        runtimeEligible: true,
        placeable: false,
        displayName: `${identityName} ${animId.replace(/_/g, " ")} ${dir ?? ""} ${frameLabel}`.replace(/\s+/g, " "),
        canonicalName: `monster_voiddesert_${mid}_${animId}${dir ? "_" + dir : ""}_${frameLabel}`,
        renameStatus: "keep",
        description: `${animId.replace(/_/g, " ")} animation frame ${frameLabel} (${dir ?? "no direction"}) for ${identityName} (${file.width}x${file.height}, 480x480 directional combat mob).`,
      },
    };
  }

  // --- Spritesheets (combat mobs only) ---
  if (/Spritesheets\//.test(rest) && ext === ".png") {
    const stateDir = fileName.replace(/\.png$/i, "");
    const stateAnim = stateDir.includes(" - ") ? stateDir.split(" - ").pop() : stateDir;
    const anim = ANIM_MAP[stateAnim] ?? ANIM_MAP[stateDir] ?? Object.entries(ANIM_MAP).find(([k]) => k.toLowerCase() === stateAnim.toLowerCase())?.[1];
    if (!anim) return null;
    const dir = stateDir.includes(" - ") ? (DIR_MAP[stateDir.split(" - ")[0]] ?? null) : null;
    return {
      family: "voiddesert_monster_animation",
      asset: {
        ...base,
        assetRole: "animation-sheet",
        monsterId: mid,
        monsterType: "combat_mob",
        animation: anim,
        direction: dir,
        renderMode: "complete-character",
        runtimeEligible: true,
        placeable: false,
        displayName: `${identityName} ${anim.replace(/_/g, " ")} ${dir ?? ""} sheet`.replace(/\s+/g, " "),
        canonicalName: `monster_voiddesert_${mid}_${anim}${dir ? "_" + dir : ""}_sheet`,
        renameStatus: "keep",
        description: `Combined ${anim.replace(/_/g, " ")} spritesheet (${dir ?? "no direction"}) for ${identityName} (${file.width}x${file.height}).`,
      },
    };
  }

  // --- Vector Parts ---
  if (/Vector Parts\//.test(rest)) {
    const partName = fileName.replace(/\.(png|scml)$/i, "");
    // SCML animation sources
    if (ext === ".scml") {
      return {
        family: "voiddesert_monster_component",
        asset: {
          ...base,
          assetRole: "animation-source",
          format: "scml",
          monsterId: mid,
          monsterType: isWarlord ? "boss_npc" : "combat_mob",
          runtimeEligible: false,
          placeable: false,
          displayName: `${identityName} Animations SCML`,
          canonicalName: `source_voiddesert_${mid}_animations_scml`,
          renameStatus: "keep",
          description: `Spriter-style animation definition file for ${identityName} (${fileName}).`,
        },
      };
    }
    if (ext !== ".png") return null;

    if (isWarlord) {
      // Warlord parts: Body, Head, Face_01..09, Left/Right Arm/Hand/Leg, anvil
      if (/^anvil$/i.test(partName)) {
        return {
          family: "voiddesert_monster_component",
          asset: {
            ...base,
            assetRole: "character-component",
            monsterId: mid,
            monsterType: "boss_npc",
            component: "prop",
            propRole: "anvil",
            runtimeEligible: false,
            placeable: false,
            displayName: "warlord anvil",
            canonicalName: "monster_prop_voiddesert_warlord_anvil",
            renameStatus: "keep",
            description: `Anvil prop (${file.width}x${file.height}) in the Warlord vector-parts package.`,
          },
        };
      }
      const face = partName.match(/^Face_(\d{2})$/);
      if (face) {
        return {
          family: "voiddesert_monster_component",
          asset: {
            ...base,
            assetRole: "character-component",
            monsterId: mid,
            monsterType: "boss_npc",
            component: "face",
            side: "none",
            variant: face[1],
            runtimeEligible: false,
            placeable: false,
            displayName: `${identityName} face ${face[1]}`,
            canonicalName: `monster_component_voiddesert_${mid}_face_${face[1]}`,
            renameStatus: "keep",
            description: `Face variant ${face[1]} for ${identityName} (${file.width}x${file.height}).`,
          },
        };
      }
      const wPart = PART_MAP[partName.replace(/_/g, " ")];
      if (wPart) {
        return {
          family: "voiddesert_monster_component",
          asset: {
            ...base,
            assetRole: "character-component",
            monsterId: mid,
            monsterType: "boss_npc",
            component: wPart.component,
            side: wPart.side,
            runtimeEligible: false,
            placeable: false,
            displayName: `${identityName} ${wPart.side !== "none" ? wPart.side + " " : ""}${wPart.component}`,
            canonicalName: `monster_component_voiddesert_${mid}${wPart.side !== "none" ? "_" + wPart.side : ""}_${wPart.component}`,
            renameStatus: "keep",
            description: `${wPart.side !== "none" ? wPart.side + " " : ""}${wPart.component} component for ${identityName} (${file.width}x${file.height}, 400x400 boss-NPC scale).`,
          },
        };
      }
      return null;
    }

    // Combat mob vector parts
    // Melee weapon
    const weapon = partName.match(/^Melee Weapon(?: - (L View|R View))?$/);
    if (weapon) {
      const dir = weapon[1] ? DIR_MAP[weapon[1]] : null;
      return {
        family: "voiddesert_monster_weapon",
        asset: {
          ...base,
          assetRole: "character-weapon",
          monsterId: mid,
          monsterType: "combat_mob",
          weaponType: "melee",
          direction: dir,
          runtimeEligible: true,
          placeable: false,
          displayName: `${identityName} melee weapon${dir ? " " + dir : ""}`.replace(/\s+/g, " "),
          canonicalName: `monster_weapon_voiddesert_${mid}_melee${dir ? "_" + dir : ""}`,
          renameStatus: "keep",
          description: `Melee weapon for ${identityName} (${file.width}x${file.height})${dir ? `, ${dir} view` : ""}. weaponType stays melee — no sword/dagger/club guessed.`,
        },
      };
    }
    // Slash FX
    const slash = partName.match(/^Slash FX (\d{2})$/);
    if (slash) {
      return {
        family: "voiddesert_monster_combat_fx",
        asset: {
          ...base,
          assetRole: "combat-effect",
          monsterId: mid,
          monsterType: "combat_mob",
          effect: "slash",
          variant: slash[1],
          runtimeEligible: true,
          placeable: false,
          displayName: `${identityName} slash FX ${slash[1]}`,
          canonicalName: `effect_voiddesert_${mid}_slash_${slash[1]}`,
          renameStatus: "keep",
          description: `Slash FX variant ${slash[1]} for ${identityName} (${file.width}x${file.height}) — one slash family, variants 00-02.`,
        },
      };
    }
    // Face N - dir
    const face = partName.match(/^Face (\d{2})(?: - (.+))?$/);
    if (face) {
      const variant = face[1];
      const dir = face[2] ? DIR_MAP[face[2]] : null;
      return {
        family: "voiddesert_monster_component",
        asset: {
          ...base,
          assetRole: "character-component",
          monsterId: mid,
          monsterType: "combat_mob",
          component: "face",
          side: "none",
          variant,
          direction: dir,
          runtimeEligible: false,
          placeable: false,
          displayName: `${identityName} face ${variant}${dir ? " " + dir : ""}`.replace(/\s+/g, " "),
          canonicalName: `monster_component_voiddesert_${mid}_face_${variant}${dir ? "_" + dir : ""}`,
          renameStatus: "keep",
          description: `Face variant ${variant}${dir ? ` (${dir})` : ""} for ${identityName} (${file.width}x${file.height}).`,
        },
      };
    }
    // Body/Head/limbs: "<Part> - <Dir>"
    const m = partName.match(/^(Body|Head|Left Arm|Right Arm|Left Hand|Right Hand|Left Leg|Right Leg)(?: - (.+))?$/);
    if (m) {
      const part = PART_MAP[m[1]];
      const dir = m[2] ? DIR_MAP[m[2]] : null;
      return {
        family: "voiddesert_monster_component",
        asset: {
          ...base,
          assetRole: "character-component",
          monsterId: mid,
          monsterType: "combat_mob",
          component: part.component,
          side: part.side,
          direction: dir,
          runtimeEligible: false,
          placeable: false,
          displayName: `${identityName} ${part.side !== "none" ? part.side + " " : ""}${part.component}${dir ? " " + dir : ""}`.replace(/\s+/g, " "),
          canonicalName: `monster_component_voiddesert_${mid}${part.side !== "none" ? "_" + part.side : ""}_${part.component}${dir ? "_" + dir : ""}`,
          renameStatus: "keep",
          description: `${part.side !== "none" ? part.side + " " : ""}${part.component} component${dir ? ` (${dir})` : ""} for ${identityName} (${file.width}x${file.height}).`,
        },
      };
    }
    return null;
  }

  // --- EPS authoring sources ---
  if (ext === ".eps") {
    const epsName = fileName.replace(/\.eps$/i, "").trim();
    // Warlord popup EPS
    if (/^popup_pop_up_1$/i.test(epsName) || /^popup_pop_up_2$/i.test(epsName)) {
      const isLarge = /2$/.test(epsName);
      return {
        family: "voiddesert_monster_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          monsterId: mid,
          monsterType: "boss_npc",
          sourceOf: isLarge ? "ui_dialogue_bubble_large" : "ui_dialogue_bubble_small",
          runtimeEligible: false,
          placeable: false,
          displayName: `warlord popup ${isLarge ? "large" : "small"} EPS source`,
          canonicalName: `source_voiddesert_${mid}_popup_${isLarge ? "large" : "small"}_eps`,
          renameStatus: "keep",
          description: `EPS authoring source for the Warlord ${isLarge ? "large" : "small"} dialogue bubble.`,
        },
      };
    }
    // Warlord component EPS: Warlord_Body.eps, Warlord_Face_1.eps (1-9), Warlord_Left_Arm.eps, Warlord_Swords.eps
    if (isWarlord) {
      const stem = epsName.startsWith("Warlord_") ? epsName.slice("Warlord_".length) : epsName;
      if (stem === "Swords") {
        return {
          family: "voiddesert_monster_source",
          asset: {
            ...base,
            assetRole: "authoring-source",
            sourceRole: "authoring-frame",
            format: "eps",
            monsterId: mid,
            monsterType: "boss_npc",
            sourceOf: "monster_weapon_voiddesert_warlord_melee",
            runtimeEligible: false,
            placeable: false,
            displayName: "warlord swords EPS source",
            canonicalName: "source_voiddesert_warlord_swords_eps",
            renameStatus: "keep",
            description: "EPS authoring source for the Warlord swords (melee weapon).",
          },
        };
      }
      const face = stem.match(/^Face_(\d{1,2})$/);
      if (face) {
        const variant = String(face[1]).padStart(2, "0");
        return {
          family: "voiddesert_monster_source",
          asset: {
            ...base,
            assetRole: "authoring-source",
            sourceRole: "authoring-frame",
            format: "eps",
            monsterId: mid,
            monsterType: "boss_npc",
            sourceOf: `monster_component_voiddesert_${mid}_face_${variant}`,
            runtimeEligible: false,
            placeable: false,
            displayName: `warlord face ${variant} EPS source`,
            canonicalName: `source_voiddesert_${mid}_face_${variant}_eps`,
            renameStatus: "keep",
            description: `EPS authoring source for Warlord face variant ${variant}.`,
          },
        };
      }
      const wPart = PART_MAP[stem.replace(/_/g, " ")];
      if (wPart) {
        const compName = wPart.side !== "none" ? `${wPart.side}_${wPart.component}` : wPart.component;
        return {
          family: "voiddesert_monster_source",
          asset: {
            ...base,
            assetRole: "authoring-source",
            sourceRole: "authoring-frame",
            format: "eps",
            monsterId: mid,
            monsterType: "boss_npc",
            sourceOf: `monster_component_voiddesert_${mid}_${compName}`,
            runtimeEligible: false,
            placeable: false,
            displayName: `warlord ${compName} EPS source`,
            canonicalName: `source_voiddesert_${mid}_${compName}_eps`,
            renameStatus: "keep",
            description: `EPS authoring source for Warlord ${compName} component.`,
          },
        };
      }
      return null;
    }

    // Combat mob EPS: Assassin_Body - Back.eps, Assassin_Slash FX 00.eps, Assassin_Melee Weapon.eps
    const mobName = COMBAT_MOBS.find((m) => epsName.startsWith(m));
    if (!mobName) return null;
    const midC = mobId(mobName);
    const restEps = epsName.slice(mobName.length + 1);

    // Slash FX
    const slash = restEps.match(/^Slash FX (\d{2})$/);
    if (slash) {
      return {
        family: "voiddesert_monster_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          monsterId: midC,
          monsterType: "combat_mob",
          sourceOf: `effect_voiddesert_${midC}_slash_${slash[1]}`,
          runtimeEligible: false,
          placeable: false,
          displayName: `${mobName} slash FX ${slash[1]} EPS source`,
          canonicalName: `source_voiddesert_${midC}_slash_${slash[1]}_eps`,
          renameStatus: "keep",
          description: `EPS authoring source for ${mobName} slash FX variant ${slash[1]}.`,
        },
      };
    }
    // Melee weapon
    const weapon = restEps.match(/^Melee Weapon(?: - (L View|R View))?$/);
    if (weapon) {
      const dir = weapon[1] ? DIR_MAP[weapon[1]] : null;
      return {
        family: "voiddesert_monster_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          monsterId: midC,
          monsterType: "combat_mob",
          sourceOf: `monster_weapon_voiddesert_${midC}_melee${dir ? "_" + dir : ""}`,
          runtimeEligible: false,
          placeable: false,
          displayName: `${mobName} melee weapon${dir ? " " + dir : ""} EPS source`.replace(/\s+/g, " "),
          canonicalName: `source_voiddesert_${midC}_melee${dir ? "_" + dir : ""}_eps`,
          renameStatus: "keep",
          description: `EPS authoring source for ${mobName} melee weapon${dir ? ` (${dir})` : ""}.`,
        },
      };
    }
    // Face N - dir
    const face = restEps.match(/^Face (\d{2})(?: - (.+))?$/);
    if (face) {
      const variant = face[1];
      const dir = face[2] ? DIR_MAP[face[2]] : null;
      return {
        family: "voiddesert_monster_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          monsterId: midC,
          monsterType: "combat_mob",
          sourceOf: `monster_component_voiddesert_${midC}_face_${variant}${dir ? "_" + dir : ""}`,
          runtimeEligible: false,
          placeable: false,
          displayName: `${mobName} face ${variant}${dir ? " " + dir : ""} EPS source`.replace(/\s+/g, " "),
          canonicalName: `source_voiddesert_${midC}_face_${variant}${dir ? "_" + dir : ""}_eps`,
          renameStatus: "keep",
          description: `EPS authoring source for ${mobName} face variant ${variant}${dir ? ` (${dir})` : ""}.`,
        },
      };
    }
    // Body/Head/limbs
    const m = restEps.match(/^(Body|Head|Left Arm|Right Arm|Left Hand|Right Hand|Left Leg|Right Leg)(?: - (.+))?$/);
    if (m) {
      const part = PART_MAP[m[1]];
      const dir = m[2] ? DIR_MAP[m[2]] : null;
      const compName = part.side !== "none" ? `${part.side}_${part.component}` : part.component;
      return {
        family: "voiddesert_monster_source",
        asset: {
          ...base,
          assetRole: "authoring-source",
          sourceRole: "authoring-frame",
          format: "eps",
          monsterId: midC,
          monsterType: "combat_mob",
          sourceOf: `monster_component_voiddesert_${midC}_${compName}${dir ? "_" + dir : ""}`,
          runtimeEligible: false,
          placeable: false,
          displayName: `${mobName} ${compName}${dir ? " " + dir : ""} EPS source`.replace(/\s+/g, " "),
          canonicalName: `source_voiddesert_${midC}_${compName}${dir ? "_" + dir : ""}_eps`,
          renameStatus: "keep",
          description: `EPS authoring source for ${mobName} ${compName} component${dir ? ` (${dir})` : ""}.`,
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

  // Idempotent: remove previous VoidDesert monster review families only.
  const OWNED = Object.keys(FAMILY_META);
  for (const key of Object.keys(reviews.reviews)) {
    if (key.startsWith(`${PACK}/`) && OWNED.includes(key.split("/")[1])) delete reviews.reviews[key];
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
      vdMonsterFamilyType: meta.vdMonsterFamilyType,
      worldRole: meta.worldRole,
      notes: meta.notes,
      assets,
    };
  }

  const counts = Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, Object.keys(v).length]));
  const classified = files.length - unclassified;
  console.log(`[voiddesert-monster] ${classified}/${files.length} classified (${unclassified} unclassified)`);
  console.log(JSON.stringify(counts, null, 1));

  // Verify totals
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(total === 2993 ? "✓ 2993/2993 total" : `✗ TOTAL ${total} != 2993`);

  // Verify per-identity math
  const byIdent = {};
  for (const f of files) {
    const mid = f.path.slice(PREFIX.length).split("/")[0];
    byIdent[mid] = (byIdent[mid] || 0) + 1;
  }
  const combatTotal = ["Assassin", "Chief Goblin", "Female Goblin", "Male Goblin", "Robber", "Thug"].reduce((a, n) => a + (byIdent[n] || 0), 0);
  console.log(`combat mobs: ${combatTotal} (expect ~2740) · warlord: ${byIdent["Warlord"]} (expect 253) · total ${combatTotal + (byIdent["Warlord"] || 0)}`);

  // Verify key counts: EPS 314, AI 8, combat frames 1980, warlord frames 210
  const eps = files.filter((f) => f.extension?.toLowerCase() === ".eps").length;
  const ai = files.filter((f) => f.extension?.toLowerCase() === ".ai").length;
  const combatFrames = files.filter((f) => /PNG Sequences/.test(f.path) && !/Warlord/.test(f.path) && f.extension === ".png").length;
  const warlordFrames = files.filter((f) => /PNG Sequences/.test(f.path) && /Warlord/.test(f.path) && f.extension === ".png").length;
  console.log(`EPS ${eps} (expect 314) · AI ${ai} (expect 8) · combat frames ${combatFrames} (expect 1980) · warlord frames ${warlordFrames} (expect 210)`);
  const ok = eps === 314 && ai === 8 && combatFrames === 1980 && warlordFrames === 210 && total === 2993;
  console.log(ok ? "✓ All audit totals match" : "✗ AUDIT TOTALS MISMATCH");

  reviews.generatedAt = new Date().toISOString();
  await writeFile(reviewsPath, JSON.stringify(reviews, null, 2) + "\n", "utf8");
  console.log("reviews written:", reviewsPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
