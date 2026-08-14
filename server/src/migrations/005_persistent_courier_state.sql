-- Phase 5 — server-authoritative courier selection and skill progress.
-- Existing accounts keep their current data; the nullable selection is filled
-- whenever a courier starts or switches in the game.
ALTER TABLE accounts ADD COLUMN last_played_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL;

ALTER TABLE characters ADD COLUMN skill_points INTEGER NOT NULL DEFAULT 1;

CREATE TABLE skill_definitions (
  skill_key VARCHAR(100) PRIMARY KEY,
  class_key VARCHAR(50) NOT NULL REFERENCES character_classes(`key`),
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 1,
  required_level INTEGER NOT NULL DEFAULT 1,
  prerequisite_key VARCHAR(100) REFERENCES skill_definitions(skill_key)
);

CREATE TABLE character_skills (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill_key VARCHAR(100) NOT NULL REFERENCES skill_definitions(skill_key),
  unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (character_id, skill_key)
);

INSERT OR IGNORE INTO skill_definitions
  (skill_key, class_key, name, description, cost, required_level, prerequisite_key)
VALUES
  ('bear-iron-hide', 'bear-warrior', 'Iron Hide', 'Brace yourself and reduce incoming harm.', 1, 1, NULL),
  ('bear-ground-pound', 'bear-warrior', 'Ground Pound', 'A heavy shockwave that disrupts nearby foes.', 1, 2, 'bear-iron-hide'),
  ('bear-guardian-roar', 'bear-warrior', 'Guardian Roar', 'Protect nearby couriers with a rallying roar.', 2, 4, 'bear-ground-pound'),
  ('cat-arcane-focus', 'cat-mage', 'Arcane Focus', 'Gather power to make magical attacks more reliable.', 1, 1, NULL),
  ('cat-starfall', 'cat-mage', 'Starfall', 'Call a bright burst down on a distant target.', 1, 2, 'cat-arcane-focus'),
  ('cat-mana-veil', 'cat-mage', 'Mana Veil', 'Wrap yourself in a shimmering defensive ward.', 2, 4, 'cat-starfall'),
  ('fox-quick-shot', 'fox-archer', 'Quick Shot', 'Loose a fast, precise parcel-arrow.', 1, 1, NULL),
  ('fox-trick-step', 'fox-archer', 'Trick Step', 'Slip nimbly out of danger.', 1, 2, 'fox-quick-shot'),
  ('fox-keen-eye', 'fox-archer', 'Keen Eye', 'Improve critical hit consistency.', 2, 4, 'fox-trick-step');

-- Existing characters receive the default value from ALTER TABLE; new
-- characters inherit the same default through the column definition.
