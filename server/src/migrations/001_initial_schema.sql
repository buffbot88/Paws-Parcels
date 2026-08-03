-- Paws & Parcels — Initial Schema (SQLite)
-- Conventions: snake_case, INTEGER PRIMARY KEY AUTOINCREMENT, TEXT for JSON/enum.
-- SQLite has no ENGINE/CHARSET/COMMENT/ON UPDATE clauses — those are dropped.
-- ENUM columns are TEXT; JSON columns are TEXT (the server stringifies/parses).

-- 1. accounts (identity linked to ASHAT Hub OIDC — no local password required)
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email VARCHAR(255) UNIQUE,
  username VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100),
  `role` VARCHAR(50) NOT NULL DEFAULT 'Member',
  ashat_user_id VARCHAR(64) UNIQUE,
  password_hash VARCHAR(255),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

-- 2. refresh_tokens (sessions)
CREATE TABLE refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  user_agent VARCHAR(500),
  ip VARCHAR(45)
);
CREATE INDEX idx_refresh_tokens_account ON refresh_tokens(account_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- 3. character_classes (static content — seeded)
CREATE TABLE character_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  `key` VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(50) NOT NULL,
  animal VARCHAR(20) NOT NULL,
  `role` VARCHAR(50) NOT NULL,
  primary_resource VARCHAR(20) NOT NULL,
  resource_max INTEGER NOT NULL DEFAULT 100,
  resource_regen_per_sec REAL NOT NULL DEFAULT 5.0,
  base_stats TEXT NOT NULL,
  description TEXT
);

-- 4. characters
CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES character_classes(id),
  name VARCHAR(50) NOT NULL,
  appearance TEXT NOT NULL,
  zone_id VARCHAR(50) NOT NULL DEFAULT 'zone-clover-village',
  pos_x INTEGER NOT NULL DEFAULT 15,
  pos_y INTEGER NOT NULL DEFAULT 13,
  level INTEGER NOT NULL DEFAULT 1,
  experience INTEGER NOT NULL DEFAULT 0,
  stamps INTEGER NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL DEFAULT 100,
  max_hp INTEGER NOT NULL DEFAULT 100,
  resource_current INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (account_id, name)
);
CREATE INDEX idx_characters_account ON characters(account_id);
CREATE INDEX idx_characters_zone ON characters(zone_id);

-- 5. character_stats (derived stats — 1:1 with characters)
CREATE TABLE character_stats (
  character_id INTEGER NOT NULL PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  attack INTEGER NOT NULL DEFAULT 10,
  defense INTEGER NOT NULL DEFAULT 5,
  speed REAL NOT NULL DEFAULT 180.0,
  crit_chance REAL NOT NULL DEFAULT 5.00,
  crit_multiplier REAL NOT NULL DEFAULT 1.50,
  stamina_max INTEGER,
  stamina_regen REAL,
  mana_max INTEGER,
  mana_regen REAL,
  focus_max INTEGER,
  focus_regen REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. inventories (1:1 with characters)
CREATE TABLE inventories (
  character_id INTEGER NOT NULL PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  slot_count INTEGER NOT NULL DEFAULT 12,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. item_definitions (static content — seeded later)
CREATE TABLE item_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  `key` VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  max_stack INTEGER NOT NULL DEFAULT 1,
  icon VARCHAR(100),
  base_stats TEXT,
  rarity VARCHAR(20) NOT NULL DEFAULT 'common',
  value INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_item_definitions_category ON item_definitions(category);

-- 8. inventory_items
CREATE TABLE inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_definition_id INTEGER NOT NULL REFERENCES item_definitions(id),
  slot INTEGER,
  quantity INTEGER NOT NULL DEFAULT 1,
  stack_meta TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_inventory_items_character ON inventory_items(character_id);
CREATE INDEX idx_inventory_items_character_slot ON inventory_items(character_id, slot);

-- 9. equipment (slots: head, body, weapon, accessory)
CREATE TABLE equipment (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot VARCHAR(20) NOT NULL,
  item_instance_id INTEGER NOT NULL UNIQUE REFERENCES inventory_items(id) ON DELETE CASCADE,
  equipped_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (character_id, slot)
);

-- 10. quest_definitions (static content — seeded later)
CREATE TABLE quest_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  `key` VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  `type` VARCHAR(50) NOT NULL,
  giver_npc_id VARCHAR(50),
  delivery_target_npc_id VARCHAR(50),
  required_item_definition_id INTEGER REFERENCES item_definitions(id),
  required_quantity INTEGER NOT NULL DEFAULT 1,
  stamp_reward INTEGER NOT NULL DEFAULT 0,
  xp_reward INTEGER NOT NULL DEFAULT 0,
  reputation_reward_npc_id VARCHAR(50),
  reputation_reward_points INTEGER NOT NULL DEFAULT 0,
  next_quest_id INTEGER REFERENCES quest_definitions(id) ON DELETE SET NULL,
  chain_position INTEGER NOT NULL DEFAULT 0,
  min_level INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_quest_definitions_next ON quest_definitions(next_quest_id);

-- 11. quest_prerequisites
CREATE TABLE quest_prerequisites (
  quest_id INTEGER NOT NULL REFERENCES quest_definitions(id) ON DELETE CASCADE,
  prerequisite_kind VARCHAR(20) NOT NULL,
  prerequisite_id VARCHAR(100) NOT NULL,
  min_value INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (quest_id, prerequisite_kind, prerequisite_id)
);
CREATE INDEX idx_quest_prerequisites_quest ON quest_prerequisites(quest_id);

-- 12. character_quests
CREATE TABLE character_quests (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_id INTEGER NOT NULL REFERENCES quest_definitions(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'locked',
  progress TEXT,
  delivered_item_id INTEGER,
  accepted_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (character_id, quest_id)
);
CREATE INDEX idx_character_quests_state ON character_quests(character_id, state);

-- 13. friendships (reputation)
CREATE TABLE friendships (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  npc_id VARCHAR(50) NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (character_id, npc_id)
);

-- 14. zones (static content — seeded)
CREATE TABLE zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  `key` VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  map_data_id VARCHAR(50),
  width_tiles INTEGER NOT NULL,
  height_tiles INTEGER NOT NULL,
  default_spawn_x INTEGER NOT NULL,
  default_spawn_y INTEGER NOT NULL,
  max_players INTEGER NOT NULL DEFAULT 32,
  is_safe INTEGER NOT NULL DEFAULT 0
);

-- 15. dungeon_runs
CREATE TABLE dungeon_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  owner_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  party_id INTEGER,
  state TEXT NOT NULL DEFAULT 'created',
  run_meta TEXT,
  entered_at TEXT,
  completed_at TEXT
);
CREATE INDEX idx_dungeon_runs_zone ON dungeon_runs(zone_id, state);
CREATE INDEX idx_dungeon_runs_owner ON dungeon_runs(owner_character_id);

-- 16. monster_definitions (static content — seeded later)
CREATE TABLE monster_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  `key` VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  family_id VARCHAR(50),
  level_min INTEGER NOT NULL DEFAULT 1,
  level_max INTEGER NOT NULL DEFAULT 1,
  max_hp INTEGER NOT NULL DEFAULT 50,
  attack INTEGER NOT NULL DEFAULT 5,
  defense INTEGER NOT NULL DEFAULT 3,
  speed REAL NOT NULL DEFAULT 100.0,
  aggro_behavior TEXT NOT NULL DEFAULT 'passive',
  attack_behavior TEXT NOT NULL DEFAULT 'melee',
  loot_table TEXT,
  respawn_seconds INTEGER NOT NULL DEFAULT 30,
  experience_reward INTEGER NOT NULL DEFAULT 10
);
CREATE INDEX idx_monster_definitions_zone ON monster_definitions(zone_id);

-- 17. audit_economy_events (append-only ledger)
CREATE TABLE audit_economy_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  item_definition_id INTEGER REFERENCES item_definitions(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  balance_after INTEGER,
  reason VARCHAR(500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_character ON audit_economy_events(character_id, created_at);
CREATE INDEX idx_audit_event_type ON audit_economy_events(event_type);
