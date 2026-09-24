/**
 * Name tags and health bars, placed in the 3D frame.
 *
 * The sprite renderer already draws both — every villager, monster and remote
 * courier carries a `nameTag`, and a monster carries an `hpBar` — and the 3D
 * renderer hides the sprite camera, so without this the world is inhabited by
 * anonymous figures with no idea how a fight is going. The *art* is not
 * re-authored here: the 3D layer uploads the entity's own text canvas (see
 * `entityView.ts`), so the typography stays authored in one place and a change
 * to a tag appears in both renderers.
 *
 * Only the placement is this module's business, which is why it is pure: a tag
 * sits above the figure's own head (from the shared sizing rule, not a guessed
 * offset), further from the ground than the body is tall, and a hair in front of
 * the body's plane so the two are never coplanar.
 */

/** How far in front of the body plane a tag sits, in tiles. */
export const TAG_LIFT_TILES = 0.004;

/** 3D tags draw smaller than their canvas: the 3/4 camera magnifies width, so full-size plates bury the figures. */
export const TAG_SCALE_3D = 0.6;

/** The monster health bar, in the sprite renderer's own pixels. */
export const MONSTER_HP_BAR = {
  /** Track width, matching `Monster`'s 36px rectangle. */
  widthPx: 36,
  /** Bar height, matching its 5px rectangle. */
  heightPx: 5,
  /** Gap between the name tag's baseline and the bar, in tiles. */
  gapTiles: 0.05,
} as const;

export interface Rect3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
}

/** An entity's geometry, as both placements need it. */
export interface TagAnchor {
  /** Tile centre the entity stands on. */
  readonly x: number;
  readonly z: number;
  /**
   * How high the tag's bottom edge floats above the ground the figure stands on,
   * in tiles — positive, measured up from the feet, so the plate never covers the head.
   */
  readonly tagAboveFeetTiles: number;
  readonly tilePx: number;
}

/**
 * The name tag's quad: sized from the tag's own canvas (scaled by TAG_SCALE_3D),
 * so the text keeps its proportions, resting on the anchor height.
 */
export function labelRect(anchor: TagAnchor, tagWidthPx: number, tagHeightPx: number): Rect3D {
  const height = (tagHeightPx * TAG_SCALE_3D) / anchor.tilePx;
  return {
    x: anchor.x,
    y: anchor.tagAboveFeetTiles + height / 2,
    z: anchor.z + TAG_LIFT_TILES,
    width: (tagWidthPx * TAG_SCALE_3D) / anchor.tilePx,
    height,
  };
}

/**
 * The health bar's two quads: the full track and the filled portion of it.
 *
 * `ratio` is the server's HP share, already the only HP the client mirrors. A
 * defeated or empty bar still draws its track, so the player can see that the
 * creature is there and hurt rather than guessing at a missing bar.
 */
export function hpBarRects(
  anchor: TagAnchor,
  ratio: number,
  gapTiles = MONSTER_HP_BAR.gapTiles,
): { track: Rect3D; fill: Rect3D } {
  const clamped = Math.max(0, Math.min(1, ratio));
  const width = MONSTER_HP_BAR.widthPx / anchor.tilePx;
  const height = MONSTER_HP_BAR.heightPx / anchor.tilePx;
  const y = anchor.tagAboveFeetTiles - gapTiles;
  const z = anchor.z + TAG_LIFT_TILES;
  const fillWidth = width * clamped;
  return {
    track: { x: anchor.x, y, z, width, height },
    // Centred on the track, not shrink-from-the-left: the sprite renderer's bar
    // is a centre-origin rectangle whose width follows HP, so it empties evenly
    // on both sides and the 3D bar has to read the same way.
    fill: {
      x: anchor.x,
      y,
      z: z + TAG_LIFT_TILES,
      width: fillWidth,
      height,
    },
  };
}
