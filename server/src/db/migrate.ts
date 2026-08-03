import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "./connection.ts";
import { splitStatements } from "./sql.ts";
import { logger } from "../middleware/logger.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// migrate.ts lives in server/src/db; the SQL files live one level up in
// server/src/migrations. Resolving the raw __dirname here would point at
// the db folder and silently apply zero migrations.
const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

export async function runMigrations(): Promise<void> {
  const pool = getPool();

  // Ensure schema_version table exists
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      version VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      checksum VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Read all migration files (sorted by name)
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f !== "schema_version.sql")
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");

    // Check if already applied
    const [rows] = await pool.execute<any>(
      "SELECT 1 FROM schema_version WHERE version = ?",
      [version],
    );
    if ((rows as any[]).length > 0) {
      logger.debug(`Migration already applied: ${version}`);
      continue;
    }

    const content = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8");
    const statements = splitStatements(content);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const stmt of statements) {
        await conn.execute(stmt);
      }

      // Compute a simple checksum for the file content
      const checksum = content.length.toString(); // simple checksum
      await conn.execute(
        "INSERT INTO schema_version (version, checksum) VALUES (?, ?)",
        [version, checksum],
      );

      await conn.commit();
      logger.info(`Migration applied: ${version}`);
    } catch (err) {
      await conn.rollback();
      logger.error(`Migration failed: ${version}`, { error: String(err) });
      throw err;
    } finally {
      conn.release();
    }
  }

  logger.info("All migrations applied");
}

// Allow running directly: node --import tsx src/db/migrate.ts
const isMain = process.argv[1] && (process.argv[1].includes("migrate"));
if (isMain) {
  runMigrations()
    .then(() => closePool())
    .then(() => {
      console.log("Migration complete");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed", err);
      process.exit(1);
    });
}