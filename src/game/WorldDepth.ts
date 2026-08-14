import { TILE_SIZE } from "./GameConfig.ts";

/** Convert world Y into a stable depth band while leaving UI depths above it. */
export function worldDepth(y: number, offset = 0): number {
  return 1 + y / TILE_SIZE + offset;
}
