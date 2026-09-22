import type { InteractableKind } from "../game/Maps.ts";

/**
 * Anything the player can talk to or use: an NPC (from npcs.json, keyed by
 * homeZone/homeTile) or a static map object (from map JSON `interactables`).
 * Positions are world pixels (tile center).
 */
export interface InteractionTarget {
  id: string;
  kind: InteractableKind | "npc";
  label: string;
  x: number;
  y: number;
  /** Set for NPC targets so the scene can resolve dialogue via npcId. */
  npcId?: string;
  /** Flavor lines for map objects (NPC dialogue comes from dialogue.json). */
  lines?: string[];
  /**
   * Vertical offset (px, negative = above the tile centre) of this target's
   * interaction badge. The scene sets it, because only the scene knows what is
   * already drawn over that spot: a villager's name tag, an object marker.
   */
  promptOffsetPx: number;
}

/**
 * Finds the nearest target within rangePx of (px,py). On a near-tie, NPCs
 * win over map objects so characters take priority over scenery.
 */
export function findFocusedTarget(
  targets: readonly InteractionTarget[],
  px: number,
  py: number,
  rangePx: number,
): InteractionTarget | null {
  let best: InteractionTarget | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const t of targets) {
    const d = Math.hypot(t.x - px, t.y - py);
    if (d > rangePx) continue;
    if (d < bestDist - 0.5 || (Math.abs(d - bestDist) <= 0.5 && t.kind === "npc" && best?.kind !== "npc")) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Static registry of the current zone's interactables (built per scene
 * create) plus focus lookup. Holds no listeners — the scene polls it each
 * frame, so nothing needs tearing down on scene restart.
 */
export class InteractionSystem {
  static readonly RANGE = 1.2; // tiles

  private readonly targets: InteractionTarget[];

  constructor(targets: InteractionTarget[]) {
    this.targets = targets;
  }

  /** The nearest target within interaction range of the player, or null. */
  getFocused(playerX: number, playerY: number, tileSize: number): InteractionTarget | null {
    return findFocusedTarget(this.targets, playerX, playerY, InteractionSystem.RANGE * tileSize);
  }
}
