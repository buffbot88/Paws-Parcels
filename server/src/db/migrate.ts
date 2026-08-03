import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, closeDb } from "./connection.ts";
import { splitStatements } from "./sql.ts";
import { logger } from "../middleware/logger.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// migrate.ts lives in server/src/db; the SQL files live one level up in
// server/src/migrations.
const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

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
    const version = file.replace(/\.sql$/, "");

    // Check if already applied
    const applied = db
      .prepare("SELECT 1 FROM schema_version WHERE version = ?")
      .get(version);
    if (applied !== undefined) {
      logger.debug(`Migration already applied: ${version}`);
      continue;
    }

    const content = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8");
    const statements = splitStatements(content);

    try {
      db.exec("BEGIN");
      for (const stmt of statements) {
        db.exec(stmt);
      }

      // Simple checksum: the file content length.
      db.prepare("INSERT INTO schema_version (version, checksum) VALUES (?, ?)").run(
        version,
        String(content.length),
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
