#!/usr/bin/env node
/**
 * Validates src/data content integrity via the shared ContentValidator.
 * Usage: node scripts/validate-content.ts
 * Exits 0 on success, 1 with a list of errors otherwise.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContent } from "../src/systems/ContentValidator.ts";
import type { ContentData } from "../src/types/ContentData.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "src", "data");

function load<K extends keyof ContentData>(name: string, key: K): ContentData[K] {
  const path = resolve(dataDir, name);
  if (!existsSync(path)) {
    console.error(`Missing data file: ${name}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"))[key];
}

const data: ContentData = {
  npcs: load("npcs.json", "npcs"),
  items: load("items.json", "items"),
  quests: load("quests.json", "quests"),
  upgrades: load("upgrades.json", "upgrades"),
  dialogue: load("dialogue.json", "dialogue"),
};

const result = validateContent(data);
for (const w of result.warnings) console.warn(`  ! ${w}`);

if (!result.ok) {
  console.error(`Content validation FAILED (${result.errors.length} error${result.errors.length > 1 ? "s" : ""}):`);
  for (const e of result.errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log(
  `Content validation PASSED — ${data.npcs.length} npcs, ${data.items.length} items, ${data.quests.length} quests, ${data.upgrades.length} upgrades, ${data.dialogue.length} dialogue sets.`
);
