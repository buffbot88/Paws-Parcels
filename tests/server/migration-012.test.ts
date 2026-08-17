import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { splitStatements } from "../../server/src/db/sql.ts";

const MIGRATION_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../server/src/migrations/012_drop_oidc_legacy_schema.sql",
);

/**
 * Migration 012 retires the pre-OIDC auth leftovers. Fresh DBs never create
 * them (they were removed from migration 001), so this exercises the legacy
 * path: a database that still has `refresh_tokens` and `accounts.password_hash`
 * (created before the 001 cleanup) must end up without either.
 */
describe("migration 012 — drop pre-OIDC auth leftovers", () => {
  it("removes refresh_tokens and accounts.password_hash from a legacy schema", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE accounts (id INTEGER PRIMARY KEY, password_hash TEXT);");
    db.exec("CREATE TABLE refresh_tokens (id INTEGER PRIMARY KEY);");

    for (const stmt of splitStatements(readFileSync(MIGRATION_PATH, "utf8"))) {
      db.exec(stmt);
    }

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'refresh_tokens'")
      .get();
    expect(table).toBeUndefined();
    const columns = db
      .prepare("PRAGMA table_info(accounts)")
      .all()
      .map((column) => column.name);
    expect(columns).not.toContain("password_hash");
  });

  // The fresh-DB path (no leftovers to drop) is covered implicitly: every
  // server test runs runMigrations() from scratch on an in-memory DB, which
  // now records migration 012 and exercises the runner's DROP COLUMN
  // tolerance for a schema that never had the column.
});
