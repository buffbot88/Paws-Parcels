/**
 * Monster decision loop (AI game engine). One brain call per zone per
 * interval, for the zone's most situationally interesting monster; the result
 * is applied at the next tick as an override, and every failure/cooldown
 * leaves the deterministic monster AI in charge. Everything is fire-and-forget
 * so the game tick never waits on the model.
 */
import { GameBrain } from "./GameBrain.ts";
import {
  buildMonsterSceneText,
  monsterDecisionSystemPrompt,
  type BrainMonsterDecision,
  type SceneMonster,
  type ZoneScene,
} from "./prompts.ts";

export interface MonsterBrainOptions {
  intervalMs: number;
  maxTokens: number;
}

export class MonsterBrain {
  private decisions = new Map<string, Map<string, BrainMonsterDecision>>();
  private lastDecisionAt = new Map<string, number>();
  private inFlight = new Set<string>();

  constructor(
    private readonly brain: GameBrain,
    private readonly opts: MonsterBrainOptions,
  ) {}

  /** Fire-and-forget warm-up (called when a player joins a zone). */
  prewarm(): void {
    this.brain.prewarm();
  }

  /** Decisions for a zone (read-only), or null when none are in effect. */
  decisionsFor(zoneId: string): ReadonlyMap<string, BrainMonsterDecision> | null {
    const zoneDecisions = this.decisions.get(zoneId);
    if (zoneDecisions === undefined || zoneDecisions.size === 0) return null;
    return zoneDecisions;
  }

  /** Clear a zone's decisions (e.g., zone emptied). */
  clearZone(zoneId: string): void {
    this.decisions.delete(zoneId);
    this.lastDecisionAt.delete(zoneId);
  }

  /**
   * Fire one decision request for the zone if it is due. Never awaited by the
   * caller; the result (or a failure) lands asynchronously.
   */
  requestDecision(scene: ZoneScene, now: number): void {
    if (this.inFlight.has(scene.zoneId)) return;
    const last = this.lastDecisionAt.get(scene.zoneId);
    // First call for a zone always fires; later ones wait out the interval.
    if (last !== undefined && now - last < this.opts.intervalMs) return;
    const featured = pickFeaturedMonster(scene);
    if (featured === null) return;
    this.inFlight.add(scene.zoneId);

    const system = monsterDecisionSystemPrompt();
    const user = buildMonsterSceneText(scene, featured);
    void this.brain
      .completeJson(system, user, this.opts.maxTokens)
      .then((parsed) => {
        const decision = normalizeDecision(parsed, featured.id);
        if (decision === null) {
          // Brain unavailable or unusable — drop any stale override so the
          // deterministic monster AI is fully back in charge.
          this.decisions.delete(scene.zoneId);
          return;
        }
        const zoneDecisions = new Map<string, BrainMonsterDecision>();
        zoneDecisions.set(featured.id, decision);
        this.decisions.set(scene.zoneId, zoneDecisions);
      })
      .catch(() => undefined)
      .finally(() => {
        this.inFlight.delete(scene.zoneId);
        this.lastDecisionAt.set(scene.zoneId, now);
      });
  }
}

/** The monster most worth a brain call: an aggro one with players nearby. */
function pickFeaturedMonster(scene: ZoneScene): SceneMonster | null {
  const candidates = scene.monsters.filter(
    (m) => m.hp > 0 && scene.players.some((p) => manhattan(p.pos, m.pos) <= 8),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aAggro = a.aggro ? 0 : 1;
    const bAggro = b.aggro ? 0 : 1;
    if (aAggro !== bAggro) return aAggro - bAggro;
    return b.hp - a.hp; // lower HP first (more "interesting" choices)
  });
  return candidates[0];
}

function manhattan(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Validate + shape a raw brain response into a decision, or null. */
export function normalizeDecision(
  parsed: unknown,
  monsterId: string,
): BrainMonsterDecision | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const action = obj.action;
  if (action !== "patrol" && action !== "seek" && action !== "attack" && action !== "flee") {
    return null;
  }
  const targetPlayerId =
    typeof obj.targetPlayerId === "number" && Number.isInteger(obj.targetPlayerId)
      ? obj.targetPlayerId
      : null;
  let targetTile: { x: number; y: number } | null = null;
  if (typeof obj.targetTile === "object" && obj.targetTile !== null) {
    const t = obj.targetTile as Record<string, unknown>;
    if (
      typeof t.x === "number" &&
      Number.isInteger(t.x) &&
      typeof t.y === "number" &&
      Number.isInteger(t.y)
    ) {
      targetTile = { x: t.x, y: t.y };
    }
  }
  // attack needs a target player; patrol/seek/flee need a tile.
  if (action === "attack" && targetPlayerId === null) return null;
  if (action !== "attack" && targetTile === null) return null;
  return {
    action,
    targetPlayerId,
    targetTile,
    reason: typeof obj.reason === "string" ? obj.reason.slice(0, 120) : undefined,
  };
}
