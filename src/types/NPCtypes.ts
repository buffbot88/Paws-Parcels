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
}
