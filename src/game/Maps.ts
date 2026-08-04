import { ZoneKeys } from "./GameConstants.ts";
import cloverVillage from "../data/maps/clover-village.json" with { type: "json" };
import happyValley from "../data/maps/happy-valley.json" with { type: "json" };

/** A tile-coordinate point on a map. */
export interface MapPoint {
  x: number;
  y: number;
}

/** A walkable tile that changes zones when the player steps on it. */
export interface ZoneTransition {
  id: string;
  label: string;
  x: number;
  y: number;
  toZone: string;
  /** Where the player appears on the destination zone. */
  spawn: MapPoint;
}

/**
 * The kind of a map object the player can interact with (Phase 3). NPCs are
 * separate — they live in npcs.json keyed by homeZone/homeTile.
 */
export type InteractableKind =
  | "counter"
  | "quest-board"
  | "mailbox"
  | "shop"
  | "sign";

/** A static, interactable map object (design/world-map.md `object-*` entries). */
export interface MapInteractable {
  id: string;
  kind: InteractableKind;
  label: string;
  x: number;
  y: number;
  /** Flavor lines shown in the dialogue panel until a real system lands (Phases 5-7). */
  lines: string[];
}

/** A monster spawn point on a map (design/monsters.md §1). */
export interface MonsterSpawn {
  id: string;
  /** Monster definition key (e.g. monster-wild-boar). */
  key: string;
  x: number;
  y: number;
}

/** Custom-JSON map format (design/decisions.md): ASCII `rows` + spawn/transitions. */
export interface MapData {
  id: string;
  name: string;
  width: number;
  height: number;
  rows: string[];
  spawn: MapPoint;
  transitions: ZoneTransition[];
  interactables: MapInteractable[];
  /** Outdoor zones only — monster spawn points (design/monsters.md). */
  monsterSpawns?: MonsterSpawn[];
}

/** Expected dimensions from design/world-map.md (enforced by the map validator). */
export const MAP_DIMENSIONS: Readonly<Record<string, { width: number; height: number }>> = {
  [ZoneKeys.CloverVillage]: { width: 30, height: 20 },
  [ZoneKeys.HappyValley]: { width: 40, height: 26 },
};

export const MAPS: Readonly<Record<string, MapData>> = {
  [ZoneKeys.CloverVillage]: cloverVillage as MapData,
  [ZoneKeys.HappyValley]: happyValley as MapData,
};
