-- Seed: zones (MVP — Clover Village hub + Happy Valley outdoor)
INSERT OR IGNORE INTO zones (`key`, display_name, kind, map_data_id, width_tiles, height_tiles, default_spawn_x, default_spawn_y, max_players, is_safe)
VALUES ('zone-clover-village', 'Clover Village', 'village', 'clover-village', 30, 20, 15, 13, 32, 1),
       ('zone-happy-valley', 'Happy Valley', 'outdoor', 'happy-valley', 40, 26, 20, 1, 32, 0);
