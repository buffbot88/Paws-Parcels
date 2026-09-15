-- Roles & Permissions (spec §70–71): editable role catalog with a per-role
-- permission matrix. Hub roles map to tiers for baseline access; this layer
-- grants/denies specific panel capabilities per role and can raise a role's
-- tier. Tiers are never lowered below the Hub-derived mapping.

CREATE TABLE admin_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_key VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  min_tier VARCHAR(20) NOT NULL DEFAULT 'support',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_role_permissions (
  role_key VARCHAR(50) NOT NULL REFERENCES admin_roles(role_key) ON DELETE CASCADE,
  permission VARCHAR(60) NOT NULL,
  PRIMARY KEY (role_key, permission)
);

CREATE TABLE admin_role_assignments (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role_key VARCHAR(50) NOT NULL REFERENCES admin_roles(role_key) ON DELETE CASCADE,
  assigned_by VARCHAR(100) NOT NULL DEFAULT '',
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, role_key)
);

-- Spec §70 default roles. Permissions seeded below (spec §71 matrix).
INSERT INTO admin_roles (role_key, display_name, description, min_tier, is_system) VALUES
  ('developer', 'Developer', 'Full access to every panel capability.', 'developer', 1),
  ('administrator', 'Administrator', 'Game management with limited server settings.', 'admin', 1),
  ('game-master', 'Game Master', 'Player moderation and support.', 'moderator', 1),
  ('content-designer', 'Content Designer', 'Items, NPCs, quests, drops.', 'support', 1),
  ('liveops', 'LiveOps', 'Market, seasons, events, server rates.', 'support', 1),
  ('support', 'Support', 'Player and inventory tools only.', 'support', 1);

INSERT INTO admin_role_permissions (role_key, permission) VALUES
  ('developer', 'view_players'), ('developer', 'ban_player'), ('developer', 'edit_inventory'),
  ('developer', 'edit_quests'), ('developer', 'publish_quests'), ('developer', 'server_settings'),
  ('developer', 'manage_roles'),
  ('administrator', 'view_players'), ('administrator', 'ban_player'), ('administrator', 'edit_inventory'),
  ('administrator', 'edit_quests'), ('administrator', 'publish_quests'), ('administrator', 'server_settings_limited'),
  ('game-master', 'view_players'), ('game-master', 'ban_player'), ('game-master', 'edit_inventory'),
  ('content-designer', 'edit_quests'), ('content-designer', 'publish_quests_limited'),
  ('liveops', 'server_settings_limited'), ('liveops', 'edit_market'),
  ('support', 'view_players'), ('support', 'edit_inventory');
