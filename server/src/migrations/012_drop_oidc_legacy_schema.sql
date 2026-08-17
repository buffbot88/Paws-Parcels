-- 12. Retire the pre-OIDC auth leftovers (no local passwords, no refresh-token
-- rotation since ASHAT Hub OIDC). Fresh databases never create these (they
-- were removed from migration 001); this migration removes them from
-- databases that predate that cleanup. The runner treats a DROP COLUMN on a
-- schema that never had the column as a no-op, not a failure.
DROP TABLE IF EXISTS refresh_tokens;

ALTER TABLE accounts DROP COLUMN password_hash;
