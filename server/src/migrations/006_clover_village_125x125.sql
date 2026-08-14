-- Clover Village was resized from 200x200 to 125x125 (generator:
-- scripts/generate-clover-village.py). Update the zone metadata + default
-- spawn so new characters and defeated couriers land on the new plaza, and
-- snap ALL village characters back to the plaza: the resize shrank the map
-- by ~60%, so saved spots are either out of bounds, inside trees, or stranded
-- deep in the new forest — a blanket snap is simpler and safer than guessing
-- which old spots still make sense.
UPDATE zones
SET width_tiles = 125,
    height_tiles = 125,
    default_spawn_x = 62,
    default_spawn_y = 65
WHERE `key` = 'zone-clover-village';

UPDATE characters
SET pos_x = 62,
    pos_y = 65
WHERE zone_id = 'zone-clover-village';
