-- Phase 5 — equipment metadata is authored in src/data/items.json.
-- These columns extend the runtime item lookup cache; player ownership stays
-- in inventory_items/equipment and all mutations are audited.
ALTER TABLE item_definitions ADD COLUMN equipment_slot VARCHAR(20);
ALTER TABLE item_definitions ADD COLUMN equipment_stats TEXT;
ALTER TABLE item_definitions ADD COLUMN courier_effects TEXT;
ALTER TABLE item_definitions ADD COLUMN required_class VARCHAR(50);
ALTER TABLE item_definitions ADD COLUMN required_level INTEGER NOT NULL DEFAULT 1;
