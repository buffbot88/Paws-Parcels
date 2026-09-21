/**
 * One lighting convention for the whole world (visual Pass 6).
 *
 * Both set-piece renderers used to bake their own shadow numbers — a fixed 0.2
 * alpha, a fixed `y - 4` offset, and a width that was `frameWidth * scale * 0.7`
 * clamped to 320. Two consequences showed up in review: a small prop's shadow
 * barely moved or thinned as it scaled (so a 24px bench and a 500px building cast
 * the same *shape* of shadow), and the plus/minus sign disagreed with the
 * courier's own shadow, which sits 12px *below* the sprite. Nothing in the
 * village agreed about where the light was.
 *
 * Now there is one recipe, derived from the Pass 3 footprint helper, so every
 * shadow in the game is a function of how much ground the piece touches:
 *
 *   - light comes from the north-west (upper-left), matching the reference
 *     illustration's key light and the courier's down-right shadow;
 *   - the cast shadow therefore falls to the south-east: offset right and down;
 *   - its depth scales with the footprint, so a trunk casts a trunk-sized
 *     shadow and a facade casts a facade-sized one;
 *   - a bigger mass casts a *softer* shadow (lower alpha), which is what keeps a
 *     large building from reading as a hard black disc.
 *
 * Pure and Phaser-free: the renderers turn the recipe into an ellipse, and
 * `tests/data/lighting.test.ts` checks the shape of the curve.
 */

/** Direction of the sun, in screen space. North-west is up and to the left. */
export const LIGHT_DIRECTION = { x: -1, y: -1 } as const;

/** Shadow colour: the same deep green the renderers already used. */
export const SHADOW_COLOR = 0x263b2a;

/** Smallest shadow worth drawing: below this it reads as a speck of dirt. */
const MIN_WIDTH_PX = 10;
/** Largest: a landmark's shadow should not become a screen-wide band. */
const MAX_WIDTH_PX = 420;
/** Shadow thickness as a fraction of its width. */
const THICKNESS_RATIO = 0.24;
/** Horizontal fall-away as a fraction of shadow width. */
const FALLOFF_X_RATIO = 0.12;
/** Vertical fall-away as a fraction of shadow thickness. */
const FALLOFF_Y_RATIO = 0.4;
/** Alpha at the smallest scale, and how much a large mass softens from there. */
const ALPHA_MAX = 0.26;
const ALPHA_MIN = 0.15;
const ALPHA_FALLOFF_PER_PX = 0.00026;

export interface ShadowRecipe {
  /** Ellipse width in px. */
  readonly widthPx: number;
  /** Ellipse height in px. */
  readonly heightPx: number;
  /** Offset from the piece's base point, along the light's fall-away. */
  readonly offsetXPx: number;
  readonly offsetYPx: number;
  readonly alpha: number;
  readonly color: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The cast shadow for a piece whose ground contact is `footprintWidthPx` wide.
 *
 * `offsetYPx` is positive *downward*: the returned offsets are added to the
 * piece's base point, so the shadow centre sits below the art's bottom edge and
 * peeks out from under it, exactly like the courier's own shadow.
 */
export function shadowRecipe(footprintWidthPx: number): ShadowRecipe {
  const widthPx = clamp(footprintWidthPx * 0.9, MIN_WIDTH_PX, MAX_WIDTH_PX);
  const heightPx = clamp(widthPx * THICKNESS_RATIO, 4, MAX_WIDTH_PX * THICKNESS_RATIO);
  const alpha = clamp(
    ALPHA_MAX - widthPx * ALPHA_FALLOFF_PER_PX,
    ALPHA_MIN,
    ALPHA_MAX,
  );
  return {
    widthPx,
    heightPx,
    // The fall-away follows the light: away from the north-west means right/down.
    offsetXPx: Math.abs(LIGHT_DIRECTION.x) * widthPx * FALLOFF_X_RATIO,
    offsetYPx: Math.abs(LIGHT_DIRECTION.y) * heightPx * FALLOFF_Y_RATIO,
    alpha: Number(alpha.toFixed(3)),
    color: SHADOW_COLOR,
  };
}
