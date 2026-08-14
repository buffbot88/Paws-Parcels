/** Shared scene metadata captured from the live Phaser presentation layer. */
export interface VisualSceneMetadata {
  zoneId: string;
  zoneName?: string;
  map: { width: number; height: number };
  camera: { zoom: number; viewportWidth?: number; viewportHeight?: number };
  visibleTiles?: { x: number; y: number };
  entities?: Array<{
    id: string;
    kind: "player" | "npc" | "monster" | "set-piece" | "interactable";
    x: number;
    y: number;
    scale?: number;
    depth?: number;
    asset?: string;
  }>;
  notes?: string[];
}
