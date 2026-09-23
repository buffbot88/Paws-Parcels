/**
 * 3D parity with the authored placement fields.
 *
 * The world is authored once and drawn by two renderers, so any field the sprite
 * renderer honours and the 3D one ignores is a staging defect the player sees —
 * a shop sign sunk into its host wall, a fence run floating half its height off
 * the ground. These tests pin the two rules that translate those fields into
 * geometry, and then audit the real zone tables, because a rule nothing uses is
 * a rule that cannot break.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_DEPTH_LIFT_TILES,
  billboardRoll,
  depthLiftTiles,
  rollPivotOffset,
} from "../../src/render3d/parity3d.ts";
import { getCloverVillageSetPieceDefinitions } from "../../src/game/cloverVillagePlacements.ts";
import { getHappyValleySetPieceDefinitions } from "../../src/game/happyValleyPlacements.ts";
import { CLOVER_VILLAGE_PROP_SIZING, renderedTiles } from "../../src/game/propSizing.ts";

const CLOVER = getCloverVillageSetPieceDefinitions();
const VALLEY = getHappyValleySetPieceDefinitions();

describe("3D parity — the 2D draw-order nudge becomes real separation", () => {
  it("lifts a piece by its authored depth offset, toward the camera", () => {
    expect(depthLiftTiles({ depthOffset: 0.02 })).toBeCloseTo(0.02, 6);
    expect(depthLiftTiles({ depthOffset: 0.005 })).toBeCloseTo(0.005, 6);
  });

  it("leaves an ordinary piece exactly on its authored tile", () => {
    expect(depthLiftTiles({})).toBe(0);
    expect(depthLiftTiles({ depthOffset: 0 })).toBe(0);
    // `-0` would read as "behind the ground" to a comparison and sorts wrong.
    expect(Object.is(depthLiftTiles({ depthOffset: 0 }), -0)).toBe(false);
  });

  it("never lets a nudge become a re-staging", () => {
    expect(depthLiftTiles({ depthOffset: 4 })).toBe(MAX_DEPTH_LIFT_TILES);
    expect(depthLiftTiles({ depthOffset: -1 })).toBe(0);
  });

  it("is what the zone data actually needs: overlays are authored against hosts", () => {
    const lifted = CLOVER.filter((piece) => (piece.depthOffset ?? 0) > 0);
    // A regression here is not cosmetic: these are the signs, the parcels on the
    // Post Office step, the café tables and the clotheslines.
    expect(lifted.length).toBeGreaterThan(20);
    for (const piece of lifted) expect(depthLiftTiles(piece)).toBeGreaterThan(0);
  });

  it("orders every shared-tile stack, so nothing fights for the same plane", () => {
    // A lifted piece shares its host's base row by design; the lift — never the
    // row — is what puts it in front. Two pieces on one tile are fine as long as
    // their lifts differ (a fence run meeting the corner that closes it); an
    // identical pair would sit in one plane with nothing to choose between them.
    const liftsByTile = new Map<string, number[]>();
    for (const piece of CLOVER) {
      const lift = depthLiftTiles(piece);
      if (lift === 0) continue;
      const key = `${piece.tileX}@${piece.baseTileY}`;
      liftsByTile.set(key, [...(liftsByTile.get(key) ?? []), lift]);
    }
    for (const [key, lifts] of liftsByTile) {
      expect(new Set(lifts).size, `${key} has two pieces in one plane`).toBe(lifts.length);
    }
  });
});

describe("3D parity — a rolled piece pivots on the ground it stands on", () => {
  it("needs no correction when there is no rotation", () => {
    expect(rollPivotOffset(undefined, 2)).toEqual({ x: 0, y: 0 });
    expect(rollPivotOffset(0, 2)).toEqual({ x: 0, y: 0 });
  });

  it("mirrors the authored rotation into three's plane", () => {
    // Phaser rotates clockwise on a Y-down screen; three rotates anticlockwise
    // on a Y-up plane. Passing the value through unchanged lays a rolled fence
    // on the wrong side of its own base.
    expect(billboardRoll(Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 6);
    expect(billboardRoll(undefined)).toBe(0);
    expect(billboardRoll(0)).toBe(0);
  });

  it("moves the base line back under the rolled art", () => {
    const height = 2;
    const rotation = Math.PI / 2;
    const half = height / 2;
    const offset = rollPivotOffset(rotation, height);
    // The base sat at (0, -height/2) before the roll; rolling it about the quad's
    // centre carries that point away, and the offset must put the art back on the
    // ground it was authored against.
    const roll = billboardRoll(rotation);
    expect(offset.x).toBeCloseTo(-(half * Math.sin(roll)), 6);
    expect(offset.y).toBeCloseTo(-(half * (1 - Math.cos(roll))), 6);
    // A quarter turn of a 2-tile fence: the art lands one tile east of its base
    // and drops one tile to stand on it — the whole difference between standing
    // and floating.
    expect(offset.x).toBeCloseTo(1, 6);
    expect(offset.y).toBeCloseTo(-1, 6);
  });

  it("is what the zone data actually needs: the village rolls fence runs", () => {
    const rotated = CLOVER.filter(
      (piece) => piece.rotation !== undefined && piece.rotation !== 0,
    );
    expect(rotated.length).toBeGreaterThan(0);
    const spec = CLOVER_VILLAGE_PROP_SIZING[rotated[0]!.texture];
    expect(spec, "a rolled piece must have a sizing row to measure it").toBeDefined();
    for (const piece of rotated) {
      const row = spec!;
      const height = renderedTiles(row.h, piece.scale);
      const offset = rollPivotOffset(piece.rotation, height);
      // Every rolled piece is a fence run laid across the ground, so its
      // correction is a real, visible distance — not a rounding detail.
      expect(Math.hypot(offset.x, offset.y)).toBeGreaterThan(0.2);
    }
  });
});
