import { createPool, type Pool, type PoolOptions } from "mysql2/promise";
import { db as dbConfig, server } from "../config/index.ts";
import { logger } from "../middleware/logger.ts";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const opts: PoolOptions = {
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: "utf8mb4",
      timezone: "+00:00",
    };
    pool = createPool(opts);
    logger.info("MySQL pool created", {
      host: dbConfig.host,
      database: dbConfig.database,
    });
  }
  return pool;
}

export async function pingDb(): Promise<boolean> {
  try {
    const conn = await getPool().getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch (err) {
    logger.error("Database ping failed", { error: String(err) });
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("MySQL pool closed");
  }
}