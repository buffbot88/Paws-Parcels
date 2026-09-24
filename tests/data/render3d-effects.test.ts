/**
 * 3D combat feedback and atmosphere: the pure rules behind the pooled quads,
 * the per-zone fog table and the ambient motes.
 */
import { describe, expect, it } from "vitest";
import {
  DAMAGE_NUMBER_RISE_TILES,
  DAMAGE_NUMBER_SECONDS,
  damageNumberCurve,
  damageNumberStyle,
} from "../../src/render3d/effects3d.ts";
import { ambientPoint, wrapInto, zoneAtmosphere } from "../../src/render3d/ambient3d.ts";

describe("damage numbers", () => {
  it("rises with an ease-out and fades out by the end", () => {
    const start = damageNumberCurve(0);
    expect(start.rise).toBe(0);
    expect(start.alpha).toBe(1);
    expect(start.done).toBe(false);
    const half = damageNumberCurve(DAMAGE_NUMBER_SECONDS / 2);
    // Ease-out: more than half the rise in the first half of the life.
    expect(half.rise).toBeGreaterThan(DAMAGE_NUMBER_RISE_TILES / 2);
    expect(half.alpha).toBeGreaterThan(0.5);
    const end = damageNumberCurve(DAMAGE_NUMBER_SECONDS);
    expect(end.rise).toBeCloseTo(DAMAGE_NUMBER_RISE_TILES, 6);
    expect(end.alpha).toBe(0);
    expect(end.done).toBe(true);
  });

  it("is monotonic: never sinks, never brightens", () => {
    let previous = damageNumberCurve(0);
    for (let t = 0.02; t <= DAMAGE_NUMBER_SECONDS; t += 0.02) {
      const next = damageNumberCurve(t);
      expect(next.rise).toBeGreaterThanOrEqual(previous.rise);
      expect(next.alpha).toBeLessThanOrEqual(previous.alpha);
      previous = next;
    }
  });

  it("pops briefly and settles at full size", () => {
    expect(damageNumberCurve(0).scale).toBeGreaterThan(1);
    expect(damageNumberCurve(DAMAGE_NUMBER_SECONDS / 2).scale).toBe(1);
  });

  it("stays in place when the rise is zero (reduced motion)", () => {
    expect(damageNumberCurve(DAMAGE_NUMBER_SECONDS / 2, 0).rise).toBe(0);
  });

  it("styles crits larger and gold, defeats red, hits white — as the 2D renderer did", () => {
    expect(damageNumberStyle(12, "crit")).toEqual({ label: "12!", colour: "#e0c040", fontPx: 18 });
    expect(damageNumberStyle(7, "defeated")).toEqual({ label: "7", colour: "#d05050", fontPx: 15 });
    expect(damageNumberStyle(3, "hit")).toEqual({ label: "3", colour: "#ffffff", fontPx: 15 });
  });
});

describe("zone atmosphere", () => {
  it("gives the village a warmer fog than the valley", () => {
    const warmth = (hex: number): number => ((hex >> 16) & 0xff) - (hex & 0xff);
    const village = zoneAtmosphere("zone-clover-village");
    const valley = zoneAtmosphere("zone-happy-valley");
    expect(warmth(village.fog.colour)).toBeGreaterThan(warmth(valley.fog.colour));
  });

  it("starts fog beyond the camera's focus distance and keeps near < far", () => {
    for (const zone of ["zone-clover-village", "zone-happy-valley"]) {
      const { fog } = zoneAtmosphere(zone);
      expect(fog.near).toBeGreaterThan(15);
      expect(fog.far).toBeGreaterThan(fog.near);
    }
  });

  it("falls back to the village for an unknown zone", () => {
    expect(zoneAtmosphere("zone-nowhere")).toBe(zoneAtmosphere("zone-clover-village"));
  });

  it("keeps every zone within the 150-mote budget", () => {
    for (const zone of ["zone-clover-village", "zone-happy-valley"]) {
      expect(zoneAtmosphere(zone).ambient.count).toBeLessThanOrEqual(150);
    }
  });
});

describe("ambient motes", () => {
  it("wraps values into the span, negatives included", () => {
    expect(wrapInto(5, 0, 4)).toBeCloseTo(1, 9);
    expect(wrapInto(-1, 0, 4)).toBeCloseTo(3, 9);
    expect(wrapInto(10, 8, 4)).toBeCloseTo(10, 9);
    expect(wrapInto(7.5, 8, 4)).toBeCloseTo(11.5, 9);
  });

  it("keeps every mote inside the box around the focus, at any time", () => {
    for (const zone of ["zone-clover-village", "zone-happy-valley"]) {
      const style = zoneAtmosphere(zone).ambient;
      for (const [t, focus] of [
        [0, { x: 0, z: 0 }],
        [13.7, { x: 42.3, z: -8.1 }],
        [9999.25, { x: -120, z: 300 }],
      ] as const) {
        for (let i = 0; i < style.count; i += 1) {
          const p = ambientPoint(style, i, t, focus);
          expect(p.x).toBeGreaterThanOrEqual(focus.x - style.box.width / 2);
          expect(p.x).toBeLessThan(focus.x + style.box.width / 2);
          expect(p.z).toBeGreaterThanOrEqual(focus.z - style.box.depth / 2);
          expect(p.z).toBeLessThan(focus.z + style.box.depth / 2);
          expect(p.y).toBeGreaterThan(0);
          expect(p.glow).toBeGreaterThanOrEqual(0);
          expect(p.glow).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("is deterministic and world-anchored: panning does not drag motes along", () => {
    const style = zoneAtmosphere("zone-happy-valley").ambient;
    expect(ambientPoint(style, 7, 3.5, { x: 10, z: 10 })).toEqual(
      ambientPoint(style, 7, 3.5, { x: 10, z: 10 }),
    );
    // A small pan leaves a mote well inside the box exactly where it was.
    const at = ambientPoint(style, 7, 3.5, { x: 10, z: 10 });
    const panned = ambientPoint(style, 7, 3.5, { x: at.x, z: at.z });
    expect(panned.x).toBeCloseTo(at.x, 9);
    expect(panned.z).toBeCloseTo(at.z, 9);
  });
});
