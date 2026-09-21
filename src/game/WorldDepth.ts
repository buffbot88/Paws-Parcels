import { TILE_SIZE } from "./tileGrid.ts";

/**
 * Named depth offsets and bands (visual Pass 5 — depth and foreground).
 *
 * `worldDepth` used to be called with bare literals scattered across the
 * entities, the scene and both set-piece renderers (`-0.04`, `-0.08`, `+0.08`,
 * `+0.04`), so nothing said what a depth *meant* and no reader could tell an
 * under-piece shadow from an over-piece label. These names replace the literals:
 * each one is a relationship (this draws under that piece, this draws over it)
 * rather than a number to be copied.
 */
export const DEPTH_OFFSET = {
  /** A contact shadow, drawn just under the piece that casts it. */
  contactShadow: -0.06,
  /** The piece itself, at its own world Y. */
  piece: 0,
  /**
   * A small overlay belonging to a piece — a name tag, an interaction prompt —
   * which must stay legible on top of the art it annotates.
   */
  overlay: 0.04,
} as const;

/**
 * Base depth of the foreground layer.
 *
 * Entities and set pieces sit at `1 + y / TILE_SIZE`, so on the tallest map (75
 * tiles) nothing exceeds ~76. A foreground piece is placed at 400+, which is
 * above every entity on every map *and* still internally Y-sorted, so two
 * foreground pieces keep their relative order. Nothing in the game can reach
 * this band by accident, and the HUD is DOM, so it is unaffected either way.
 */
export const FOREGROUND_DEPTH_BASE = 400;

/** Convert world Y into a stable depth band while leaving UI depths above it. */
export function worldDepth(y: number, offset = 0): number {
  return 1 + y / TILE_SIZE + offset;
}

/**
 * Depth for a piece that must draw over the courier rather than sort against
 * them: the entrance arch the courier walks under, and the canopy trees that
 * frame the plaza. Still Y-sorted among themselves.
 */
export function foregroundDepth(y: number): number {
  return FOREGROUND_DEPTH_BASE + y / TILE_SIZE;
}

/** True when a depth came from `foregroundDepth` rather than `worldDepth`. */
export function isForegroundDepth(depth: number): boolean {
  return depth >= FOREGROUND_DEPTH_BASE;
}
