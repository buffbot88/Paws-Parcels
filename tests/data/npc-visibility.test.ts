import { describe, expect, it } from "vitest";
import { getCloverVillageSetPieceDefinitions } from "../../src/game/cloverVillagePlacements.ts";
import { getHappyValleySetPieceDefinitions } from "../../src/game/happyValleyPlacements.ts";
import { CLOVER_VILLAGE_PROP_SIZING, HAPPY_VALLEY_PROP_SIZING, PROP_TILE_PX } from "../../src/game/propSizing.ts";
import { VILLAGER_SIZING } from "../../src/game/entitySizing.ts";
import npcsJson from "../../src/data/npcs.json" with { type: "json" };

/** A villager's figure, in tiles: 1 tile wide, standing on its tile's lower edge. */
const FIGURE_HEIGHT = VILLAGER_SIZING.cat.tiles;
/** More than this share of the figure behind a prop drawn over it is "hidden". */
const MAX_COVERED = 0.1;

const ZONES = {
  "zone-clover-village": { pieces: getCloverVillageSetPieceDefinitions(), sizing: CLOVER_VILLAGE_PROP_SIZING },
  "zone-happy-valley": { pieces: getHappyValleySetPieceDefinitions(), sizing: HAPPY_VALLEY_PROP_SIZING },
} as const;

describe("npc visibility", () => {
  for (const npc of npcsJson.npcs) {
    it(`${npc.name} is not hidden behind a prop`, () => {
      const zone = ZONES[npc.homeZone as keyof typeof ZONES];
      const feet = npc.homeTile.y + 0.85;
      const cx = npc.homeTile.x + 0.5;
      const covering: string[] = [];
      for (const piece of zone.pieces) {
        const spec = zone.sizing[piece.texture];
        if (spec === undefined || (piece as { frame?: string }).frame !== undefined) continue;
        const depthOffset = (piece as { depthOffset?: number }).depthOffset ?? 0;
        const foreground = (piece as { foreground?: boolean }).foreground === true;
        if (!foreground && piece.baseTileY + depthOffset <= feet) continue;
        const w = (spec.w * piece.scale) / PROP_TILE_PX;
        const h = (spec.h * piece.scale) / PROP_TILE_PX;
        const ox = Math.min(cx + 0.5, piece.tileX + w / 2) - Math.max(cx - 0.5, piece.tileX - w / 2);
        const oy = Math.min(feet, piece.baseTileY) - Math.max(feet - FIGURE_HEIGHT, piece.baseTileY - h);
        if (ox > 0 && oy > 0 && (ox * oy) / FIGURE_HEIGHT > MAX_COVERED) covering.push(`${piece.texture}@${piece.tileX},${piece.baseTileY}`);
      }
      expect(covering).toEqual([]);
    });
  }
});
