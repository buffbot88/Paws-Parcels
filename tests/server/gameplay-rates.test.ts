import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the config loader BEFORE importing anything that uses it (same pattern
// as the other server tests) so tests never need server_config.json.
vi.mock("../../server/src/config/index.ts", () => ({
  server: { port: 3001, host: "0.0.0.0", nodeEnv: "testing", isDev: true, corsAllowedOrigins: [], debug: false },
  db: { file: ":memory:" },
  auth: { jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x", accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800, bcryptRounds: 4 },
  oidc: { clientId: "test", redirectUri: "http://localhost/callback", scopes: "openid", discoveryUrl: "https://test/.well-known", issuer: "https://test", jwksTtlSeconds: 600 },
  ai: { enabled: false, port: 3101, modelPath: "", mmprojPath: "", idleMs: 600000, warmupTimeoutMs: 90000, requestTimeoutMs: 4000, monsterDecisionIntervalMs: 5000, maxTokensMonster: 40, maxTokensNpc: 160, npcTalkMinIntervalMs: 6000 },
  admin: { roleTiers: {} },
}));

import { runMigrations } from "../../server/src/db/migrate.ts";
import { closeDb, getDb } from "../../server/src/db/connection.ts";
import {
  getGameplayRates,
  invalidateGameplayRates,
  refreshGameplayRates,
  resetGameplayRatesCache,
} from "../../server/src/models/GameplayRates.ts";
import { setServerSetting } from "../../server/src/models/Admin.ts";

beforeEach(() => {
  resetGameplayRatesCache();
});

afterEach(async () => {
  await closeDb();
  resetGameplayRatesCache();
});

async function upsertSetting(key: string, value: string): Promise<void> {
  getDb()
    .prepare(
      `INSERT INTO server_settings (\`key\`, \`value\`, updated_by, updated_at) VALUES (?, ?, 'test', ?)
       ON CONFLICT(\`key\`) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value, new Date().toISOString());
}

describe("GameplayRates cache", () => {
  it("returns 1.0 defaults when no settings rows exist", async () => {
    await runMigrations();
    expect(getGameplayRates()).toEqual({ expRate: 1, dropRate: 1 });
  });

  it("returns fail-safe 1.0 when the settings table is missing", () => {
    // No migrations run — the table does not exist; must not throw.
    expect(getGameplayRates()).toEqual({ expRate: 1, dropRate: 1 });
  });

  it("picks up DB values after the TTL window expires", async () => {
    await runMigrations();
    expect(getGameplayRates()).toEqual({ expRate: 1, dropRate: 1 });

    upsertSetting("exp_rate", "2.5");
    upsertSetting("drop_rate", "3");
    // Within the TTL window the cached snapshot is still served.
    expect(getGameplayRates()).toEqual({ expRate: 1, dropRate: 1 });

    // Past the TTL the fresh values are read.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11_000);
    try {
      expect(getGameplayRates()).toEqual({ expRate: 2.5, dropRate: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes immediately after setServerSetting", async () => {
    await runMigrations();
    expect(getGameplayRates()).toEqual({ expRate: 1, dropRate: 1 });

    setServerSetting("exp_rate", "2", "test-admin");
    setServerSetting("drop_rate", "0.5", "test-admin");
    expect(getGameplayRates()).toEqual({ expRate: 2, dropRate: 0.5 });
  });

  it("invalidateGameplayRates forces the next read to reload", async () => {
    await runMigrations();
    refreshGameplayRates();
    upsertSetting("exp_rate", "1.75");
    expect(getGameplayRates()).toEqual({ expRate: 1, dropRate: 1 });
    invalidateGameplayRates();
    expect(getGameplayRates()).toEqual({ expRate: 1.75, dropRate: 1 });
  });

  it("treats corrupt or out-of-range values as 1.0", async () => {
    await runMigrations();
    upsertSetting("exp_rate", "banana");
    upsertSetting("drop_rate", "9999");
    invalidateGameplayRates();
    expect(getGameplayRates()).toEqual({ expRate: 1, dropRate: 1 });
  });
});
