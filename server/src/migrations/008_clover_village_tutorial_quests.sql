-- Phase 4A — Clover Village tutorial chain.
-- The tutorial stays entirely inside the safe hub. Happy Valley quests remain
-- separate follow-up content.

INSERT OR IGNORE INTO item_definitions (`key`, name, description, category, max_stack, icon, rarity, value) VALUES
  ('item-village-welcome-card', 'Welcome Card', 'A little card welcoming a new courier to Clover Village.', 'delivery', 1, 'delivery-letter', 'common', 2),
  ('item-tiny-parcel', 'Tiny Parcel', 'A small package wrapped in brown paper and string.', 'delivery', 1, 'delivery-parcel', 'common', 3),
  ('item-sealed-letter', 'Sealed Letter', 'A letter sealed with a wax paw print. Deliver it carefully.', 'delivery', 1, 'delivery-letter', 'common', 3);

INSERT OR IGNORE INTO quest_definitions
  (`key`, title, description, `type`, giver_npc_id, delivery_target_npc_id,
   required_item_definition_id, required_quantity, stamp_reward, xp_reward,
   reputation_reward_npc_id, reputation_reward_points, chain_position, min_level)
SELECT 'quest-village-welcome', 'Welcome to Clover Village',
       'Take Pip''s welcome card to Biscuit at the café.', 'delivery', 'npc-pip', 'npc-biscuit',
       (SELECT id FROM item_definitions WHERE `key` = 'item-village-welcome-card'), 1, 5, 15,
       'npc-biscuit', 1, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM quest_definitions WHERE `key` = 'quest-village-welcome');

INSERT OR IGNORE INTO quest_definitions
  (`key`, title, description, `type`, giver_npc_id, delivery_target_npc_id,
   required_item_definition_id, required_quantity, stamp_reward, xp_reward,
   reputation_reward_npc_id, reputation_reward_points, chain_position, min_level)
SELECT 'quest-fresh-bread-biscuit', 'Fresh Bread for Biscuit',
       'Carry a fresh bread parcel from Pip to Biscuit.', 'delivery', 'npc-pip', 'npc-biscuit',
       (SELECT id FROM item_definitions WHERE `key` = 'item-tiny-parcel'), 1, 8, 20,
       'npc-biscuit', 1, 2, 1
WHERE NOT EXISTS (SELECT 1 FROM quest_definitions WHERE `key` = 'quest-fresh-bread-biscuit');

INSERT OR IGNORE INTO quest_definitions
  (`key`, title, description, `type`, giver_npc_id, delivery_target_npc_id,
   required_item_definition_id, required_quantity, stamp_reward, xp_reward,
   reputation_reward_npc_id, reputation_reward_points, chain_position, min_level)
SELECT 'quest-flower-note-maple', 'A Flower Note for Maple',
       'Deliver Biscuit''s flower note to Maple in the flower field.', 'delivery', 'npc-biscuit', 'npc-maple',
       (SELECT id FROM item_definitions WHERE `key` = 'item-sealed-letter'), 1, 10, 25,
       'npc-maple', 1, 3, 1
WHERE NOT EXISTS (SELECT 1 FROM quest_definitions WHERE `key` = 'quest-flower-note-maple');

INSERT OR IGNORE INTO quest_definitions
  (`key`, title, description, `type`, giver_npc_id, delivery_target_npc_id,
   required_item_definition_id, required_quantity, stamp_reward, xp_reward,
   reputation_reward_npc_id, reputation_reward_points, chain_position, min_level)
SELECT 'quest-moon-note-lumi', 'A Moon Note for Lumi',
       'Carry Maple''s moon note to Lumi at the research garden.', 'delivery', 'npc-maple', 'npc-lumi',
       (SELECT id FROM item_definitions WHERE `key` = 'item-sealed-letter'), 1, 12, 30,
       'npc-lumi', 1, 4, 1
WHERE NOT EXISTS (SELECT 1 FROM quest_definitions WHERE `key` = 'quest-moon-note-lumi');

INSERT OR IGNORE INTO quest_definitions
  (`key`, title, description, `type`, giver_npc_id, delivery_target_npc_id,
   required_item_definition_id, required_quantity, stamp_reward, xp_reward,
   reputation_reward_npc_id, reputation_reward_points, chain_position, min_level)
SELECT 'quest-garden-greeting-moss', 'A Garden Greeting for Moss',
       'Deliver Lumi''s garden greeting to Moss by the burrows.', 'delivery', 'npc-lumi', 'npc-moss',
       (SELECT id FROM item_definitions WHERE `key` = 'item-tiny-parcel'), 1, 15, 40,
       'npc-moss', 1, 5, 1
WHERE NOT EXISTS (SELECT 1 FROM quest_definitions WHERE `key` = 'quest-garden-greeting-moss');

UPDATE quest_definitions SET next_quest_id = (SELECT id FROM quest_definitions WHERE `key` = 'quest-fresh-bread-biscuit') WHERE `key` = 'quest-village-welcome';
UPDATE quest_definitions SET next_quest_id = (SELECT id FROM quest_definitions WHERE `key` = 'quest-flower-note-maple') WHERE `key` = 'quest-fresh-bread-biscuit';
UPDATE quest_definitions SET next_quest_id = (SELECT id FROM quest_definitions WHERE `key` = 'quest-moon-note-lumi') WHERE `key` = 'quest-flower-note-maple';
UPDATE quest_definitions SET next_quest_id = (SELECT id FROM quest_definitions WHERE `key` = 'quest-garden-greeting-moss') WHERE `key` = 'quest-moon-note-lumi';

INSERT OR IGNORE INTO quest_prerequisites (quest_id, prerequisite_kind, prerequisite_id, min_value)
SELECT next.id, 'quest', CAST(current.id AS TEXT), 1
FROM quest_definitions current
JOIN quest_definitions next ON next.id = current.next_quest_id
WHERE current.`key` IN ('quest-village-welcome', 'quest-fresh-bread-biscuit', 'quest-flower-note-maple', 'quest-moon-note-lumi');
