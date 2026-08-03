/**
 * Tile catalog for the custom-JSON maps (design/decisions.md: custom JSON
 * over Tiled). Each tile has a one-character code used inside map `rows`
 * and a frame index in the generated `tileset-main` sheet.
 */
export interface TileDefinition {
  code: string;
  index: number;
  name: string;
  collides: boolean;
  /** Fill color for the placeholder texture (base + top/bottom edge bars). */
  base: number;
  edge: number;
}

export const TILES: readonly TileDefinition[] = [
  { code: "G", index: 0, name: "grass", collides: false, base: 0x8fc98a, edge: 0x77b573 },
  { code: "P", index: 1, name: "path", collides: false, base: 0xd9b07c, edge: 0xc29660 },
  { code: "F", index: 2, name: "floor", collides: false, base: 0xd8b28a, edge: 0xc19a6e },
  { code: "W", index: 3, name: "wall", collides: true, base: 0x8d7a68, edge: 0x6f5f50 },
  { code: "~", index: 4, name: "water", collides: true, base: 0x6fb7d9, edge: 0x4f97c4 },
  { code: "T", index: 5, name: "tree", collides: true, base: 0x4c8f4f, edge: 0x356f3a },
  { code: "B", index: 6, name: "bush", collides: false, base: 0x5aa85e, edge: 0x3d8a42 },
  { code: "X", index: 7, name: "flower", collides: false, base: 0xe28bc4, edge: 0xc96aab },
];

/** Code → frame-index lookup for converting map rows into tile grids. */
export const TILE_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  TILES.map((t) => [t.code, t.index]),
);

/** Tile indices that block movement (used by layer.setCollision). */
export const COLLIDING_TILE_INDICES: readonly number[] = TILES.filter(
  (t) => t.collides,
).map((t) => t.index);

/** Columns in the generated tileset-main sheet (frame layout). */
export const TILESET_COLUMNS = 4;
