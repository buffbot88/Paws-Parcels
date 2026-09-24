/**
 * Which quest marker hangs over a villager, derived only from server quest and
 * inventory snapshots. Display only: the server still decides every hand-in.
 */
import type { NetQuestInventoryItem, NetQuestSnapshot } from "../../net/GameSocket.ts";

export type NpcQuestMarker = "available" | "ready" | "stop";

export type HeldItem = Pick<NetQuestInventoryItem, "itemKey" | "quantity" | "locked">;

export type MarkerQuest = Pick<
  NetQuestSnapshot,
  "state" | "type" | "giverId" | "targetId" | "requiredItemId" | "requiredQuantity" | "progress" | "defeat" | "additionalStops" | "visitedStops"
>;

/** Largest single unlocked stack of `itemKey` — the only stack a server hand-in accepts. */
export function heldForHandIn(itemKey: string, inventory: readonly HeldItem[]): number {
  return inventory.reduce((best, item) => (item.itemKey === itemKey && !item.locked ? Math.max(best, item.quantity) : best), 0);
}

/** Mirrors the server's completeDelivery checks: kills, stops, then the held item. */
export function questLooksReady(quest: MarkerQuest, inventory: readonly HeldItem[]): boolean {
  if (quest.defeat !== null && quest.progress < quest.defeat.count) return false;
  if (quest.additionalStops.some((stop) => !quest.visitedStops.includes(stop))) return false;
  const itemKey = quest.requiredItemId;
  if (itemKey === null) return true;
  if (quest.type === "delivery") {
    return inventory.some((item) => item.itemKey === itemKey && item.locked && item.quantity >= quest.requiredQuantity);
  }
  return heldForHandIn(itemKey, inventory) >= quest.requiredQuantity;
}

/** The marker for one villager, or null. Only one quest can be active, so "!" shows only when none is. */
export function npcQuestMarker(npcId: string, quests: readonly MarkerQuest[], inventory: readonly HeldItem[]): NpcQuestMarker | null {
  const active = quests.filter((quest) => quest.state === "active");
  if (active.some((quest) => quest.targetId === npcId && questLooksReady(quest, inventory))) return "ready";
  if (active.some((quest) => quest.type === "delivery" && quest.additionalStops.includes(npcId) && !quest.visitedStops.includes(npcId))) {
    return "stop";
  }
  if (active.length === 0 && quests.some((quest) => quest.state === "available" && quest.giverId === npcId)) return "available";
  return null;
}
