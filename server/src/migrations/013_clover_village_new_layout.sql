-- Historical map replacement compatibility: the old Clover Village layout is
-- fully retired; every existing village courier wakes up at the NEW plaza
-- spawn (Courier Square). The join-time walkability check snaps any position
-- the new map leaves unreachable; this migration guarantees a clean reset.
UPDATE characters
SET pos_x = 37,
    pos_y = 31
WHERE zone_id = 'zone-clover-village';
