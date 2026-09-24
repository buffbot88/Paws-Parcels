-- createCharacter read snake_case crit keys while src/data/classes.json authors
-- critChance/critMultiplier, so every character got the 5 / 1.5 fallback.
-- Restore each class's authored crit stats; rows no longer at the fallback
-- (admin-edited) are left alone.

UPDATE character_stats SET crit_chance = 2, crit_multiplier = 1.5
 WHERE crit_chance = 5 AND crit_multiplier = 1.5
   AND character_id IN (SELECT c.id FROM characters c JOIN character_classes cc ON cc.id = c.class_id WHERE cc.`key` = 'bear-warrior');

UPDATE character_stats SET crit_chance = 5, crit_multiplier = 2.0
 WHERE crit_chance = 5 AND crit_multiplier = 1.5
   AND character_id IN (SELECT c.id FROM characters c JOIN character_classes cc ON cc.id = c.class_id WHERE cc.`key` = 'cat-mage');

UPDATE character_stats SET crit_chance = 10, crit_multiplier = 1.8
 WHERE crit_chance = 5 AND crit_multiplier = 1.5
   AND character_id IN (SELECT c.id FROM characters c JOIN character_classes cc ON cc.id = c.class_id WHERE cc.`key` = 'fox-archer');
