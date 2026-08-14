-- Clover Village was compacted from 125x125 to 75x75.
-- Existing saved positions may be outside the new bounds or inside the
-- regenerated forest, so reset village couriers to the new plaza.
UPDATE zones
SET width_tiles = 75,
    height_tiles = 75,
    default_spawn_x = 37,
    default_spawn_y = 38
WHERE `key` = 'zone-clover-village';

UPDATE characters
SET pos_x = 37,
    pos_y = 38
WHERE zone_id = 'zone-clover-village';
