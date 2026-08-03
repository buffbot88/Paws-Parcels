-- Paws & Parcels — Initial Schema (Phase 1, Online Foundation)
-- Conventions: InnoDB, utf8mb4, snake_case, BIGINT UNSIGNED auto-increment PKs

-- 1. accounts
CREATE TABLE accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  username VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('active', 'banned') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  UNIQUE INDEX idx_accounts_email (email),
  UNIQUE INDEX idx_accounts_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. refresh_tokens (sessions)
CREATE TABLE refresh_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  refresh_token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NULL,
  user_agent VARCHAR(500) DEFAULT NULL,
  ip VARCHAR(45) DEFAULT NULL,
  UNIQUE INDEX idx_refresh_tokens_hash (refresh_token_hash),
  INDEX idx_refresh_tokens_account (account_id),
  INDEX idx_refresh_tokens_expires (expires_at),
  CONSTRAINT fk_refresh_tokens_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. character_classes (static content — seeded)
CREATE TABLE character_classes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(50) NOT NULL,
  display_name VARCHAR(50) NOT NULL,
  animal VARCHAR(20) NOT NULL,
  `role` VARCHAR(50) NOT NULL,
  primary_resource VARCHAR(20) NOT NULL,
  resource_max INT UNSIGNED NOT NULL DEFAULT 100,
  resource_regen_per_sec DECIMAL(5,1) NOT NULL DEFAULT 5.0,
  base_stats JSON NOT NULL COMMENT 'JSON: hp, attack, defense, speed, crit_chance, crit_multiplier',
  description TEXT DEFAULT NULL,
  UNIQUE INDEX idx_character_classes_key (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. characters
CREATE TABLE characters (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(50) NOT NULL,
  appearance JSON NOT NULL COMMENT 'JSON: body/eye color, accessories',
  zone_id VARCHAR(50) NOT NULL DEFAULT 'zone-post-office',
  pos_x INT UNSIGNED NOT NULL DEFAULT 15,
  pos_y INT UNSIGNED NOT NULL DEFAULT 14,
  level INT UNSIGNED NOT NULL DEFAULT 1,
  experience BIGINT UNSIGNED NOT NULL DEFAULT 0,
  stamps BIGINT UNSIGNED NOT NULL DEFAULT 0,
  hp INT UNSIGNED NOT NULL DEFAULT 100,
  max_hp INT UNSIGNED NOT NULL DEFAULT 100,
  resource_current INT UNSIGNED NOT NULL DEFAULT 100,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_characters_account_name (account_id, name),
  INDEX idx_characters_account (account_id),
  INDEX idx_characters_zone (zone_id),
  CONSTRAINT fk_characters_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_characters_class FOREIGN KEY (class_id) REFERENCES character_classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. character_stats (derived stats — 1:1 with characters)
CREATE TABLE character_stats (
  character_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  attack INT UNSIGNED NOT NULL DEFAULT 10,
  defense INT UNSIGNED NOT NULL DEFAULT 5,
  speed DECIMAL(6,1) NOT NULL DEFAULT 180.0,
  crit_chance DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  crit_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.50,
  stamina_max INT UNSIGNED DEFAULT NULL,
  stamina_regen DECIMAL(5,1) DEFAULT NULL,
  mana_max INT UNSIGNED DEFAULT NULL,
  mana_regen DECIMAL(5,1) DEFAULT NULL,
  focus_max INT UNSIGNED DEFAULT NULL,
  focus_regen DECIMAL(5,1) DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_character_stats_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. inventories (1:1 with characters)
CREATE TABLE inventories (
  character_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  slot_count INT UNSIGNED NOT NULL DEFAULT 12,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventories_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. item_definitions (static content — seeded)
CREATE TABLE item_definitions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT DEFAULT NULL,
  category VARCHAR(50) NOT NULL COMMENT 'resource/gear/delivery/quest/cosmetic/material',
  max_stack INT UNSIGNED NOT NULL DEFAULT 1,
  icon VARCHAR(100) DEFAULT NULL,
  base_stats JSON DEFAULT NULL COMMENT 'for gear: JSON of stat bonuses',
  rarity VARCHAR(20) DEFAULT 'common' COMMENT 'common/uncommon/rare',
  value BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Stamps sell price',
  UNIQUE INDEX idx_item_definitions_key (`key`),
  INDEX idx_item_definitions_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. inventory_items
CREATE TABLE inventory_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  item_definition_id BIGINT UNSIGNED NOT NULL,
  slot INT UNSIGNED DEFAULT NULL COMMENT 'NULL = unassigned',
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  stack_meta JSON DEFAULT NULL COMMENT 'durability, upgrade level, etc.',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inventory_items_character (character_id),
  INDEX idx_inventory_items_character_slot (character_id, slot),
  CONSTRAINT fk_inventory_items_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_items_definition FOREIGN KEY (item_definition_id) REFERENCES item_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. equipment (slots: head, body, weapon, accessory)
CREATE TABLE equipment (
  character_id BIGINT UNSIGNED NOT NULL,
  slot VARCHAR(20) NOT NULL COMMENT 'head/body/weapon/accessory',
  item_instance_id BIGINT UNSIGNED NOT NULL,
  equipped_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (character_id, slot),
  UNIQUE INDEX idx_equipment_instance (item_instance_id),
  CONSTRAINT fk_equipment_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT fk_equipment_item FOREIGN KEY (item_instance_id) REFERENCES inventory_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. quest_definitions (static content — seeded)
CREATE TABLE quest_definitions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT DEFAULT NULL,
  `type` VARCHAR(50) NOT NULL COMMENT 'delivery/combat/gathering/chain',
  giver_npc_id VARCHAR(50) DEFAULT NULL,
  delivery_target_npc_id VARCHAR(50) DEFAULT NULL,
  required_item_definition_id BIGINT UNSIGNED DEFAULT NULL,
  required_quantity INT UNSIGNED DEFAULT 1,
  stamp_reward BIGINT UNSIGNED NOT NULL DEFAULT 0,
  xp_reward BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reputation_reward_npc_id VARCHAR(50) DEFAULT NULL,
  reputation_reward_points INT UNSIGNED DEFAULT 0,
  next_quest_id BIGINT UNSIGNED DEFAULT NULL,
  chain_position INT UNSIGNED DEFAULT 0,
  min_level INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE INDEX idx_quest_definitions_key (`key`),
  INDEX idx_quest_definitions_next (next_quest_id),
  CONSTRAINT fk_quest_definitions_next FOREIGN KEY (next_quest_id) REFERENCES quest_definitions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. quest_prerequisites
CREATE TABLE quest_prerequisites (
  quest_id BIGINT UNSIGNED NOT NULL,
  prerequisite_kind VARCHAR(20) NOT NULL COMMENT 'quest/reputation/item',
  prerequisite_id VARCHAR(100) NOT NULL COMMENT 'quest key, npc key, or item key',
  min_value INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (quest_id, prerequisite_kind, prerequisite_id),
  INDEX idx_quest_prerequisites_quest (quest_id),
  CONSTRAINT fk_quest_prerequisites_quest FOREIGN KEY (quest_id) REFERENCES quest_definitions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. character_quests
CREATE TABLE character_quests (
  character_id BIGINT UNSIGNED NOT NULL,
  quest_id BIGINT UNSIGNED NOT NULL,
  state ENUM('locked', 'available', 'active', 'completed') NOT NULL DEFAULT 'locked',
  progress JSON DEFAULT NULL,
  delivered_item_id BIGINT UNSIGNED DEFAULT NULL,
  accepted_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  PRIMARY KEY (character_id, quest_id),
  INDEX idx_character_quests_state (character_id, state),
  CONSTRAINT fk_character_quests_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT fk_character_quests_quest FOREIGN KEY (quest_id) REFERENCES quest_definitions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. friendships (reputation)
CREATE TABLE friendships (
  character_id BIGINT UNSIGNED NOT NULL,
  npc_id VARCHAR(50) NOT NULL,
  level TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0-4',
  points INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'runtime progress toward next level',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (character_id, npc_id),
  CONSTRAINT fk_friendships_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. zones (static content — seeded)
CREATE TABLE zones (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(50) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  kind VARCHAR(20) NOT NULL COMMENT 'village/outdoor/dungeon',
  map_data_id VARCHAR(50) DEFAULT NULL,
  width_tiles INT UNSIGNED NOT NULL,
  height_tiles INT UNSIGNED NOT NULL,
  default_spawn_x INT UNSIGNED NOT NULL,
  default_spawn_y INT UNSIGNED NOT NULL,
  max_players INT UNSIGNED NOT NULL DEFAULT 32,
  is_safe TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = no monsters',
  UNIQUE INDEX idx_zones_key (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. dungeon_runs
CREATE TABLE dungeon_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  zone_id BIGINT UNSIGNED NOT NULL,
  owner_character_id BIGINT UNSIGNED NOT NULL,
  party_id BIGINT UNSIGNED DEFAULT NULL,
  state ENUM('created', 'active', 'completed', 'failed', 'destroyed') NOT NULL DEFAULT 'created',
  run_meta JSON DEFAULT NULL COMMENT 'cleared encounters, boss state',
  entered_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  INDEX idx_dungeon_runs_zone (zone_id, state),
  INDEX idx_dungeon_runs_owner (owner_character_id),
  CONSTRAINT fk_dungeon_runs_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE,
  CONSTRAINT fk_dungeon_runs_owner FOREIGN KEY (owner_character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. monster_definitions (static content — seeded)
CREATE TABLE monster_definitions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(100) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  zone_id BIGINT UNSIGNED NOT NULL,
  family_id VARCHAR(50) DEFAULT NULL,
  level_min INT UNSIGNED NOT NULL DEFAULT 1,
  level_max INT UNSIGNED NOT NULL DEFAULT 1,
  max_hp INT UNSIGNED NOT NULL DEFAULT 50,
  attack INT UNSIGNED NOT NULL DEFAULT 5,
  defense INT UNSIGNED NOT NULL DEFAULT 3,
  speed DECIMAL(6,1) NOT NULL DEFAULT 100.0,
  aggro_behavior VARCHAR(20) NOT NULL DEFAULT 'passive' COMMENT 'passive/aggro-range/patrol',
  attack_behavior VARCHAR(20) NOT NULL DEFAULT 'melee' COMMENT 'melee/ranged/spit',
  loot_table JSON DEFAULT NULL,
  respawn_seconds INT UNSIGNED NOT NULL DEFAULT 30,
  experience_reward INT UNSIGNED NOT NULL DEFAULT 10,
  UNIQUE INDEX idx_monster_definitions_key (`key`),
  INDEX idx_monster_definitions_zone (zone_id),
  CONSTRAINT fk_monster_definitions_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 17. audit_economy_events (append-only ledger)
CREATE TABLE audit_economy_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED DEFAULT NULL,
  event_type VARCHAR(50) NOT NULL COMMENT 'stamp_grant/stamp_spend/item_grant/item_remove/loot/quest_reward/craft/equip',
  item_definition_id BIGINT UNSIGNED DEFAULT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 0,
  balance_after BIGINT UNSIGNED DEFAULT NULL,
  reason VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_character (character_id, created_at),
  INDEX idx_audit_event_type (event_type),
  CONSTRAINT fk_audit_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_item FOREIGN KEY (item_definition_id) REFERENCES item_definitions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;