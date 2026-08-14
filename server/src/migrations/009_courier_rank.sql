-- Progression state only. Tutorial quest and parcel definitions live in
-- src/data/quests.json; SQLite stores the player's earned rank.
ALTER TABLE characters ADD COLUMN courier_rank VARCHAR(50) NOT NULL DEFAULT 'Trainee';
