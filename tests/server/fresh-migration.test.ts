import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../server/src/config/index.ts", () => ({
  server: { port: 3001, host: "127.0.0.1", nodeEnv: "testing", isDev: true, corsAllowedOrigins: [], debug: false, staticDir: "" },
  db: { file: ":memory:" },
  auth: { jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x", accessTokenTtlSeconds: 900 },
  oidc: { clientId: "test", redirectUri: "http://localhost/callback", scopes: "openid", discoveryUrl: "https://test/.well-known", issuer: "https://test", jwksTtlSeconds: 600 },
  admin: { roleTiers: {} },
  ai: { enabled: false, port: 3101, modelPath: "", mmprojPath: "", idleMs: 600000, warmupTimeoutMs: 90000, requestTimeoutMs: 4000, monsterDecisionIntervalMs: 5000, maxTokensMonster: 40, maxTokensNpc: 160, npcTalkMinIntervalMs: 6000 },
}));

import { db as dbConfig } from "../../server/src/config/index.ts";
import { closeDb, getDb } from "../../server/src/db/connection.ts";
import { runMigrations } from "../../server/src/db/migrate.ts";

afterEach(async () => {
  await closeDb();
  vi.restoreAllMocks();
});

describe("fresh SQLite migration", () => {
  it("creates a clean temporary database and synchronizes static content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paws-parcels-migration-"));
    const databaseFile = join(directory, "fresh.sqlite");
    dbConfig.file = databaseFile;

    try {
      await runMigrations();
      const db = getDb();
      const tables = new Set(
        (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name),
      );
      for (const table of [
        "schema_version",
        "accounts",
        "characters",
        "inventories",
        "item_definitions",
        "character_quest_progress",
        "admin_audit_log",
      ]) {
        expect(tables.has(table)).toBe(true);
      }
      expect((db.prepare("SELECT COUNT(*) AS count FROM schema_version").get() as { count: number }).count).toBe(17);
      const checksums = db.prepare("SELECT checksum FROM schema_version").all() as Array<{ checksum: string }>;
      expect(checksums.every((row) => /^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
      expect((db.prepare("SELECT COUNT(*) AS count FROM character_classes").get() as { count: number }).count).toBe(3);
      expect((db.prepare("SELECT COUNT(*) AS count FROM item_definitions").get() as { count: number }).count).toBeGreaterThan(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM monster_definitions").get() as { count: number }).count).toBe(5);
    } finally {
      await closeDb();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
