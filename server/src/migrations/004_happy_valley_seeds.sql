-- Phase 3 — Happy Valley outdoor zone + monster family + loot items.
-- 002 seeded the hub only; the committed DB already applied it, so this
-- migration adds the Happy Valley content for existing installs (idempotent).

-- Zone row (INSERT OR IGNORE — safe for fresh installs that ran the updated 002).
INSERT OR IGNORE INTO zones (`key`, display_name, kind, map_data_id, width_tiles, height_tiles, default_spawn_x, default_spawn_y, max_players, is_safe)
VALUES ('zone-happy-valley', 'Happy Valley', 'outdoor', 'happy-valley', 40, 26, 20, 1, 32, 0);

-- Loot item definitions (design/monsters.md §2 loot table).
INSERT OR IGNORE INTO item_definitions (`key`, name, description, category, max_stack, icon, base_stats, rarity, value) VALUES
('item-boar-hide', 'Boar Hide', 'A tough hide from a Wild Boar — good for leathercraft.', 'material', 20, 'material-hide', NULL, 'common', 5),
('item-boar-tusk', 'Boar Tusk', 'A chipped tusk. Sturdy enough for a blade.', 'material', 20, 'material-tusk', NULL, 'common', 8),
('item-fox-pelt', 'Fox Pelt', 'A soft, warm pelt with a reddish sheen.', 'material', 20, 'material-pelt', NULL, 'common', 6),
('item-sharp-claw', 'Sharp Claw', 'A curved claw from a Valley Fox.', 'material', 20, 'material-claw', NULL, 'common', 7),
('item-hare-fur', 'Hare Fur', 'Fluffy white fur from a Meadow Hare.', 'material', 20, 'material-fur', NULL, 'common', 4),
('item-lucky-foot', 'Lucky Foot', 'A tiny hare foot. Legend says it brings good luck.', 'material', 5, 'material-foot', NULL, 'uncommon', 12),
('item-deer-antler', 'Deer Antler', 'A smooth antler shed by a Forest Deer.', 'material', 10, 'material-antler', NULL, 'uncommon', 10),
('item-deer-hide', 'Deer Hide', 'A supple hide from a Forest Deer.', 'material', 20, 'material-hide', NULL, 'common', 6),
('item-grouse-feather', 'Grouse Feather', 'A mottled feather from a Black Grouse.', 'material', 20, 'material-feather', NULL, 'common', 5),
('item-grouse-plume', 'Grouse Plume', 'A iridescent plume — prized by crafters.', 'material', 10, 'material-plume', NULL, 'uncommon', 9);

-- Monster family (design/monsters.md §2). zone_id resolves from the zones table.
INSERT OR IGNORE INTO monster_definitions
  (`key`, display_name, zone_id, family_id, level_min, level_max, max_hp, attack, defense, speed,
   aggro_behavior, attack_behavior, loot_table, respawn_seconds, experience_reward)
SELECT
  m.`key`, m.display_name, z.id, m.family_id, m.level_min, m.level_max, m.max_hp, m.attack, m.defense, m.speed,
  m.aggro_behavior, m.attack_behavior, m.loot_table, m.respawn_seconds, m.experience_reward
FROM (SELECT
        'monster-wild-boar' AS `key`, 'Wild Boar' AS display_name, 'happy-valley' AS family_id,
        2 AS level_min, 3 AS level_max, 55 AS max_hp, 9 AS attack, 6 AS defense, 120.0 AS speed,
        'aggro' AS aggro_behavior, 'melee' AS attack_behavior,
        '[{"key":"item-boar-hide","chance":0.6,"quantity":1},{"key":"item-boar-tusk","chance":0.2,"quantity":1}]' AS loot_table,
        30 AS respawn_seconds, 20 AS experience_reward
      UNION ALL SELECT 'monster-valley-fox', 'Valley Fox', 'happy-valley', 2, 2, 32, 8, 3, 160.0,
        'aggro', 'melee', '[{"key":"item-fox-pelt","chance":0.5,"quantity":1},{"key":"item-sharp-claw","chance":0.3,"quantity":1}]', 35, 15
      UNION ALL SELECT 'monster-meadow-hare', 'Meadow Hare', 'happy-valley', 1, 1, 20, 4, 2, 140.0,
        'passive', 'melee', '[{"key":"item-hare-fur","chance":0.5,"quantity":1},{"key":"item-lucky-foot","chance":0.1,"quantity":1}]', 20, 8
      UNION ALL SELECT 'monster-forest-deer', 'Forest Deer', 'happy-valley', 1, 2, 45, 5, 4, 170.0,
        'passive', 'melee', '[{"key":"item-deer-antler","chance":0.4,"quantity":1},{"key":"item-deer-hide","chance":0.5,"quantity":1}]', 40, 12
      UNION ALL SELECT 'monster-black-grouse', 'Black Grouse', 'happy-valley', 2, 2, 30, 7, 3, 150.0,
        'aggro', 'ranged', '[{"key":"item-grouse-feather","chance":0.6,"quantity":1},{"key":"item-grouse-plume","chance":0.2,"quantity":1}]', 45, 15) m
CROSS JOIN zones z
WHERE z.`key` = 'zone-happy-valley';
