-- ═══════════════════════════════════════════════════════════════════════
-- Phase 2/3 — ASHAT Hub OIDC identity link
--
-- The accounts table in 001_initial_schema.sql was designed for local
-- email/password registration. The auth pivot to ASHAT Hub OIDC means:
--   * accounts are linked by a stable ashat_user_id (nullable UNIQUE,
--     forward-compatible with any pre-existing local accounts)
--   * the display name and role come from the OIDC id_token, so the table
--     needs display_name and role columns
--   * password_hash becomes nullable — OIDC-linked accounts have no local
--     password (the old NOT NULL constraint would break their INSERT)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE accounts
  ADD COLUMN display_name VARCHAR(100) NULL AFTER username,
  ADD COLUMN `role` VARCHAR(50) NOT NULL DEFAULT 'Member' AFTER display_name,
  ADD COLUMN ashat_user_id VARCHAR(64) NULL UNIQUE AFTER email,
  ADD INDEX idx_accounts_ashat_user_id (ashat_user_id),
  MODIFY COLUMN password_hash VARCHAR(255) NULL;
