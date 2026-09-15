-- Item Database & Item Editor (spec §25–26): admin-authored item content.
-- item_definitions stays the server's runtime catalog (inventory presentation,
-- equipment stats, loot + quest rewards). These columns let an editor change
-- survive the boot-time JSON sync, and make "delete" an archive instead of a
-- row that the next `syncItems()` would resurrect from src/data/items.json.
--
--   source     'content' = authored in items.json, 'admin' = owned by the panel
--   is_deleted archived by the panel (hidden from new grants, kept for history)

ALTER TABLE item_definitions ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'content';
ALTER TABLE item_definitions ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE item_definitions ADD COLUMN updated_at TEXT;
ALTER TABLE item_definitions ADD COLUMN updated_by VARCHAR(100) NOT NULL DEFAULT '';
CREATE INDEX idx_item_definitions_source ON item_definitions(source);

-- Permission for the item editors (spec §71 matrix): content roles only —
-- Support stays player/inventory tools, Game Masters stay moderation.
INSERT OR IGNORE INTO admin_role_permissions (role_key, permission) VALUES
  ('developer', 'edit_items'),
  ('administrator', 'edit_items'),
  ('content-designer', 'edit_items');
