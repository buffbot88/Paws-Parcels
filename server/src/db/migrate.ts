import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, closeDb } from "./connection.ts";
import { splitStatements } from "./sql.ts";
import { logger } from "../middleware/logger.ts";
import { syncStaticContent } from "../content/staticContent.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// migrate.ts lives in server/src/db; the SQL files live one level up in
// server/src/migrations.
const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

/** Return the SHA-256 checksum stored for newly applied migrations. */
export function migrationChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Legacy databases stored the migration source length as a decimal string. */
export function isLegacyMigrationChecksum(checksum: string): boolean {
  return /^\d+$/.test(checksum);
}

export async function runMigrations(): Promise<void> {
  const db = getDb();

  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version VARCHAR(255) PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Read all migration files (sorted by name)
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f !== "schema_version.sql")
    .sort();

  for (const file of files) {
    // The version key is the filename without its .sql suffix (e.g.
    // "001_init.sql" → "001_init"). Renaming an applied file re-runs it, so
    // treat applied version keys as immutable.
    const version = file.replace(/\.sql$/, "");

    // Check if already applied
    const applied = db
      .prepare("SELECT checksum FROM schema_version WHERE version = ?")
      .get(version) as { checksum: string } | undefined;
    if (applied !== undefined) {
      logger.debug(
        `Migration already applied: ${version}`,
        { checksumFormat: isLegacyMigrationChecksum(applied.checksum) ? "legacy-length" : "sha256" },
      );
      continue;
    }

    const content = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8");
    const statements = splitStatements(content);

    try {
      db.exec("BEGIN");
      for (const stmt of statements) {
        try {
          db.exec(stmt);
        } catch (err) {
          // Dropping a column that this schema never had (fresh DBs created
          // after a migration-001 cleanup) is a no-op, not a migration
          // failure — SQLite has no DROP COLUMN IF EXISTS.
          if (
            /^ALTER TABLE\b[\s\S]*\bDROP COLUMN\b/i.test(stmt) &&
            String(err).includes("no such column")
          ) {
            logger.debug(`Migration ${version}: skipping DROP COLUMN (column already absent)`);
            continue;
          }
          throw err;
        }
      }

      // New records use SHA-256. Existing databases may contain decimal
      // length checksums; those rows remain valid and are never rewritten.
      db.prepare("INSERT INTO schema_version (version, checksum) VALUES (?, ?)").run(
        version,
        migrationChecksum(content),
      );
      db.exec("COMMIT");
      logger.info(`Migration applied: ${version}`);
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackErr) {
        logger.error(`Migration rollback failed: ${version}`, {
          error: String(rollbackErr),
        });
      }
      logger.error(`Migration failed: ${version}`, { error: String(err) });
      throw err;
    }
  }

  // SQL migrations define schema and player-state compatibility only. Static
  // catalogs are synchronized from src/data/*.json after the schema exists.
  syncStaticContent();
  logger.info("All migrations applied");
}

// Allow running directly: node --import tsx src/db/migrate.ts
const isMain = process.argv[1] !== undefined && process.argv[1].includes("migrate");
if (isMain) {
  runMigrations()
    .then(() => closeDb())
    .then(() => {
      console.log("Migration complete");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed", err);
      process.exit(1);
    });
}
