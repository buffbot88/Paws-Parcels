import { describe, expect, it } from "vitest";
import { propBlockedTiles } from "../../src/game/propCollision.ts";
import { CloverVillageTextureKeys, getCloverVillageSetPieceDefinitions } from "../../src/game/cloverVillagePlacements.ts";
import { PLAYABLE_MAPS } from "../../src/game/Maps.ts";
import { TILES } from "../../src/game/Tiles.ts";
import npcsJson from "../../src/data/npcs.json" with { type: "json" };

describe("prop collision", () => {
  it("blocks the base of solid props and leaves greenery passable", () => {
    const blocked = propBlockedTiles("zone-clover-village");
    const pieces = getCloverVillageSetPieceDefinitions();
    const baseTile = (piece: { tileX: number; baseTileY: number }): string =>
      `${Math.floor(piece.tileX)},${Math.ceil(piece.baseTileY) - 1}`;
    for (const lamp of pieces.filter((p) => p.texture === CloverVillageTextureKeys.lampPost)) {
      expect(blocked.has(baseTile(lamp)), `lamp at ${lamp.tileX},${lamp.baseTileY}`).toBe(true);
    }
    const greenery = pieces.filter((p) => p.texture === CloverVillageTextureKeys.greenery);
    expect(greenery.length).toBeGreaterThan(0);
    // Greenery adds no blocking of its own: none of its base tiles is blocked unless a solid prop shares it.
    expect(greenery.some((p) => !blocked.has(baseTile(p)))).toBe(true);
  });

  it("is empty for a zone without placements", () => {
    expect(propBlockedTiles("zone-nowhere").size).toBe(0);
  });

  for (const map of Object.values(PLAYABLE_MAPS)) {
    it(`${map.id}: every NPC, exit, object and monster spawn stays reachable from spawn`, () => {
      const blocked = propBlockedTiles(map.id);
      const walkable = (x: number, y: number): boolean =>
        !(TILES.find((t) => t.code === map.rows[y]?.[x])?.collides ?? true) && !blocked.has(`${x},${y}`);
      const seen = new Set([`${map.spawn.x},${map.spawn.y}`]);
      const queue: [number, number][] = [[map.spawn.x, map.spawn.y]];
      while (queue.length > 0) {
        const [x, y] = queue.pop() as [number, number];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const key = `${x + dx},${y + dy}`;
          if (!seen.has(key) && walkable(x + dx, y + dy)) {
            seen.add(key);
            queue.push([x + dx, y + dy]);
          }
        }
      }
      const reachable = (x: number, y: number): boolean =>
        [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(`${x + (dx ?? 0)},${y + (dy ?? 0)}`));
      const unreachable = [
        ...npcsJson.npcs.filter((n) => n.homeZone === map.id).filter((n) => !reachable(n.homeTile.x, n.homeTile.y)).map((n) => n.id),
        ...map.transitions.filter((t) => !reachable(t.x, t.y)).map((t) => t.id),
        ...map.interactables.filter((o) => !reachable(o.x, o.y)).map((o) => o.id),
        ...(map.monsterSpawns ?? []).filter((s) => !reachable(s.x, s.y)).map((s) => s.id),
      ];
      expect(unreachable).toEqual([]);
    });
  }
});
