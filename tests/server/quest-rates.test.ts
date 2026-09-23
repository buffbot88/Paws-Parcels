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
import { closeDb } from "../../server/src/db/connection.ts";
import { findOrCreateAccountByAshatId } from "../../server/src/models/Account.ts";
import { createCharacter } from "../../server/src/models/Character.ts";
import { getCharacterClasses } from "../../server/src/models/CharacterClass.ts";
import { acceptQuest, completeDelivery } from "../../server/src/models/Quest.ts";
import { setServerSetting } from "../../server/src/models/Admin.ts";
import { resetGameplayRatesCache } from "../../server/src/models/GameplayRates.ts";

beforeEach(() => {
  resetGameplayRatesCache();
});

afterEach(async () => {
  await closeDb();
  vi.restoreAllMocks();
  resetGameplayRatesCache();
});

async function makeCharacter(username: string): Promise<number> {
  await runMigrations();
  const account = await findOrCreateAccountByAshatId({ ashatUserId: username, username, displayName: username, role: "Member" });
  const cls = (await getCharacterClasses())[0];
  const created = await createCharacter({ accountId: account.id, name: username, classId: cls.id, appearance: {}, cls });
  if (!created.ok) throw new Error("character creation failed");
  return created.character.id;
}

describe("exp_rate scales quest XP rewards", () => {
  it("doubles the welcome quest's 40 XP at exp_rate 2", async () => {
    const characterId = await makeCharacter("quest-rate-user");
    expect((await acceptQuest(characterId, "quest-village-welcome")).ok).toBe(true);

    // Set the rate mid-flight — setServerSetting refreshes the cache instantly.
    setServerSetting("exp_rate", "2", "test-admin");

    const done = await completeDelivery(characterId, "npc-biscuit");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    // 40 base XP × 2.0 = 80.
    expect(done.xp).toBe(80);
  });

  it("keeps base XP at the default 1.0 rate", async () => {
    const characterId = await makeCharacter("quest-rate-base");
    expect((await acceptQuest(characterId, "quest-village-welcome")).ok).toBe(true);
    const done = await completeDelivery(characterId, "npc-biscuit");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.xp).toBe(40);
  });
});
