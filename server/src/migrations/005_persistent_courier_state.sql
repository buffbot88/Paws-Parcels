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

-- Skill definitions are authored in src/data/skills.json and synchronized by
-- server/src/content/staticContent.ts. Existing character_skills rows remain
-- player-owned state and are preserved.