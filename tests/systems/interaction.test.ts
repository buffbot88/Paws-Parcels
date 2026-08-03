import { describe, expect, it } from "vitest";
import { findFocusedTarget, type InteractionTarget } from "../../src/systems/InteractionSystem.ts";

const TILE = 48;

function target(partial: Partial<InteractionTarget>): InteractionTarget {
  return {
    id: "t",
    kind: "npc",
    label: "T",
    x: 0,
    y: 0,
    ...partial,
  };
}

describe("findFocusedTarget", () => {
  it("returns null when nothing is in range", () => {
    const targets = [target({ id: "far", x: 100, y: 0 })];
    expect(findFocusedTarget(targets, 0, 0, TILE)).toBeNull();
  });

  it("returns the nearest in-range target", () => {
    const targets = [
      target({ id: "near", x: TILE * 0.8, y: 0 }),
      target({ id: "far", x: TILE * 1.1, y: 0 }),
    ];
    expect(findFocusedTarget(targets, 0, 0, TILE)?.id).toBe("near");
  });

  it("prefers an NPC over an object at the same distance", () => {
    const targets: InteractionTarget[] = [
      target({ id: "obj", kind: "mailbox", x: TILE, y: 0, label: "Mailbox" }),
      target({ id: "pip", kind: "npc", x: TILE, y: 0, label: "Pip" }),
    ];
    expect(findFocusedTarget(targets, 0, 0, TILE)?.id).toBe("pip");
  });

  it("treats the range as inclusive", () => {
    const targets = [target({ id: "edge", x: TILE, y: 0 })];
    expect(findFocusedTarget(targets, 0, 0, TILE)?.id).toBe("edge");
  });
});
