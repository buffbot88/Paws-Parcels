export type UpgradeEffectType = "inventorySlots" | "speedMultiplier" | "unlockQuests";

export interface UpgradeEffect {
  type: UpgradeEffectType;
  value: number;
}

export interface UpgradeDefinition {
  id: string;
  name: string;
  description: string;
  cost: number;
  effect: UpgradeEffect;
}
