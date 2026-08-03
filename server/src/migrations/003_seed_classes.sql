-- Seed: character_classes (Bear Warrior, Cat Mage, Fox Archer)
INSERT INTO character_classes (`key`, display_name, animal, `role`, primary_resource, resource_max, resource_regen_per_sec, base_stats, description) VALUES
('bear-warrior', 'Bear Warrior', 'bear', 'Melee Tank / Damage', 'stamina', 100, 5.0,
  '{"hp": 120, "attack": 10, "defense": 8, "speed": 150, "crit_chance": 2, "crit_multiplier": 1.5}',
  'A sturdy melee fighter who soaks up damage and protects allies.'),
('cat-mage', 'Cat Mage', 'cat', 'Ranged Magic Burst', 'mana', 120, 10.0,
  '{"hp": 70, "attack": 14, "defense": 4, "speed": 170, "crit_chance": 5, "crit_multiplier": 2.0}',
  'A nimble spellcaster who unleashes powerful arcane bursts from a distance.'),
('fox-archer', 'Fox Archer', 'fox', 'Ranged Sustained DPS', 'focus', 100, 8.0,
  '{"hp": 85, "attack": 11, "defense": 5, "speed": 190, "crit_chance": 10, "crit_multiplier": 1.8}',
  'A quick-witted ranged fighter who delivers steady damage from afar.')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);