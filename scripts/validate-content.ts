#!/usr/bin/env node
/**
 * Validates src/data content integrity via the shared ContentValidator.
 * Usage: node scripts/validate-content.ts
 * Exits 0 on success, 1 with a list of errors otherwise.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateContent,
  validateStaticContent,
  validateQuestSearchObjects,
  validateZoneMapParity,
  validateMonsterSpawnKeys,
} from "../src/systems/ContentValidator.ts";
import type { ContentData, StaticContentData } from "../src/types/ContentData.ts";
import { validateAllMaps, validateNpcPlacement } from "../src/systems/MapValidator.ts";
import { ARCHIVED_MAPS } from "../src/game/ArchivedMaps.ts";
import { auditCompositionPlans, COMPOSITION_PLAN_JSON } from "../src/game/compositionPlans.ts";

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

// Cross-check quest/map/zone references against the client map registry.
const interactableIds = new Set<string>();
for (const map of Object.values(ARCHIVED_MAPS)) {
  for (const object of map.interactables) interactableIds.add(object.id);
}
const searchResult = validateQuestSearchObjects(data.quests, interactableIds);
const parityResult = validateZoneMapParity(staticData.zones, ARCHIVED_MAPS);
const spawnKeyResult = validateMonsterSpawnKeys(
  ARCHIVED_MAPS,
  new Set(staticData.monsters.map((monster) => monster.key)),
);

for (const w of [...result.warnings, ...searchResult.warnings]) console.warn(`  ! ${w}`);

const allResults = [result, staticResult, searchResult, parityResult, spawnKeyResult];
if (allResults.some((r) => !r.ok)) {
  const errors = allResults.flatMap((r) => r.errors);
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

// Compose plans are authored content too: a plan that no longer matches its map
// would fall back to the defaults in the client, quietly losing the composition.
const compositionErrors = auditCompositionPlans();
if (compositionErrors.length > 0) {
  console.error(
    `Composition validation FAILED (${compositionErrors.length} error${compositionErrors.length > 1 ? "s" : ""}):`,
  );
  for (const e of compositionErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const interactableCount = Object.values(ARCHIVED_MAPS).reduce(
  (n, m) => n + m.interactables.length,
  0,
);
console.log(
  `Composition validation PASSED — ${Object.keys(COMPOSITION_PLAN_JSON).length} authored plan(s).`,
);
console.log(
  `Content validation PASSED — ${data.npcs.length} npcs, ${data.items.length} items, ${data.quests.length} quests, ${data.upgrades.length} upgrades, ${data.dialogue.length} dialogue sets; ${staticData.classes.length} classes, ${staticData.skills.length} skills, ${staticData.monsters.length} monsters, ${staticData.zones.length} zones; ${Object.keys(ARCHIVED_MAPS).length} zone(s) mapped, ${interactableCount} interactable(s).`
);
