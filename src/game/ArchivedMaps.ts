import { ZoneKeys } from "./GameConstants.ts";
import { MAP_DIMENSIONS, MAPS } from "./Maps.ts";

/**
 * Alias of the live map registry, kept under the archived name while the
 * validator, content checks, and tests still import from here. Maps are
 * playable again with the NEW Clover Village layout.
 */
export const ARCHIVED_MAPS: Readonly<Record<string, MapData>> = MAPS;

export const ARCHIVED_MAP_DIMENSIONS: Readonly<Record<string, { width: number; height: number }>> =
  MAP_DIMENSIONS;

import type { MapData } from "./Maps.ts";
