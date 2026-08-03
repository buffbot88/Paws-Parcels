import { describe, expect, it } from "vitest";
import {
  moveIntervalMsForSpeed,
  validateMoveIntent,
} from "../../server/src/ws/movement.ts";

const NOW = 1_000_000;
const INTERVAL = 267; // ~3.75 tiles/s
const WALKABLE = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < 10 && y < 10;

function base(overrides: Partial<Parameters<typeof validateMoveIntent>[0]> = {}) {
  return {
    from: { x: 5, y: 5 },
    dx: 1,
    dy: 0,
    width: 10,
    height: 10,
    isWalkable: WALKABLE,
    lastMoveAt: NOW - INTERVAL, // long enough ago
    now: NOW,
    minMoveIntervalMs: INTERVAL,
    ...overrides,
  };
}

describe("validateMoveIntent", () => {
  it("accepts a valid 1-tile cardinal move", () => {
    const verdict = validateMoveIntent(base());
    expect(verdict).toEqual({ ok: true, to: { x: 6, y: 5 } });
  });

  it("accepts north/south/west moves", () => {
    expect(validateMoveIntent(base({ dx: 0, dy: -1 }))).toEqual({
      ok: true,
      to: { x: 5, y: 4 },
    });
    expect(validateMoveIntent(base({ dx: 0, dy: 1 }))).toEqual({
      ok: true,
      to: { x: 5, y: 6 },
    });
    expect(validateMoveIntent(base({ dx: -1, dy: 0 }))).toEqual({
      ok: true,
      to: { x: 4, y: 5 },
    });
  });

  it("rejects non-integer dx/dy", () => {
    expect(validateMoveIntent(base({ dx: 0.5, dy: 0 }))).toEqual({
      ok: false,
      code: "INVALID_DIRECTION",
    });
    expect(validateMoveIntent(base({ dx: 1, dy: NaN }))).toEqual({
      ok: false,
      code: "INVALID_DIRECTION",
    });
  });

  it("rejects diagonals and out-of-range directions", () => {
    expect(validateMoveIntent(base({ dx: 1, dy: 1 }))).toEqual({
      ok: false,
      code: "INVALID_DIRECTION",
    });
    expect(validateMoveIntent(base({ dx: 2, dy: 0 }))).toEqual({
      ok: false,
      code: "INVALID_DIRECTION",
    });
    expect(validateMoveIntent(base({ dx: 0, dy: 0 }))).toEqual({
      ok: false,
      code: "INVALID_DIRECTION",
    });
  });

  it("rejects a move into a colliding tile (MOVE_COLLISION)", () => {
    const verdict = validateMoveIntent(
      base({ isWalkable: () => false }),
    );
    expect(verdict).toEqual({ ok: false, code: "MOVE_COLLISION" });
  });

  it("rejects a move outside the zone bounds (MOVE_COLLISION)", () => {
    expect(
      validateMoveIntent(base({ from: { x: 0, y: 0 }, dx: -1, dy: 0 })),
    ).toEqual({ ok: false, code: "MOVE_COLLISION" });
    expect(
      validateMoveIntent(base({ from: { x: 9, y: 9 }, dx: 1, dy: 0 })),
    ).toEqual({ ok: false, code: "MOVE_COLLISION" });
  });

  it("rejects a move faster than the speed cap (MOVE_TELEPORT_DETECTED)", () => {
    const verdict = validateMoveIntent(
      base({ lastMoveAt: NOW - 10 }), // 10ms after the last move
    );
    expect(verdict).toEqual({ ok: false, code: "MOVE_TELEPORT_DETECTED" });
  });

  it("accepts a move exactly at the speed-cap interval", () => {
    const verdict = validateMoveIntent(
      base({ lastMoveAt: NOW - INTERVAL }),
    );
    expect(verdict).toEqual({ ok: true, to: { x: 6, y: 5 } });
  });

  it("defensively rejects a teleport to a non-adjacent tile", () => {
    // The dx/dy bounds already forbid this, but the check is explicit.
    const verdict = validateMoveIntent(
      base({ from: { x: 5, y: 5 }, dx: 1, dy: 0 }),
    );
    expect(verdict).toEqual({ ok: true, to: { x: 6, y: 5 } });
  });
});

describe("moveIntervalMsForSpeed", () => {
  it("derives an interval from tiles per second", () => {
    expect(moveIntervalMsForSpeed(3.75)).toBe(267);
    expect(moveIntervalMsForSpeed(5)).toBe(200);
  });

  it("clamps to a floor of 50ms and guards against zero/negative speed", () => {
    expect(moveIntervalMsForSpeed(1000)).toBe(50);
    expect(moveIntervalMsForSpeed(0)).toBe(1000);
    expect(moveIntervalMsForSpeed(-5)).toBe(1000);
  });
});
