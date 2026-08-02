export type QuestType = "delivery" | "gathering" | "errand";

export interface FriendshipGate {
  npcId: string;
  level: number;
}

export interface QuestDefinition {
  id: string;
  title: string;
  description: string;
  type: QuestType;
  giverId: string;
  targetId?: string;
  /** Extra stops for multi-stop deliveries, in visit order. */
  additionalStops?: string[];
  requiredItemId?: string;
  requiredQuantity?: number;
  /** Lost-item recovery location, required for errands with a requiredItemId. */
  findAt?: string;
  /** Item granted on completion (friendship/L4 reward quests). */
  rewardItemId?: string;
  stampReward: number;
  friendshipReward?: number;
  friendshipNpcId?: string;
  /** Quest only becomes available at this friendship level. */
  requiresFriendship?: FriendshipGate;
  /** Eligible for daily quest generation. Must never combine with requiresFriendship. */
  daily?: boolean;
}
