export type ItemCategory = "resource" | "gift" | "delivery" | "quest" | "cosmetic";

export interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  maxStack: number;
  icon: string;
  favoriteBy?: string[];
}
