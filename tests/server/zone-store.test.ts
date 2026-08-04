import { describe, expect, it } from "vitest";
import { ZoneStore, type ZonePlayer } from "../../server/src/ws/zoneStore.ts";

function player(overrides: Partial<ZonePlayer> = {}): ZonePlayer {
  return {
    characterId: 1,
    accountId: 7,
    name: "Maple",
    classKey: "bear-warrior",
    pos: { x: 5, y: 5 },
    connected: true,
    lastMoveAt: 0,
    dirty: false,
    lastPersistAt: 0,
    hp: 100,
    maxHp: 100,
    attack: 10,
    defense: 5,
    speed: 150,
    critChance: 2,
    critMultiplier: 1.5,
    lastAttackAt: 0,
    invulnUntil: 0,
    ...overrides,
  };
}

describe("ZoneStore", () => {
  it("joins a player into a zone and reports a fresh join", () => {
    const store = new ZoneStore();
    const isNew = store.join("zone-clover-village", player());
    expect(isNew).toBe(true);
    expect(store.players("zone-clover-village")).toHaveLength(1);
    expect(store.isTracked(1)).toBe(true);
  });

  it("reports a reconnect as already-present (grace restore)", () => {
    const store = new ZoneStore();
    store.join("zone-clover-village", player());
    const isNew = store.join("zone-clover-village", player({ connected: false }));
    expect(isNew).toBe(false);
  });

  it("keeps multiple players in the same zone", () => {
    const store = new ZoneStore();
    store.join("zone-clover-village", player({ characterId: 1 }));
    store.join("zone-clover-village", player({ characterId: 2, name: "Birch" }));
    expect(store.players("zone-clover-village")).toHaveLength(2);
    expect(store.snapshot("zone-clover-village").map((p) => p.characterId)).toEqual([1, 2]);
  });

  it("snapshot only includes connected players", () => {
    const store = new ZoneStore();
    store.join("zone-clover-village", player({ characterId: 1 }));
    store.join(
      "zone-clover-village",
      player({ characterId: 2, name: "Disconnected", connected: false }),
    );
    const snap = store.snapshot("zone-clover-village");
    expect(snap.map((p) => p.characterId)).toEqual([1]);
  });

  it("leave removes the player and cleans up empty zones", () => {
    const store = new ZoneStore();
    store.join("zone-clover-village", player());
    const removed = store.leave("zone-clover-village", 1);
    expect(removed?.characterId).toBe(1);
    expect(store.players("zone-clover-village")).toHaveLength(0);
    expect(store.zoneIds()).toEqual([]);
    expect(store.isTracked(1)).toBe(false);
  });

  it("leave returns null for a player not in the zone", () => {
    const store = new ZoneStore();
    store.join("zone-clover-village", player());
    expect(store.leave("zone-clover-village", 999)).toBeNull();
    expect(store.leave("zone-unknown", 1)).toBeNull();
  });

  it("get returns the player or null", () => {
    const store = new ZoneStore();
    store.join("zone-clover-village", player());
    expect(store.get("zone-clover-village", 1)?.name).toBe("Maple");
    expect(store.get("zone-clover-village", 2)).toBeNull();
  });

  it("snapshot copies positions (mutations do not leak)", () => {
    const store = new ZoneStore();
    store.join("zone-clover-village", player());
    const snap = store.snapshot("zone-clover-village");
    snap[0].pos.x = 99;
    expect(store.get("zone-clover-village", 1)?.pos.x).toBe(5);
  });

  it("tracks players across multiple zones", () => {
    const store = new ZoneStore();
    store.join("zone-clover-village", player({ characterId: 1 }));
    store.join("zone-happy-valley", player({ characterId: 2 }));
    expect(store.zoneIds()).toEqual(["zone-clover-village", "zone-happy-valley"]);
    expect(store.isTracked(2)).toBe(true);
    expect(store.isTracked(3)).toBe(false);
  });
});
