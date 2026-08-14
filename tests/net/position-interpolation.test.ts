import { describe, expect, it } from "vitest";
import { PositionSampleBuffer } from "../../src/net/positionInterpolation.ts";

describe("PositionSampleBuffer", () => {
  it("interpolates between authoritative samples", () => {
    const buffer = new PositionSampleBuffer();
    buffer.add({ at: 1000, x: 0, y: 0 });
    buffer.add({ at: 1100, x: 48, y: 24 });

    expect(buffer.positionAt(1050)).toEqual({ x: 24, y: 12, moving: true });
  });

  it("ignores out-of-order samples", () => {
    const buffer = new PositionSampleBuffer();
    buffer.add({ at: 1100, x: 48, y: 0 });
    expect(buffer.add({ at: 1000, x: 0, y: 0 })).toBe(false);
    expect(buffer.latest()).toEqual({ at: 1100, x: 48, y: 0 });
  });

  it("caps history and holds the newest position after the buffer horizon", () => {
    const buffer = new PositionSampleBuffer(2);
    buffer.add({ at: 1000, x: 0, y: 0 });
    buffer.add({ at: 1100, x: 48, y: 0 });
    buffer.add({ at: 1200, x: 96, y: 0 });

    expect(buffer.positionAt(1150)).toEqual({ x: 72, y: 0, moving: true });
    expect(buffer.positionAt(1300)).toEqual({ x: 96, y: 0, moving: false });
  });
});
