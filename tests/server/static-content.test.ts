import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the config loader BEFORE importing anything that uses it (same pattern
// as equipment-move.test.ts) so server tests never need server_config.json.
vi.mock("../../server/src/config/index.ts", () => ({
  server: { port: 3001, host: "0.0.0.0", nodeEnv: "testing", isDev: true, corsAllowedOrigins: [], debug: false },
  db: { file: ":memory:" },
  auth: { jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x", accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800, bcryptRounds: 4 },
  oidc: { clientId: "test", redirectUri: "http://localhost/callback", scopes: "openid", discoveryUrl: "https://test/.well-known", issuer: "https://test", jwksTtlSeconds: 600 },
  ai: { enabled: false, port: 3101, modelPath: "", mmprojPath: "", idleMs: 600000, warmupTimeoutMs: 90000, requestTimeoutMs: 4000, monsterDecisionIntervalMs: 5000, maxTokensMonster: 40, maxTokensNpc: 160, npcTalkMinIntervalMs: 6000 },
}));

import { runMigrations } from "../../server/src/db/migrate.ts";
import { closeDb, getDb } from "../../server/src/db/connection.ts";
import { syncStaticContent } from "../../server/src/content/staticContent.ts";

afterEach(async () => {
  await closeDb();
  vi.restoreAllMocks();
});

/** id/key of every row in a lookup table, keyed by table name. */
function snapshot(): Record<string, Array<[number | string, string]>> {
  const db = getDb();
  // skill_definitions is keyed by skill_key with no numeric id column.
  const tables: Array<{ table: string; idCol: string; keyCol: string }> = [
    { table: "character_classes", idCol: "id", keyCol: "key" },
    { table: "zones", idCol: "id", keyCol: "key" },
    { table: "item_definitions", idCol: "id", keyCol: "key" },
    { table: "skill_definitions", idCol: "skill_key", keyCol: "skill_key" },
    { table: "monster_definitions", idCol: "id", keyCol: "key" },
  ];
  const out: Record<string, Array<[number | string, string]>> = {};
  for (const { table, idCol, keyCol } of tables) {
    out[table] = (db.prepare(`SELECT ${idCol} AS id, ${keyCol} AS key FROM ${table} ORDER BY 1`).all() as Array<{ id: number | string; key: string }>)
      .map((r) => [r.id, String(r.key)] as [number | string, string]);
  }
  return out;
}

describe("syncStaticContent upsert semantics", () => {
  it("materializes every catalog into its lookup table", async () => {
    await runMigrations();
    syncStaticContent();
    const db = getDb();
    expect((db.prepare("SELECT COUNT(*) AS n FROM item_definitions").get() as { n: number }).n).toBeGreaterThan(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM character_classes").get() as { n: number }).n).toBe(3);
    expect((db.prepare("SELECT COUNT(*) AS n FROM zones").get() as { n: number }).n).toBeGreaterThan(0);
  });

  it("re-running is idempotent: same row counts and same numeric IDs", async () => {
    await runMigrations();
    syncStaticContent();
    const first = snapshot();

    syncStaticContent(); // a reload (e.g. server restart) must not duplicate
    const second = snapshot();

    expect(second).toEqual(first);
  });

  it("upserts preserve numeric IDs (ON CONFLICT DO UPDATE, never DELETE+INSERT)", async () => {
    await runMigrations();
    syncStaticContent();
    const db = getDb();
    const itemId = (db.prepare("SELECT id FROM item_definitions WHERE key = 'item-strawberry' LIMIT 1").get() as { id: number }).id;
    const zoneId = (db.prepare("SELECT id FROM zones WHERE key = 'zone-clover-village' LIMIT 1").get() as { id: number }).id;

    // Re-run the sync; every numeric id must be unchanged so player-owned rows
    // and audit history referencing them remain valid across content reloads.
    syncStaticContent();
    expect((db.prepare("SELECT id FROM item_definitions WHERE key = 'item-strawberry' LIMIT 1").get() as { id: number }).id).toBe(itemId);
    expect((db.prepare("SELECT id FROM zones WHERE key = 'zone-clover-village' LIMIT 1").get() as { id: number }).id).toBe(zoneId);
  });
});
