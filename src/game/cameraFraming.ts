/**
 * World-camera framing rules (visual Pass 1 follow-up).
 *
 * Pass 1 settled the camera's *scale* — one zoom for every zone, so the courier
 * keeps a constant apparent size and the village reads at reference scale. What
 * it did not settle is the courier's *position in the frame*: the camera was
 * handed straight to `startFollow`, which centres the target exactly. A dead
 * centre reads as a viewer behind glass looking at a flat tile field — the
 * complaint the whole visual overhaul answers — because everything north of the
 * courier is squeezed into half the viewport while the ground already walked
 * gets the other half.
 *
 * Two rules, both about where the focus point sits rather than how big the world
 * is:
 *
 *   1. **Vertical bias** — the focus sits above the courier, so the courier
 *      renders *below* centre and the frame gives the world ahead more room than
 *      the world behind. This is the cheap half of a 2.5D camera: it does not
 *      tilt the projection (that would need new art and a different collision
 *      space), but it does put buildings, paths and landmarks in the upper part
 *      of the frame where a 3/4 camera puts them, so the world reads as depth
 *      ahead of the player instead of a symmetric field around them.
 *   2. **Movement look-ahead** — while the courier walks, the focus leads the
 *      direction of travel by a fraction of a tile, eased, so the road you are
 *      walking into reveals itself before you reach it and the frame settles
 *      when you stop. Clamped hard, because a camera that runs ahead of input is
 *      a camera that feels like it is fighting the player.
 *
 * Pure and Phaser-free: the scene supplies the viewport height, the zoom, the
 * input vector and the frame delta, and applies the offset the module returns
 * through `camera.setFollowOffset`. That keeps the arithmetic testable without a
 * browser (see `tests/data/camera-framing.test.ts`), which matters because this
 * is the one part of the frame no other test can see.
 *
 * Whether the result *feels* right — how far below centre the courier should sit,
 * and whether the look-ahead reads as anticipation or as lag — is
 * `REQUIRES SEELLE/BROWSER VERIFICATION`. The defaults below are deliberately
 * small: at 960×540 they are ~49 screen px of bias (9% of the viewport) and at
 * most ~0.6 tiles of lead.
 */

/** A camera framing rule set. */
export interface CameraFraming {
  /**
   * How far below the viewport centre the courier renders, as a fraction of the
   * viewport height. 0 restores the old dead-centre framing.
   */
  readonly verticalBias: number;
  /** Peak look-ahead distance at full speed, in tiles. */
  readonly lookAheadTiles: number;
  /** Look-ahead ease rate in 1/seconds — how fast the lead settles. */
  readonly lookAheadEasePerSecond: number;
}

/**
 * The shipped framing.
 *
 * The bias is the subtlest value in the game that changes how the world reads,
 * so it is stated once, here, and every zone shares it: a courier who switches
 * zones must not have the world shift under them.
 */
export const CAMERA_FRAMING: CameraFraming = {
  verticalBias: 0.09,
  lookAheadTiles: 0.6,
  lookAheadEasePerSecond: 4.5,
};

/** A world-pixel offset pair. */
export interface OffsetPx {
  readonly x: number;
  readonly y: number;
}

/** The camera's follow offset plus the lead it currently holds, in world px. */
export interface FramedFollowOffset extends OffsetPx {
  /** The eased look-ahead that produced the offset, so the scene can keep it. */
  readonly lookAhead: OffsetPx;
}

/**
 * World pixels the focus point sits above the courier for a viewport.
 *
 * Expressed in world units because that is what `camera.setFollowOffset` takes:
 * the offset is subtracted from the target's world position, so a zoomed-in
 * camera needs a smaller world offset for the same on-screen shift. The
 * *rendered* shift is `verticalBias * viewportHeightPx` at any zoom, which is the
 * point — the courier sits at the same place in the frame no matter the scale.
 */
export function biasOffsetPx(
  framing: CameraFraming,
  viewportHeightPx: number,
  zoom: number,
): number {
  if (!(zoom > 0)) return 0;
  return (framing.verticalBias * viewportHeightPx) / zoom;
}

/**
 * The look-ahead the current input asks for, in world pixels.
 *
 * A normalised input vector (the same `{x, y}` the movement system uses) scaled
 * to at most `lookAheadTiles`, so a diagonal step does not lead further than a
 * straight one.
 */
export function lookAheadTargetPx(
  framing: CameraFraming,
  direction: OffsetPx,
  tilePx: number,
): OffsetPx {
  const length = Math.hypot(direction.x, direction.y);
  if (length === 0) return { x: 0, y: 0 };
  const scale = (framing.lookAheadTiles * tilePx) / length;
  return { x: direction.x * scale, y: direction.y * scale };
}

/**
 * Ease a value toward a target, frame-rate independently.
 *
 * The exponential form (rather than `current + (target - current) * rate`) is
 * what keeps the camera identical at 30 and 144 fps: a plain lerp per frame
 * settles twice as fast on a 144 Hz display as on a 60 Hz one, which is a real
 * difference in how the camera feels between machines.
 */
export function easeToward(current: number, target: number, ratePerSecond: number, dtSeconds: number): number {
  if (!(ratePerSecond > 0) || !(dtSeconds > 0)) return current;
  const t = 1 - Math.exp(-ratePerSecond * dtSeconds);
  return current + (target - current) * t;
}

/**
 * The follow offset the camera should hold this frame.
 *
 * `lookAhead` is the eased lead the caller is carrying; this eases it one step
 * further toward `direction` and returns both the offset for
 * `camera.setFollowOffset` and the new lead to keep.
 *
 * The offset is the *inverse* of where the focus belongs, because Phaser
 * subtracts it (`focus = target - followOffset`): to look above the courier the
 * offset is positive, and to lead the direction of travel it is negative on that
 * axis.
 */
export function framedFollowOffset(
  framing: CameraFraming,
  viewport: { heightPx: number; zoom: number },
  direction: OffsetPx,
  lookAhead: OffsetPx,
  tilePx: number,
  dtSeconds: number,
): FramedFollowOffset {
  const target = lookAheadTargetPx(framing, direction, tilePx);
  const eased: OffsetPx = {
    x: easeToward(lookAhead.x, target.x, framing.lookAheadEasePerSecond, dtSeconds),
    y: easeToward(lookAhead.y, target.y, framing.lookAheadEasePerSecond, dtSeconds),
  };
  // `-0` is a real value in JS and would make every offset comparison a
  // sign-of-zero puzzle for callers and tests; callers want "no offset".
  const negate = (value: number): number => (value === 0 ? 0 : -value);
  return {
    x: negate(eased.x),
    y: biasOffsetPx(framing, viewport.heightPx, viewport.zoom) - eased.y,
    lookAhead: eased,
  };
}

/**
 * The framing under the player's motion preference.
 *
 * `prefers-reduced-motion` keeps the composition (the courier still sits below
 * centre — that is framing, not motion) and drops the lead, because a camera
 * that drifts when you walk is exactly the kind of involuntary movement the
 * preference is asking about.
 */
export function framingForMotionPreference(
  framing: CameraFraming,
  reducedMotion: boolean,
): CameraFraming {
  return reducedMotion ? { ...framing, lookAheadTiles: 0 } : framing;
}
