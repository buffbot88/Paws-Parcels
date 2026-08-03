-- ═══════════════════════════════════════════════════════════════════════
-- Phase 2 — Ashat Hub identity link
--
-- One ashat_user_id column is added to accounts so the server can map
-- an Ashat Hub session verify call (POST /api/sso/verify-session on
-- Ashat) to a Paws account row, then to one or more in-game characters.
--
-- The column is NULL-able and UNIQUE so the existing local accounts (none
-- exist in MVP, but the column is forward-compatible) can stay untouched
-- until a real Ashat login is performed; once linked, the value is stable.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE accounts
  ADD COLUMN ashat_user_id VARCHAR(64) NULL UNIQUE AFTER email,
  ADD INDEX idx_accounts_ashat_user_id (ashat_user_id);
