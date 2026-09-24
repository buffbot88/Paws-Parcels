import type { AvatarLook } from "../game/appearance.ts";
export type ZoneId = "zone-clover-village";

export interface TilePosition {
  x: number;
  y: number;
}

export interface NPC {
  id: string;
  name: string;
  species: string;
  personality: string;
  role: string;
  homeZone: ZoneId;
  homeTile: TilePosition;
  /** Which courier body the villager is drawn from, and its colours (src/game/appearance.ts). */
  look?: AvatarLook;
}
