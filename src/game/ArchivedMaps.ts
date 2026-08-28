import { ZoneKeys } from "./GameConstants.ts";
import cloverVillage from "../data/maps/clover-village.json" with { type: "json" };
import happyValley from "../data/maps/happy-valley.json" with { type: "json" };
import type { MapData } from "./Maps.ts";

/** Archived maps retained for validation and future replacement work only. */
export const ARCHIVED_MAPS: Readonly<Record<string, MapData>> = {
  [ZoneKeys.CloverVillage]: cloverVillage as MapData,
  [ZoneKeys.HappyValley]: happyValley as MapData,
};

export const ARCHIVED_MAP_DIMENSIONS: Readonly<Record<string, { width: number; height: number }>> = {
  [ZoneKeys.CloverVillage]: { width: 75, height: 75 },
  [ZoneKeys.HappyValley]: { width: 40, height: 26 },
};
