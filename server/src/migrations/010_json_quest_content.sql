-- JSON-authoritative quest content.
-- The legacy quest_definitions/character_quests tables remain in the schema
-- for backward-compatible migrations, but gameplay now reads definitions from
-- src/data/quests.json and writes only character progress here.

CREATE TABLE character_quest_progress (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_key VARCHAR(100) NOT NULL,
  state TEXT NOT NULL DEFAULT 'locked',
  progress TEXT,
  delivered_item_id INTEGER,
  accepted_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (character_id, quest_key)
);
CREATE INDEX idx_character_quest_progress_state ON character_quest_progress(character_id, state);

-- Preserve progress created by the original SQL-seeded tutorial. The JSON
-- definitions intentionally retain these stable quest ids.
INSERT OR IGNORE INTO character_quest_progress
  (character_id, quest_key, state, progress, delivered_item_id, accepted_at, completed_at)
SELECT cq.character_id, q.key, cq.state, cq.progress, cq.delivered_item_id,
       cq.accepted_at, cq.completed_at
  FROM character_quests cq
  JOIN quest_definitions q ON q.id = cq.quest_id;

-- Remove the materialized legacy content after progress has been copied. The
-- old tables are retained only because they are part of the existing schema.
DELETE FROM character_quests;
DELETE FROM quest_prerequisites;
DELETE FROM quest_definitions;
