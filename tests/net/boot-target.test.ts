import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOOT_ZONE,
  type BootCharacter,
  pickCharacter,
  resolveBootTarget,
} from "../../src/net/bootTarget.ts";
import { ZoneKeys } from "../../src/game/GameConstants.ts";
import { PLAYABLE_MAPS } from "../../src/game/Maps.ts";

function char(overrides: Partial<BootCharacter> = {}): BootCharacter {
  return {
    id: 1,
    name: "Birch",
    class_id: 1,
    zone_id: ZoneKeys.HappyValley,
    pos_x: 15,
    pos_y: 13,
    level: 1,
    ...overrides,
  };
}

describe("resolveBootTarget", () => {
  it("boots a courier whose saved zone is playable", () => {
    const target = resolveBootTarget([char({ zone_id: ZoneKeys.CloverVillage })]);
    expect(target.zoneId).toBe(ZoneKeys.CloverVillage);
    expect(target.pos).toEqual({ x: 15, y: 13 });
  });

  it("returns the registered saved position instead of the hub spawn", () => {
    const target = resolveBootTarget([char({ zone_id: ZoneKeys.HappyValley, pos_x: 7, pos_y: 9 })]);
    expect(target).toEqual({ zoneId: ZoneKeys.HappyValley, pos: { x: 7, y: 9 } });
  });

  it("falls back to the hub when the saved zone is not registered", () => {
    const target = resolveBootTarget([char({ zone_id: "zone-not-registered" })]);
    expect(target.zoneId).toBe(DEFAULT_BOOT_ZONE);
    expect(target.zoneId).toBe(ZoneKeys.CloverVillage);
    const hub = PLAYABLE_MAPS[ZoneKeys.CloverVillage];
    expect(target.pos).toEqual({ x: hub.spawn.x, y: hub.spawn.y });
  });

  it("falls back to the hub for an empty empty-list boot", () => {
    expect(resolveBootTarget(undefined).zoneId).toBe(DEFAULT_BOOT_ZONE);
    expect(resolveBootTarget([]).zoneId).toBe(DEFAULT_BOOT_ZONE);
  });

  it("uses the server-selected courier when several exist", () => {
    const target = resolveBootTarget(
      [char({ zone_id: ZoneKeys.CloverVillage }), char({ id: 2, pos_x: 21, pos_y: 22, zone_id: ZoneKeys.CloverVillage })],
      2,
    );
    expect(target).toEqual({ zoneId: ZoneKeys.CloverVillage, pos: { x: 21, y: 22 } });
  });

  it("falls back to the first character when the server selection is stale", () => {
    const target = resolveBootTarget(
      [char({ zone_id: ZoneKeys.CloverVillage }), char({ id: 2, zone_id: "zone-not-registered" })],
      999,
    );
    expect(target.zoneId).toBe(ZoneKeys.CloverVillage);
  });
});

describe("pickCharacter", () => {
  it("returns the player's chosen courier when it still exists", () => {
    const picked = pickCharacter(
      [char(), char({ id: 2, name: "Maple" })],
      2,
    );
    expect(picked?.name).toBe("Maple");
  });

  it("falls back to the first courier when no selection is stored", () => {
    const picked = pickCharacter([char(), char({ id: 2 })], null);
    expect(picked?.id).toBe(1);
  });

  it("falls back to the first courier when the selection is stale", () => {
    const picked = pickCharacter([char(), char({ id: 2 })], 999);
    expect(picked?.id).toBe(1);
  });

  it("returns null for an empty character list", () => {
    expect(pickCharacter([], 1)).toBeNull();
    expect(pickCharacter(undefined, 1)).toBeNull();
  });
});
