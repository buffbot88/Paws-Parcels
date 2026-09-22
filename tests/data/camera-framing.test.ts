import { describe, expect, it } from "vitest";
import {
  CAMERA_FRAMING,
  biasOffsetPx,
  easeToward,
  framedFollowOffset,
  framingForMotionPreference,
  lookAheadTargetPx,
  type CameraFraming,
  type OffsetPx,
} from "../../src/game/cameraFraming.ts";

/**
 * Camera framing tests (the Pass 1 follow-up).
 *
 * `startFollow` centres the courier exactly, which gives the ground already
 * walked as much of the viewport as the world ahead — the flat-field reading the
 * visual overhaul exists to fix. These pin the two rules that replace it, because
 * nothing else can: the framing is pure rendering, so no content audit, no plan
 * test and no screenshot comparison sees it.
 */

const TILE = 48;
const VIEWPORT = { heightPx: 540, zoom: 1.1 };
const IDLE: OffsetPx = { x: 0, y: 0 };

/** Run the framing for `frames` frames at a fixed step and return the state. */
function run(
  framing: CameraFraming,
  direction: OffsetPx,
  frames: number,
  dtSeconds = 1 / 60,
  viewport = VIEWPORT,
): { offset: OffsetPx; lookAhead: OffsetPx } {
  let lookAhead: OffsetPx = { x: 0, y: 0 };
  let offset: OffsetPx = { x: 0, y: 0 };
  for (let i = 0; i < frames; i += 1) {
    const framed = framedFollowOffset(framing, viewport, direction, lookAhead, TILE, dtSeconds);
    lookAhead = framed.lookAhead;
    offset = { x: framed.x, y: framed.y };
  }
  return { offset, lookAhead };
}

describe("camera framing — the shipped rules", () => {
  it("keeps the courier below centre, and always in the lower half", () => {
    // A courier at the very centre is the flat-field reading; a courier near the
    // bottom edge loses the world ahead entirely.
    expect(CAMERA_FRAMING.verticalBias).toBeGreaterThan(0.03);
    expect(CAMERA_FRAMING.verticalBias).toBeLessThan(0.25);
  });

  it("never leads more than a tile, so the camera cannot outrun the player", () => {
    expect(CAMERA_FRAMING.lookAheadTiles).toBeGreaterThan(0);
    expect(CAMERA_FRAMING.lookAheadTiles).toBeLessThanOrEqual(1);
    expect(CAMERA_FRAMING.lookAheadEasePerSecond).toBeGreaterThan(0);
  });
});

describe("camera framing — the vertical bias", () => {
  it("renders the same on-screen shift at every zoom", () => {
    // The offset is in world units and the camera is zoomed, so the two cancel:
    // a zone cannot be framed differently from another by accident.
    for (const zoom of [0.8, 1, 1.1, 1.6]) {
      const shiftPx = biasOffsetPx(CAMERA_FRAMING, VIEWPORT.heightPx, zoom) * zoom;
      expect(shiftPx).toBeCloseTo(CAMERA_FRAMING.verticalBias * VIEWPORT.heightPx, 6);
    }
    expect(biasOffsetPx(CAMERA_FRAMING, VIEWPORT.heightPx, 0)).toBe(0);
  });

  it("puts the focus above the courier, and only vertically", () => {
    const { offset } = run(CAMERA_FRAMING, IDLE, 1);
    expect(offset.x).toBe(0);
    expect(offset.y).toBeGreaterThan(0);
    expect(offset.y * VIEWPORT.zoom).toBeCloseTo(
      CAMERA_FRAMING.verticalBias * VIEWPORT.heightPx,
      6,
    );
  });

  it("scales with the viewport, so a shorter window still shows world ahead", () => {
    const tall = run(CAMERA_FRAMING, IDLE, 1);
    const short = run(CAMERA_FRAMING, IDLE, 1, 1 / 60, { heightPx: 360, zoom: 1.1 });
    expect(short.offset.y * VIEWPORT.zoom).toBeCloseTo(
      CAMERA_FRAMING.verticalBias * 360,
      6,
    );
    expect(short.offset.y).toBeLessThan(tall.offset.y);
  });
});

describe("camera framing — the movement look-ahead", () => {
  it("asks for nothing while the courier stands still", () => {
    expect(lookAheadTargetPx(CAMERA_FRAMING, IDLE, TILE)).toEqual({ x: 0, y: 0 });
  });

  it("leads by the same distance in every direction", () => {
    const north = lookAheadTargetPx(CAMERA_FRAMING, { x: 0, y: -1 }, TILE);
    const east = lookAheadTargetPx(CAMERA_FRAMING, { x: 1, y: 0 }, TILE);
    const diagonal = lookAheadTargetPx(CAMERA_FRAMING, { x: 0.7071, y: -0.7071 }, TILE);
    const length = (v: OffsetPx): number => Math.hypot(v.x, v.y);
    expect(length(north)).toBeCloseTo(CAMERA_FRAMING.lookAheadTiles * TILE, 4);
    expect(length(east)).toBeCloseTo(length(north), 4);
    // A diagonal step must not lead further than a straight one — the server
    // refuses diagonals anyway, but the client vector is normalised.
    expect(length(diagonal)).toBeCloseTo(length(north), 4);
    expect(north.y).toBeLessThan(0);
    expect(east.x).toBeGreaterThan(0);
  });

  it("leads the direction of travel: walking north pushes the courier lower", () => {
    const idle = run(CAMERA_FRAMING, IDLE, 60);
    const north = run(CAMERA_FRAMING, { x: 0, y: -1 }, 240);
    // Focus further north (higher offset) = courier further down the frame.
    // Eased, so it approaches the peak rather than landing on it.
    expect(north.offset.y).toBeGreaterThan(idle.offset.y);
    expect(north.offset.y - idle.offset.y).toBeGreaterThan(
      CAMERA_FRAMING.lookAheadTiles * TILE * 0.98,
    );
    expect(north.offset.y - idle.offset.y).toBeLessThanOrEqual(CAMERA_FRAMING.lookAheadTiles * TILE);
    expect(north.offset.x).toBe(0);
  });

  it("leads sideways on a lateral walk", () => {
    const east = run(CAMERA_FRAMING, { x: 1, y: 0 }, 240);
    expect(east.offset.x).toBeLessThan(-CAMERA_FRAMING.lookAheadTiles * TILE * 0.98);
    expect(east.offset.x).toBeGreaterThanOrEqual(-CAMERA_FRAMING.lookAheadTiles * TILE);
    // The vertical bias survives the lead.
    expect(east.offset.y).toBeGreaterThan(0);
  });

  it("unwinds the lead when the courier stops", () => {
    let lookAhead: OffsetPx = { x: 0, y: 0 };
    let offset: OffsetPx = { x: 0, y: 0 };
    for (let i = 0; i < 60; i += 1) {
      const framed = framedFollowOffset(
        CAMERA_FRAMING,
        VIEWPORT,
        { x: 0, y: -1 },
        lookAhead,
        TILE,
        1 / 60,
      );
      lookAhead = framed.lookAhead;
      offset = { x: framed.x, y: framed.y };
    }
    const leading = offset.y;
    for (let i = 0; i < 90; i += 1) {
      const framed = framedFollowOffset(CAMERA_FRAMING, VIEWPORT, IDLE, lookAhead, TILE, 1 / 60);
      lookAhead = framed.lookAhead;
      offset = { x: framed.x, y: framed.y };
    }
    expect(offset.y).toBeLessThan(leading);
    expect(offset.y).toBeCloseTo(biasOffsetPx(CAMERA_FRAMING, VIEWPORT.heightPx, VIEWPORT.zoom), 0);
  });

  it("holds the lead inside its clamp however long the walk lasts", () => {
    const lead = run(CAMERA_FRAMING, { x: 0, y: -1 }, 600).lookAhead;
    expect(Math.hypot(lead.x, lead.y)).toBeLessThanOrEqual(CAMERA_FRAMING.lookAheadTiles * TILE + 1e-6);
  });
});

describe("camera framing — easing", () => {
  it("approaches the target without overshooting", () => {
    let value = 0;
    let previous = -1;
    for (let i = 0; i < 120; i += 1) {
      value = easeToward(value, 28.8, 4.5, 1 / 60);
      expect(value).toBeGreaterThan(previous);
      expect(value).toBeLessThanOrEqual(28.8);
      previous = value;
    }
    // Asymptotic, never overshooting: at ~4.5/s, two seconds gets within a pixel.
    expect(value).toBeCloseTo(28.8, 0);
  });

  it("is frame-rate independent, so the camera feels the same on any display", () => {
    // A per-frame lerp settles twice as fast at 144 fps as at 60; the
    // exponential form is what keeps the camera's feel off the frame rate.
    let fast = 0;
    for (let i = 0; i < 144; i += 1) fast = easeToward(fast, 28.8, 4.5, 1 / 144);
    let slow = 0;
    for (let i = 0; i < 30; i += 1) slow = easeToward(slow, 28.8, 4.5, 1 / 30);
    expect(Math.abs(fast - slow)).toBeLessThan(0.5);
  });

  it("holds still when the clock or the rate is unusable", () => {
    expect(easeToward(12, 30, 4.5, 0)).toBe(12);
    expect(easeToward(12, 30, 0, 1 / 60)).toBe(12);
  });
});

describe("camera framing — motion preference", () => {
  it("keeps the composition and drops the lead under reduced motion", () => {
    const reduced = framingForMotionPreference(CAMERA_FRAMING, true);
    expect(reduced.verticalBias).toBe(CAMERA_FRAMING.verticalBias);
    expect(reduced.lookAheadTiles).toBe(0);
    // Whatever the input, the offset never leaves the bias.
    const bias = biasOffsetPx(reduced, VIEWPORT.heightPx, VIEWPORT.zoom);
    for (const direction of [IDLE, { x: 0, y: -1 }, { x: 1, y: 1 }] as OffsetPx[]) {
      const { offset } = run(reduced, direction, 30);
      expect(offset.x).toBe(0);
      expect(offset.y).toBeCloseTo(bias, 6);
    }
  });

  it("treats the default preference as the shipped framing", () => {
    expect(framingForMotionPreference(CAMERA_FRAMING, false)).toBe(CAMERA_FRAMING);
  });
});
