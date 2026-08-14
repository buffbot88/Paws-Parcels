export interface ClassContent {
  key: string;
  displayName: string;
  animal: string;
  role: string;
  primaryResource: string;
  resourceMax: number;
  resourceRegenPerSec: number;
  baseStats: Record<string, number>;
  description: string;
}

export interface SkillContent {
  skillKey: string;
  classKey: string;
  name: string;
  description: string;
  cost: number;
  requiredLevel: number;
  prerequisiteKey: string | null;
}

export interface ZoneContent {
  key: string;
  displayName: string;
  kind: string;
  mapDataId: string;
  widthTiles: number;
  heightTiles: number;
  defaultSpawn: { x: number; y: number };
  maxPlayers: number;
  isSafe: boolean;
}

export interface LootContent {
  key: string;
  chance: number;
  quantity: number;
}

export interface MonsterContent {
  key: string;
  displayName: string;
  zoneKey: string;
  familyId: string;
  levelMin: number;
  levelMax: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  aggroBehavior: string;
  attackBehavior: string;
  lootTable: LootContent[];
  respawnSeconds: number;
  experienceReward: number;
}
