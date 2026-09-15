-- Admin Control Panel (Phase 1 foundation): append-only admin audit trail and
-- a key-value store for runtime server settings (rates, capacity, level cap).
-- Zone enable/disable is authored in src/data/zones.json and synced to the
-- zones table — not stored here.

CREATE TABLE admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  admin_username VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  target_type VARCHAR(50) NOT NULL DEFAULT 'system',
  target_id VARCHAR(100) NOT NULL DEFAULT '',
  target_label VARCHAR(200) NOT NULL DEFAULT '',
  environment VARCHAR(20) NOT NULL DEFAULT 'development',
  reason VARCHAR(500) NOT NULL DEFAULT '',
  before_state TEXT,
  after_state TEXT,
  request_id VARCHAR(16) NOT NULL DEFAULT '',
  ip VARCHAR(64) NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_admin_audit_created ON admin_audit_log(created_at);
CREATE INDEX idx_admin_audit_admin ON admin_audit_log(admin_account_id, created_at);
CREATE INDEX idx_admin_audit_category ON admin_audit_log(category);

CREATE TABLE server_settings (
  `key` VARCHAR(100) PRIMARY KEY,
  `value` TEXT NOT NULL,
  updated_by VARCHAR(100) NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Real defaults for the settings the panel edits. Level cap currently caps
-- leveling in server/src/models/leveling.ts via MAX_LEVEL.
INSERT INTO server_settings (`key`, `value`) VALUES
  ('exp_rate', '1.0'),
  ('drop_rate', '1.0'),
  ('honor_rate', '1.0'),
  ('max_concurrent_players', '500'),
  ('level_cap', '30');
