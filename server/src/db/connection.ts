import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { db as dbConfig } from "../config/index.ts";
import { logger } from "../middleware/logger.ts";

let database: DatabaseSync | null = null;

/**
 * The single SQLite connection (node:sqlite is synchronous — one process,
 * one DatabaseSync; HTTP + WS share it, so access is serialized naturally).
 */
export function getDb(): DatabaseSync {
  if (database === null) {
    const raw = dbConfig.file;
    const path = raw === ":memory:" ? raw : resolve(process.cwd(), raw);
    if (raw !== ":memory:") {
      // The repo's DB lives under server/data/ — create it on first boot.
      mkdirSync(dirname(path), { recursive: true });
    }
    database = new DatabaseSync(path);
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    logger.info("SQLite database opened", { path });
  }
  return database;
}

export async function pingDb(): Promise<boolean> {
  try {
    getDb().prepare("SELECT 1").get();
    return true;
  } catch (err) {
    logger.error("Database ping failed", { error: String(err) });
    return false;
  }
}

export async function closeDb(): Promise<void> {
  if (database !== null) {
    database.close();
    database = null;
    logger.info("SQLite database closed");
  }
}
