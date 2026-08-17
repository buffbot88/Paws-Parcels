import { describe, expect, it } from "vitest";
import questsJson from "../../src/data/quests.json";
import zonesJson from "../../src/data/zones.json";
import monstersJson from "../../src/data/monsters.json";
import { MAPS } from "../../src/game/Maps.ts";
import {
  validateQuestSearchObjects,
  validateZoneMapParity,
  validateMonsterSpawnKeys,
} from "../../src/systems/ContentValidator.ts";
import { isShippedQuest } from "../../server/src/models/questFilter.ts";
import type { QuestDefinition } from "../../src/types/QuestTypes.ts";

const quests = questsJson.quests as QuestDefinition[];

// The shipped set is derived from the SAME predicate the server filter uses
// (server/src/models/Quest.ts), so the pin below can never drift from it.

const interactableIds = new Set<string>();
for (const map of Object.values(MAPS)) {
  for (const object of map.interactables) interactableIds.add(object.id);
}

describe("shipped quest set is pinned", () => {
  it("ships exactly the authored tutorial/side quests", () => {
    const shipped = quests.filter(isShippedQuest).map((q) => q.id).sort();
    expect(shipped).toEqual([
      "quest-biscuit-golden-honey",
      "quest-biscuit-ingredient-run",
      "quest-flower-note-maple",
      "quest-fresh-bread-biscuit",
      "quest-garden-greeting-moss",
      "quest-lost-pebble-moss",
      "quest-lumi-golden-acorn",
      "quest-lumis-lost-notebook",
      "quest-maple-flower-crown",
      "quest-moon-note-lumi",
      "quest-moss-garden-key",
      "quest-picnic-for-maple",
      "quest-pip-courier-cap",
      "quest-pip-letter-opener",
      "quest-village-welcome",
    ]);
  });
});

describe("validateQuestSearchObjects", () => {
  it("passes the real shipped quests (their search objects all exist)", () => {
    const result = validateQuestSearchObjects(quests, interactableIds);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("errors when a shipped quest references a missing interactable", () => {
    const bad: QuestDefinition[] = [
      { id: "quest-x", title: "T", description: "d", type: "errand", giverId: "npc-a", chainPosition: 1, stampReward: 5, searchObjectId: "object-nope" },
    ];
    const result = validateQuestSearchObjects(bad, interactableIds);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("object-nope");
  });

  it("warns (not errors) when an unshipped quest references a missing interactable", () => {
    const bad: QuestDefinition[] = [
      { id: "quest-y", title: "T", description: "d", type: "errand", giverId: "npc-a", stampReward: 5, searchObjectId: "object-nope" },
    ];
    const result = validateQuestSearchObjects(bad, interactableIds);
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain("object-nope");
  });
});

describe("validateZoneMapParity", () => {
  it("zones.json matches the client maps for every zone", () => {
    const result = validateZoneMapParity(zonesJson.zones, MAPS);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("errors on a dimension or spawn mismatch", () => {
    const bad = [{ key: "zone-clover-village", widthTiles: 1, heightTiles: 1, defaultSpawn: { x: 0, y: 0 } }];
    const result = validateZoneMapParity(bad, MAPS);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("validateMonsterSpawnKeys", () => {
  it("every map monster-spawn key is defined in monsters.json", () => {
    const keys = new Set(monstersJson.monsters.map((m) => m.key));
    const result = validateMonsterSpawnKeys(MAPS, keys);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("errors when a spawn references an unknown monster key", () => {
    const maps = { "zone-x": { width: 5, height: 5, spawn: { x: 0, y: 0 }, monsterSpawns: [{ id: "s1", key: "monster-ghost" }] } };
    const result = validateMonsterSpawnKeys(maps, new Set(["monster-real"]));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("monster-ghost");
  });
});
