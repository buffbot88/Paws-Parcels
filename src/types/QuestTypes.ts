export type QuestType = "delivery" | "gathering" | "errand";

export interface FriendshipGate {
  npcId: string;
  level: number;
}

export interface QuestDialogue {
  speakerId: string;
  lines: string[];
}

/** Kill-count objective: defeat `count` of a monsters.json key, then report to targetId. */
export interface DefeatObjective {
  monsterKey: string;
  count: number;
}

export interface QuestDefinition {
  id: string;
  /** Release slice that exposes optional content to the live quest catalog. */
  phase?: "4B";
  title: string;
  description: string;
  type: QuestType;
  giverId: string;
  targetId?: string;
  /** Extra NPC stops for multi-stop deliveries, visited in any order before targetId. */
  additionalStops?: string[];
  /** Errand-only kill-count objective. */
  defeat?: DefeatObjective;
  requiredItemId?: string;
  requiredQuantity?: number;
  /** Tutorial parcel handling lesson; expanded parcel rules arrive later. */
  parcelCondition?: "normal" | "fragile" | "urgent";
  /** Server-authoritative tutorial reward and chain metadata. */
  xpReward?: number;
  reputationPoints?: number;
  chainPosition?: number;
  prerequisiteIds?: string[];
  courierRankReward?: string;
  /** Optional tutorial dialogue shown when the route is accepted or completed. */
  acceptanceDialogue?: QuestDialogue;
  completionDialogue?: QuestDialogue;
  /** Urgent routes expire after this many seconds and become available again. */
  timeLimitSeconds?: number;
  /** Fragile routes lose their parcel if the courier is defeated. */
  breaksOnDefeat?: boolean;
  /** Lost-item recovery location, required for errands with a requiredItemId. */
  findAt?: string;
  /** Map object that can be searched while the quest is active. */
  searchObjectId?: string;
  /** Item granted on completion (friendship reward quests). */
  rewardItemId?: string;
  stampReward: number;
  friendshipReward?: number;
  friendshipNpcId?: string;
  /** Quest only becomes available at this friendship level. */
  requiresFriendship?: FriendshipGate;
  /** Eligible for daily quest generation. Must never combine with requiresFriendship. */
  daily?: boolean;
}
