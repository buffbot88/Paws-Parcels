import type { NPC } from "./NPCtypes.ts";
import type { ItemDefinition } from "./ItemTypes.ts";
import type { QuestDefinition } from "./QuestTypes.ts";
import type { UpgradeDefinition } from "./UpgradeTypes.ts";
import type { DialogueSet } from "./DialogueTypes.ts";
import type { ClassContent, MonsterContent, SkillContent, ZoneContent } from "./StaticContentTypes.ts";

export interface ContentData {
  npcs: NPC[];
  items: ItemDefinition[];
  quests: QuestDefinition[];
  upgrades: UpgradeDefinition[];
  dialogue: DialogueSet[];
}

export interface StaticContentData {
  classes: ClassContent[];
  skills: SkillContent[];
  zones: ZoneContent[];
  monsters: MonsterContent[];
}
