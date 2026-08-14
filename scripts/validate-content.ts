#!/usr/bin/env node
/**
 * Validates src/data content integrity via the shared ContentValidator.
 * Usage: node scripts/validate-content.ts
 * Exits 0 on success, 1 with a list of errors otherwise.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContent, validateStaticContent } from "../src/systems/ContentValidator.ts";
import type { ContentData, StaticContentData } from "../src/types/ContentData.ts";
import { validateAllMaps, validateNpcPlacement } from "../src/systems/MapValidator.ts";
import { MAPS } from "../src/game/Maps.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "src", "data");

function load(name: string, key: string): any {
  const path = resolve(dataDir, name);
  if (!existsSync(path)) {
    console.error(`Missing data file: ${name}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"))[key];
  } catch (e) {
    console.error(`Invalid JSON in ${name}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

const data: ContentData = {
  npcs: load("npcs.json", "npcs"),
  items: load("items.json", "items"),
  quests: load("quests.json", "quests"),
  upgrades: load("upgrades.json", "upgrades"),
  dialogue: load("dialogue.json", "dialogue"),
};

const result = validateContent(data);
const staticData: StaticContentData = {
  classes: load("classes.json", "classes"),
  skills: load("skills.json", "skills"),
  zones: load("zones.json", "zones"),
  monsters: load("monsters.json", "monsters"),
};
const staticResult = validateStaticContent(staticData, new Set(data.items.map((item) => item.id)));
for (const w of result.warnings) console.warn(`  ! ${w}`);

if (!result.ok || !staticResult.ok) {
  const errors = [...result.errors, ...staticResult.errors];
  console.error(`Content validation FAILED (${errors.length} error${errors.length > 1 ? "s" : ""}):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const maps = validateAllMaps();
if (!maps.valid) {
  console.error(`Map validation FAILED (${maps.errors.length} error${maps.errors.length > 1 ? "s" : ""}):`);
  for (const e of maps.errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const npcPlacement = validateNpcPlacement(data.npcs);
if (npcPlacement.length > 0) {
  console.error(`NPC placement validation FAILED (${npcPlacement.length} error${npcPlacement.length > 1 ? "s" : ""}):`);
  for (const e of npcPlacement) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const interactableCount = Object.values(MAPS).reduce(
  (n, m) => n + m.interactables.length,
  0,
);
console.log(
  `Content validation PASSED — ${data.npcs.length} npcs, ${data.items.length} items, ${data.quests.length} quests, ${data.upgrades.length} upgrades, ${data.dialogue.length} dialogue sets; ${staticData.classes.length} classes, ${staticData.skills.length} skills, ${staticData.monsters.length} monsters, ${staticData.zones.length} zones; ${Object.keys(MAPS).length} zone(s) mapped, ${interactableCount} interactable(s).`
);
