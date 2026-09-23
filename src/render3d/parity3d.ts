/**
 * The authored placement fields the 2D renderer honoured, expressed in 3D.
 *
 * A zone is authored once, in `cloverVillagePlacements.ts`, and both renderers
 * read the same rows. Two of those fields only mean something in a renderer with
 * a draw-order list, and dropping them in the 3D world is not a style choice —
 * it is a staging defect the player can see:
 *
 *   - `depthOffset` — a nudge *up the 2D draw order*, authored for pieces that
 *     belong to a bigger one (a hanging shop sign, the parcels on the Post
 *     Office step, a café table under its awning). In 3D there is no draw order:
 *     such a piece lands in exactly the plane of its host, where the depth test
 *     has nothing to choose between them and the host wins or the sign shimmers.
 *     The nudge becomes what it always meant — the piece stands that much nearer
 *     the camera.
 *   - `rotation` — 2D rotates a sprite about its origin, which every placement
 *     uses as `(0.5, 1)`: the piece pivots on the ground it stands on. A 3D quad
 *     pivots about its own centre unless corrected, so a rotated fence run sinks
 *     into the ground or floats above it by half its height.
 *
 * Pure (no three, no Phaser), because these are the parity rules the zone data
 * has to keep and `tests/data/render3d-parity.test.ts` audits the authored rows
 * against them without a browser.
 */

/** A placement as the parity rules see it. */
export interface ParityPlacement {
  readonly depthOffset?: number;
  readonly rotation?: number;
  readonly scale?: number;
}

/**
 * The largest lift a `depthOffset` may buy, in tiles.
 *
 * A draw-order nudge is a hair's width by design (the authored values run
 * 0.005–0.02); anything larger would be restaging the zone while pretending to
 * be a sort order.
 */
export const MAX_DEPTH_LIFT_TILES = 0.05;

/**
 * How far toward the camera a placement stands, in tiles (+Z, south).
 *
 * Zero for the ordinary piece, and never negative or `-0`: a piece can be lifted
 * in front of one it belongs to, never pushed behind the ground it stands on.
 */
export function depthLiftTiles(piece: ParityPlacement): number {
  const lift = piece.depthOffset ?? 0;
  if (!(lift > 0)) return 0;
  return Math.min(lift, MAX_DEPTH_LIFT_TILES);
}

/**
 * The quad's roll, in three's plane, for an authored 2D sprite rotation.
 *
 * Phaser rotates a sprite clockwise on screen (its Y axis points down); three
 * rotates a quad anticlockwise in its own plane (Y up). The authored value is
 * the Phaser one, so it has to be mirrored — otherwise a fence run laid across
 * the ground leans to the wrong side of its own base, which is exactly the
 * mirrored-art defect the mirrored-UW trick in `geometry3d.ts` exists to avoid.
 */
export function billboardRoll(rotation: number | undefined): number {
  const authored = rotation ?? 0;
  // `-0` is a real value in JS and would make every "no rotation" comparison a
  // sign-of-zero puzzle for callers; an unrotated quad asks for no roll.
  return authored === 0 ? 0 : -authored;
}

/**
 * The in-plane offset a rolled quad needs so its base line stays put.
 *
 * The quad is built centred on the origin with its base at `y = -height/2`, and
 * `geometry3d.ts` rolls it about the origin. Rotating about the base instead
 * means moving the result by `b - R(θ)·b`, where `b` is the base vector: the
 * correction is independent of which corner is being placed, so it is one offset
 * for the whole quad. `rotation` is the authored 2D value — the same input
 * `billboardRoll` mirrors — so the two cannot be applied out of step.
 *
 * Valid while the quad is a billboard: flat ground quads have no base to pivot
 * on and are never rolled by the zone builder.
 */
export function rollPivotOffset(
  rotation: number | undefined,
  height: number,
): { x: number; y: number } {
  if (rotation === undefined || rotation === 0) return { x: 0, y: 0 };
  const half = height / 2;
  const roll = billboardRoll(rotation);
  return {
    x: -(half * Math.sin(roll)),
    y: -(half * (1 - Math.cos(roll))),
  };
}
