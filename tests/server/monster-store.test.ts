import { describe, expect, it } from "vitest";
import { MonsterStore, type MonsterPlayer } from "../../server/src/ws/monsterStore.ts";
import type { MonsterDefinitionRow } from "../../server/src/models/Monster.ts";
import type { BrainMonsterDecision } from "../../server/src/ai/prompts.ts";

function def(overrides: Partial<MonsterDefinitionRow> = {}): MonsterDefinitionRow {
  return {
    id: 1,
    key: "monster-wild-boar",
    display_name: "Wild Boar",
    zone_id: 2,
    family_id: "happy-valley",
    level_min: 2,
    level_max: 3,
    max_hp: 55,
    attack: 9,
    defense: 6,
    speed: 120,
    aggro_behavior: "aggro",
    attack_behavior: "melee",
    loot_table: [],
    respawn_seconds: 30,
    experience_reward: 20,
    ...overrides,
  };
}

function player(overrides: Partial<MonsterPlayer> = {}): MonsterPlayer {
  return {
    characterId: 10,
    pos: { x: 5, y: 5 },
    hp: 100,
    maxHp: 100,
    defense: 5,
    invulnUntil: 0,
    ...overrides,
  };
}

/** A 12x12 open field. */
const walkable = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < 12 && y < 12;

function seededStore(spawns = [{ id: "m1", key: "monster-wild-boar", x: 2, y: 2 }]) {
  const store = new MonsterStore();
  store.seed("zone-happy-valley", spawns, [def()]);
  return store;
}

describe("MonsterStore — lifecycle", () => {
  it("seeds one instance per spawn point", () => {
    const store = seededStore([
      { id: "m1", key: "monster-wild-boar", x: 2, y: 2 },
      { id: "m2", key: "monster-wild-boar", x: 6, y: 6 },
    ]);
    expect(store.monsters("zone-happy-valley")).toHaveLength(2);
  });

  it("skips spawn points whose definition is unknown", () => {
    const store = new MonsterStore();
    store.seed("zone-happy-valley", [{ id: "m1", key: "monster-nope", x: 2, y: 2 }], [def()]);
    expect(store.monsters("zone-happy-valley")).toHaveLength(0);
  });

  it("damage reduces hp and marks a lethal hit as dead", () => {
    const store = seededStore();
    const monster = store.get("zone-happy-valley", "m1");
    expect(monster?.hp).toBe(55);
    const lethal = store.damage("zone-happy-valley", "m1", 40);
    expect(lethal).toBe(false);
    expect(store.get("zone-happy-valley", "m1")?.hp).toBe(15);

    const lethal2 = store.damage("zone-happy-valley", "m1", 20);
    expect(lethal2).toBe(true);
    expect(store.get("zone-happy-valley", "m1")?.alive).toBe(false);
  });

  it("respawns a dead monster at its home after the timer", () => {
    const store = seededStore();
    store.damage("zone-happy-valley", "m1", 100);
    const dead = store.get("zone-happy-valley", "m1");
    expect(dead?.alive).toBe(false);

    // Advance time past the 30s respawn timer.
    const after = (dead?.respawnAt ?? 0) + 1;
    const events = store.update("zone-happy-valley", after, [], walkable, 50);
    expect(events).toEqual([]);
    const revived = store.get("zone-happy-valley", "m1");
    expect(revived?.alive).toBe(true);
    expect(revived?.hp).toBe(55);
    expect(revived?.pos).toEqual({ x: 2, y: 2 });
  });
});

describe("MonsterStore — AI behavior", () => {
  it("an aggressive monster chases the nearest player", () => {
    const store = seededStore();
    const now = 1000;
    const p = player({ pos: { x: 2, y: 4 } }); // 2 tiles below home (2,2)
    // Run several long steps so the monster closes the gap.
    for (let i = 0; i < 6; i++) {
      store.update("zone-happy-valley", now, [p], walkable, 1000);
    }
    const monster = store.get("zone-happy-valley", "m1");
    expect(monster?.pos.y).toBeGreaterThan(2);
  });

  it("attacks a player in melee range after cooldown", () => {
    const store = seededStore();
    const now = 10_000;
    const p = player({ pos: { x: 2, y: 3 } }); // adjacent to home (2,2)
    const events = store.update("zone-happy-valley", now, [p], walkable, 50);
    expect(events.length).toBe(1);
    expect(events[0].playerId).toBe(10);
    expect(events[0].damage).toBeGreaterThan(0);
  });

  it("does not attack twice within the cooldown", () => {
    const store = seededStore();
    const p = player({ pos: { x: 2, y: 3 } });
    store.update("zone-happy-valley", 10_000, [p], walkable, 50);
    const events = store.update("zone-happy-valley", 10_500, [p], walkable, 50);
    expect(events).toEqual([]);
  });

  it("ignores a player during the respawn invulnerability window", () => {
    const store = seededStore();
    const p = player({ pos: { x: 2, y: 3 }, invulnUntil: 20_000 });
    const events = store.update("zone-happy-valley", 10_000, [p], walkable, 50);
    expect(events).toEqual([]);
  });

  it("a passive monster stays idle until it carries a grudge", () => {
    const store = new MonsterStore();
    store.seed("zone-happy-valley", [{ id: "m1", key: "monster-hare", x: 2, y: 2 }], [
      def({
        key: "monster-hare",
        display_name: "Meadow Hare",
        max_hp: 20,
        attack: 4,
        defense: 2,
        aggro_behavior: "passive",
      }),
    ]);
    const p = player({ pos: { x: 2, y: 3 } });
    // Idle near the player → no attack.
    expect(store.update("zone-happy-valley", 10_000, [p], walkable, 50)).toEqual([]);

    // Once hit, the monster retaliates against its grudge target.
    store.aggroOn("zone-happy-valley", "m1", 10, 10_000);
    const events = store.update("zone-happy-valley", 10_000, [p], walkable, 50);
    expect(events.length).toBe(1);
    expect(events[0].playerId).toBe(10);
  });

  it("returns home when leashed too far", () => {
    const store = seededStore();
    const now = 1000;
    const p = player({ pos: { x: 2, y: 11 } }); // 9 tiles away — within leash
    for (let i = 0; i < 10; i++) {
      store.update("zone-happy-valley", now, [p], walkable, 1000);
    }
    // The monster should NOT have walked all the way to y=11 (leash range 10).
    const monster = store.get("zone-happy-valley", "m1");
    expect(monster?.pos.y).toBeLessThan(11);
  });

  it("moves at its tiles/sec rate, not one tile per tick", () => {
    // Regression: the old code moved Math.max(1, ...) tiles every tick, so at
    // 20Hz a 2.5 tiles/s monster ran at 20 tiles/s. With the fractional budget
    // a 50ms tick yields 0 whole tiles until the budget accrues.
    const store = seededStore();
    const p = player({ pos: { x: 2, y: 6 } }); // 4 tiles away — inside aggro range
    // 20 ticks of 50ms = 1s of game time = ~2.5 tiles for a 120 px/s monster.
    for (let i = 0; i < 20; i++) {
      store.update("zone-happy-valley", 1000 + i * 50, [p], walkable, 50);
    }
    const monster = store.get("zone-happy-valley", "m1");
    const moved = Math.abs(monster!.pos.y - 2) + Math.abs(monster!.pos.x - 2);
    expect(moved).toBeLessThanOrEqual(3);
    expect(moved).toBeGreaterThanOrEqual(2);
  });
});

describe("MonsterStore — brain decision overrides", () => {
  const decisions = (d: BrainMonsterDecision) => new Map([["m1", d]]);

  it("a seek decision moves the monster toward the target tile", () => {
    const store = seededStore();
    const decision = decisions({ action: "seek", targetPlayerId: null, targetTile: { x: 8, y: 2 } });
    for (let i = 0; i < 10; i++) {
      store.update("zone-happy-valley", 1000 + i * 1000, [], walkable, 1000, decision);
    }
    const monster = store.get("zone-happy-valley", "m1");
    expect(monster?.pos.x).toBeGreaterThan(2);
  });

  it("a patrol decision holds position once the tile is reached", () => {
    const store = seededStore();
    const decision = decisions({ action: "patrol", targetPlayerId: null, targetTile: { x: 2, y: 2 } });
    store.update("zone-happy-valley", 1000, [], walkable, 1000, decision);
    const monster = store.get("zone-happy-valley", "m1");
    expect(monster?.pos).toEqual({ x: 2, y: 2 });
  });

  it("a flee decision moves the monster away from the threat tile", () => {
    const store = seededStore();
    // Threat one tile north of home (2,2) — fleeing pushes the monster south.
    const decision = decisions({ action: "flee", targetPlayerId: null, targetTile: { x: 2, y: 1 } });
    for (let i = 0; i < 6; i++) {
      store.update("zone-happy-valley", 1000 + i * 1000, [], walkable, 1000, decision);
    }
    const monster = store.get("zone-happy-valley", "m1");
    // Fleeing from its own home tile pushes it off that tile.
    expect(monster?.pos).not.toEqual({ x: 2, y: 2 });
  });

  it("an attack decision strikes the named player in range", () => {
    const store = seededStore();
    const p = player({ pos: { x: 2, y: 3 } }); // adjacent to home (2,2)
    const decision = decisions({ action: "attack", targetPlayerId: 10, targetTile: null });
    const events = store.update("zone-happy-valley", 10_000, [p], walkable, 50, decision);
    expect(events.length).toBe(1);
    expect(events[0].playerId).toBe(10);
  });

  it("an attack decision chases when the target is out of range", () => {
    const store = seededStore();
    const p = player({ pos: { x: 2, y: 6 } });
    const decision = decisions({ action: "attack", targetPlayerId: 10, targetTile: null });
    for (let i = 0; i < 6; i++) {
      store.update("zone-happy-valley", 1000 + i * 1000, [p], walkable, 1000, decision);
    }
    const monster = store.get("zone-happy-valley", "m1");
    expect(monster?.pos.y).toBeGreaterThan(2);
  });

  it("falls back to deterministic AI when the decision's target is gone", () => {
    const store = seededStore();
    // attack names a player that is not present and no fallback target exists.
    const decision = decisions({ action: "attack", targetPlayerId: 999, targetTile: null });
    const events = store.update("zone-happy-valley", 10_000, [], walkable, 50, decision);
    expect(events).toEqual([]);
    // Monster stays put (no target, at home).
    const monster = store.get("zone-happy-valley", "m1");
    expect(monster?.pos).toEqual({ x: 2, y: 2 });
  });
});
