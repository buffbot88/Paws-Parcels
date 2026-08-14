import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MonsterBrain,
  normalizeDecision,
} from "../../server/src/ai/MonsterBrain.ts";
import type { GameBrain } from "../../server/src/ai/GameBrain.ts";
import type { ZoneScene } from "../../server/src/ai/prompts.ts";

function fakeBrain(): { brain: GameBrain; completeJson: ReturnType<typeof vi.fn> } {
  const completeJson = vi.fn(async () => ({
    action: "patrol",
    targetPlayerId: null,
    targetTile: { x: 3, y: 3 },
    reason: "stretch the legs",
  }));
  const brain = {
    completeJson,
    prewarm: vi.fn(),
  } as unknown as GameBrain;
  return { brain, completeJson };
}

function makeBrain(overrides: Partial<{ intervalMs: number; maxTokens: number }> = {}) {
  const { brain, completeJson } = fakeBrain();
  const monsterBrain = new MonsterBrain(brain, {
    intervalMs: overrides.intervalMs ?? 5_000,
    maxTokens: overrides.maxTokens ?? 40,
  });
  return { monsterBrain, brain, completeJson };
}

function scene(overrides: Partial<ZoneScene> = {}): ZoneScene {
  return {
    zoneId: "zone-happy-valley",
    width: 40,
    height: 30,
    monsters: [
      { id: "m1", name: "Boar", pos: { x: 10, y: 10 }, hp: 30, maxHp: 30, aggro: true },
      { id: "m2", name: "Hare", pos: { x: 30, y: 25 }, hp: 20, maxHp: 20, aggro: false },
    ],
    players: [{ id: 1, name: "Maple", pos: { x: 12, y: 10 }, hp: 100, maxHp: 100 }],
    isWalkable: () => true,
    ...overrides,
  };
}

/** Flush the fire-and-forget promise chain. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MonsterBrain", () => {
  it("requests a decision and stores it for the zone", async () => {
    const { monsterBrain, completeJson } = makeBrain();
    monsterBrain.requestDecision(scene(), 1_000);
    expect(completeJson).toHaveBeenCalledTimes(1);
    await settle();
    const decisions = monsterBrain.decisionsFor("zone-happy-valley");
    expect(decisions).not.toBeNull();
    expect(decisions?.get("m1")).toMatchObject({ action: "patrol" });
    // No decision yet for other zones.
    expect(monsterBrain.decisionsFor("zone-clover-village")).toBeNull();
  });

  it("skips the call when no player is near any monster", async () => {
    const { monsterBrain, completeJson } = makeBrain();
    monsterBrain.requestDecision(
      scene({ players: [{ id: 1, name: "Maple", pos: { x: 2, y: 2 }, hp: 100, maxHp: 100 }] }),
      1_000,
    );
    await settle();
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("throttles to one brain call per interval per zone", async () => {
    const { monsterBrain, completeJson } = makeBrain({ intervalMs: 5_000 });
    monsterBrain.requestDecision(scene(), 1_000);
    await settle();
    monsterBrain.requestDecision(scene(), 1_500); // still within the interval
    await settle();
    expect(completeJson).toHaveBeenCalledTimes(1);
    // A later request is allowed again.
    monsterBrain.requestDecision(scene(), 6_500);
    await settle();
    expect(completeJson).toHaveBeenCalledTimes(2);
  });

  it("ignores a new request while one is in flight", async () => {
    let resolveCall!: (value: unknown) => void;
    const completeJson = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCall = resolve;
        }),
    );
    const brain = { completeJson } as unknown as GameBrain;
    const monsterBrain = new MonsterBrain(brain, { intervalMs: 5_000, maxTokens: 40 });
    monsterBrain.requestDecision(scene(), 1_000);
    expect(completeJson).toHaveBeenCalledTimes(1);
    monsterBrain.requestDecision(scene(), 1_100); // in flight — dropped
    expect(completeJson).toHaveBeenCalledTimes(1);
    resolveCall({ action: "flee", targetPlayerId: null, targetTile: { x: 1, y: 1 } });
    await settle();
    expect(monsterBrain.decisionsFor("zone-happy-valley")?.get("m1")?.action).toBe("flee");
  });

  it("clears stale decisions when the brain stops answering", async () => {
    const { monsterBrain, completeJson } = makeBrain();
    monsterBrain.requestDecision(scene(), 1_000);
    await settle();
    expect(monsterBrain.decisionsFor("zone-happy-valley")).not.toBeNull();
    // The brain is now down — its next response is null. The stale override
    // must be dropped so the deterministic monster AI is fully in charge.
    completeJson.mockResolvedValue(null);
    monsterBrain.requestDecision(scene(), 6_500); // past the throttle window
    await settle();
    expect(monsterBrain.decisionsFor("zone-happy-valley")).toBeNull();
  });

  it("clears a zone's decisions and lets it be asked again", async () => {
    const { monsterBrain, completeJson } = makeBrain();
    monsterBrain.requestDecision(scene(), 1_000);
    await settle();
    expect(monsterBrain.decisionsFor("zone-happy-valley")).not.toBeNull();
    monsterBrain.clearZone("zone-happy-valley");
    expect(monsterBrain.decisionsFor("zone-happy-valley")).toBeNull();
    monsterBrain.requestDecision(scene(), 1_001);
    await settle();
    expect(completeJson).toHaveBeenCalledTimes(2); // throttle state cleared too
  });

  it("prewarm delegates to the brain", () => {
    const { monsterBrain, brain } = makeBrain();
    monsterBrain.prewarm();
    expect(brain.prewarm).toHaveBeenCalled();
  });
});

describe("normalizeDecision", () => {
  it("accepts a valid attack decision", () => {
    const d = normalizeDecision(
      { action: "attack", targetPlayerId: 3, targetTile: null, reason: "hungry" },
      "m1",
    );
    expect(d).toEqual({
      action: "attack",
      targetPlayerId: 3,
      targetTile: null,
      reason: "hungry",
    });
  });

  it("rejects an attack without a target player", () => {
    expect(
      normalizeDecision({ action: "attack", targetPlayerId: null, targetTile: null }, "m1"),
    ).toBeNull();
  });

  it("rejects patrol/seek/flee without a target tile", () => {
    expect(
      normalizeDecision({ action: "patrol", targetPlayerId: null, targetTile: null }, "m1"),
    ).toBeNull();
    expect(
      normalizeDecision({ action: "seek", targetPlayerId: null, targetTile: { x: 1 } }, "m1"),
    ).toBeNull();
  });

  it("rejects unknown actions and non-objects", () => {
    expect(normalizeDecision({ action: "dance", targetPlayerId: null, targetTile: { x: 1, y: 1 } }, "m1")).toBeNull();
    expect(normalizeDecision(null, "m1")).toBeNull();
    expect(normalizeDecision("patrol", "m1")).toBeNull();
  });

  it("rejects non-integer target player ids", () => {
    expect(
      normalizeDecision({ action: "attack", targetPlayerId: 1.5, targetTile: null }, "m1"),
    ).toBeNull();
    expect(
      normalizeDecision({ action: "attack", targetPlayerId: "3", targetTile: null }, "m1"),
    ).toBeNull();
  });
});
