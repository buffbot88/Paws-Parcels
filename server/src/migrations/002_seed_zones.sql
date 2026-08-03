-- Seed: zones (MVP)
INSERT INTO zones (`key`, display_name, kind, map_data_id, width_tiles, height_tiles, default_spawn_x, default_spawn_y, max_players, is_safe) VALUES
('zone-post-office', 'Clover Post Office', 'village', 'post-office', 30, 20, 15, 14, 32, 1),
('zone-bramble-patch', 'Bramble Patch', 'outdoor', 'bramble-patch', 40, 26, 19, 1, 32, 0)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);