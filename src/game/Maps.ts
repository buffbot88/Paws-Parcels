import { ZoneKeys } from "./GameConstants.ts";
import postOffice from "../data/maps/post-office.json" with { type: "json" };
import bramblePatch from "../data/maps/bramble-patch.json" with { type: "json" };

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
}

/** Expected dimensions from design/world-map.md (enforced by the map validator). */
export const MAP_DIMENSIONS: Readonly<Record<string, { width: number; height: number }>> = {
  [ZoneKeys.PostOffice]: { width: 30, height: 20 },
  [ZoneKeys.Bramble]: { width: 40, height: 26 },
};

export const MAPS: Readonly<Record<string, MapData>> = {
  [ZoneKeys.PostOffice]: postOffice as MapData,
  [ZoneKeys.Bramble]: bramblePatch as MapData,
};
