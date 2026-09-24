/**
 * The three-free half of the 3D effects layer: what the network layer needs
 * without pulling three.js into the main bundle (the 3D renderer loads lazily).
 */
import type { NetCombatEvent } from "../net/GameSocket.ts";
import type { WorldEffects3D } from "./effects3d.ts";

export type DamageOutcome = NetCombatEvent["outcome"];

/** A damage number's text and look, shared by both renderers. */
export function damageNumberStyle(
  damage: number,
  outcome: DamageOutcome,
): { label: string; colour: string; fontPx: number } {
  return {
    label: outcome === "crit" ? `${damage}!` : String(damage),
    colour: outcome === "crit" ? "#e0c040" : outcome === "defeated" ? "#d05050" : "#ffffff",
    fontPx: outcome === "crit" ? 18 : 15,
  };
}

let active: WorldEffects3D | null = null;

/** The live 3D effects layer, or null when the sprite renderer is drawing. */
export function activeWorldEffects(): WorldEffects3D | null {
  return active;
}

export function setActiveWorldEffects(effects: WorldEffects3D | null): void {
  active = effects;
}
