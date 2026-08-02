import type { NPC } from "./NPCtypes.ts";
import type { ItemDefinition } from "./ItemTypes.ts";
import type { QuestDefinition } from "./QuestTypes.ts";
import type { UpgradeDefinition } from "./UpgradeTypes.ts";
import type { DialogueSet } from "./DialogueTypes.ts";

export interface ContentData {
  npcs: NPC[];
  items: ItemDefinition[];
  quests: QuestDefinition[];
  upgrades: UpgradeDefinition[];
  dialogue: DialogueSet[];
}
