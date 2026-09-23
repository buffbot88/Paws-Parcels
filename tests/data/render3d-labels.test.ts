/**
 * Name tags and health bars in the 3D frame.
 *
 * Both exist in the sprite renderer and neither survives the renderer change by
 * default — the 3D world hides the sprite camera, so a villager's tag has to be
 * placed in world space. What matters is that the placement is derived (from the
 * shared sizing rule) rather than guessed, stays legible above the figure, and
 * never lands in the same plane as the body.
 */
import { describe, expect, it } from "vitest";
import {
  MONSTER_HP_BAR,
  TAG_LIFT_TILES,
  hpBarRects,
  labelRect,
  type TagAnchor,
} from "../../src/render3d/labels3d.ts";

const TILE = 48;
const anchor: TagAnchor = { x: 20, z: 30, tagAboveFeetTiles: 2.25, tilePx: TILE };

describe("3D name tags", () => {
  it("floats above the figure, in front of its plane", () => {
    const rect = labelRect(anchor, 96, 24);
    expect(rect.y).toBeCloseTo(anchor.tagAboveFeetTiles, 6);
    expect(rect.y).toBeGreaterThan(0);
    expect(rect.z).toBeCloseTo(anchor.z + TAG_LIFT_TILES, 6);
    // A hair in front: enough that body and tag are never coplanar, small enough
    // that the tag still reads as belonging to the figure it names.
    expect(rect.z).toBeGreaterThan(anchor.z);
    expect(rect.z - anchor.z).toBeLessThan(0.05);
    expect(rect.x).toBeCloseTo(anchor.x, 6);
  });

  it("keeps the tag's own proportions, so the text is never stretched", () => {
    const rect = labelRect(anchor, 96, 24);
    expect(rect.width).toBeCloseTo(96 / TILE, 6);
    expect(rect.height).toBeCloseTo(24 / TILE, 6);
    expect(rect.width / rect.height).toBeCloseTo(4, 6);
    // A two-word villager name is wider than a one-word monster name, and the
    // quad tracks the canvas rather than a fixed width.
    const longer = labelRect(anchor, 120, 24);
    expect(longer.width).toBeGreaterThan(rect.width);
    expect(longer.height).toBeCloseTo(rect.height, 6);
  });
});

describe("3D monster health bars", () => {
  it("draws the track the sprite renderer draws, just under the name", () => {
    const { track } = hpBarRects(anchor, 1);
    expect(track.width).toBeCloseTo(MONSTER_HP_BAR.widthPx / TILE, 6);
    expect(track.height).toBeCloseTo(MONSTER_HP_BAR.heightPx / TILE, 6);
    expect(track.y).toBeLessThan(anchor.tagAboveFeetTiles);
    expect(track.x).toBeCloseTo(anchor.x, 6);
  });

  it("fills to the share the server reports, shrinking about the centre", () => {
    const full = hpBarRects(anchor, 1);
    const half = hpBarRects(anchor, 0.5);
    expect(half.fill.width).toBeCloseTo(full.fill.width / 2, 6);
    expect(half.fill.x).toBeCloseTo(anchor.x, 6);
    // Half HP reads as a bar half full, not as a bar sliding off its track.
    expect(half.track.x).toBeCloseTo(anchor.x, 6);
    expect(full.fill.x).toBeCloseTo(anchor.x, 6);
  });

  it("clamps a share the client should never trust, and hides an empty fill", () => {
    expect(hpBarRects(anchor, 2).fill.width).toBeCloseTo(MONSTER_HP_BAR.widthPx / TILE, 6);
    expect(hpBarRects(anchor, -1).fill.width).toBe(0);
    expect(hpBarRects(anchor, 0).fill.width).toBe(0);
    // The track still draws at zero, so a nearly-dead creature reads as hurt.
    expect(hpBarRects(anchor, 0).track.width).toBeGreaterThan(0);
  });

  it("puts the fill in front of the track, never inside it", () => {
    const { track, fill } = hpBarRects(anchor, 0.5);
    expect(fill.z).toBeGreaterThan(track.z);
    // One tag-lift of separation, compared numerically: a repeated sum of
    // thirds of a pixel lands a hair off the constant and that is not a defect.
    expect(fill.z - track.z).toBeCloseTo(TAG_LIFT_TILES, 6);
  });
});
