-- Clover Village is now a single 200x200 world map (village district +
-- surrounding forest). Update the zone metadata + default spawn so new
-- characters and defeated couriers land on the plaza.
UPDATE zones
SET width_tiles = 200,
    height_tiles = 200,
    default_spawn_x = 100,
    default_spawn_y = 105
WHERE `key` = 'zone-clover-village';
