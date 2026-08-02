import type { PlayerState } from "./PlayerTypes.ts";

export type TextSpeed = "slow" | "normal" | "fast";

export interface GameSettings {
  musicVolume: number;
  sfxVolume: number;
  textSpeed: TextSpeed;
  highContrast: boolean;
  reducedMotion: boolean;
}

export interface SaveData {
  version: number;
  player: PlayerState;
  inventory: Record<string, number>;
  friendships: Record<string, number>;
  activeQuestIds: string[];
  completedQuestIds: string[];
  unlockedZoneIds: string[];
  purchasedUpgradeIds: string[];
  currentDay: number;
  settings: GameSettings;
}
