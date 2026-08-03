/** Character model — a player's in-game avatar. */
export interface Character {
  id: number;
  account_id: number;
  class_id: number;
  name: string;
  appearance: string; // JSON string
  zone_id: string;
  pos_x: number;
  pos_y: number;
  level: number;
  experience: number;
  stamps: number;
  hp: number;
  max_hp: number;
  resource_current: number;
  created_at: Date;
  updated_at: Date;
}

/** Character creation request. */
export interface CharacterCreateRequest {
  name: string;
  classKey: string; // 'bear-warrior' | 'cat-mage' | 'fox-archer'
  appearance: Record<string, unknown>;
}

/** Public character representation for API responses. */
export interface CharacterPublic {
  id: number;
  name: string;
  classKey: string;
  className: string;
  level: number;
  zone_id: string;
  pos_x: number;
  pos_y: number;
  stamps: number;
}

/** Full character state for the game client (includes HP, stats). */
export interface CharacterState extends CharacterPublic {
  hp: number;
  max_hp: number;
  experience: number;
  stats: {
    attack: number;
    defense: number;
    speed: number;
    crit_chance: number;
    crit_multiplier: number;
    max_resource: number;
    resource_regen: number;
  };
}