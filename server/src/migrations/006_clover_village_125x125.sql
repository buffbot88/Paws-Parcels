-- Historical map resize compatibility: move existing village couriers to the
-- safe plaza. Zone metadata itself is authored in src/data/zones.json.
UPDATE characters
SET pos_x = 62,
    pos_y = 65
WHERE zone_id = 'zone-clover-village';
