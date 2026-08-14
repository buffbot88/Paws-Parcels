export type ItemCategory = "resource" | "gift" | "delivery" | "quest" | "cosmetic" | "material" | "equipment";
export type EquipmentSlot = "head" | "body" | "weapon" | "accessory" | "boots" | "courier-bag";

export interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  maxStack: number;
  icon: string;
  favoriteBy?: string[];
  rarity?: string;
  value?: number;
  equipmentSlot?: EquipmentSlot;
  stats?: Record<string, number | undefined>;
  courierEffects?: Record<string, number | undefined>;
  requiredClass?: string;
  requiredLevel?: number;
}
