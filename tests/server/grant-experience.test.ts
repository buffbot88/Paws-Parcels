import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the config loader BEFORE importing anything that uses it so server
// tests never need server_config.json (same pattern as equipment-move.test.ts).
vi.mock("../../server/src/config/index.ts", () => ({
  server: { port: 3001, host: "0.0.0.0", nodeEnv: "testing", isDev: true, corsAllowedOrigins: [], debug: false },
  db: { file: ":memory:" },
  auth: { jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x", accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800, bcryptRounds: 4 },
  oidc: { clientId: "test", redirectUri: "http://localhost/callback", scopes: "openid", discoveryUrl: "https://test/.well-known", issuer: "https://test", jwksTtlSeconds: 600 },
  ai: { enabled: false, port: 3101, modelPath: "", mmprojPath: "", idleMs: 600000, warmupTimeoutMs: 90000, requestTimeoutMs: 4000, monsterDecisionIntervalMs: 5000, maxTokensMonster: 40, maxTokensNpc: 160, npcTalkMinIntervalMs: 6000 },
}));

import { runMigrations } from "../../server/src/db/migrate.ts";
import { closeDb, getDb } from "../../server/src/db/connection.ts";
import { findOrCreateAccountByAshatId } from "../../server/src/models/Account.ts";
import { createCharacter, grantExperience } from "../../server/src/models/Character.ts";
import { getCharacterClasses } from "../../server/src/models/CharacterClass.ts";

afterEach(async () => {
  await closeDb();
  vi.restoreAllMocks();
});

async function makeCharacter(): Promise<number> {
  await runMigrations();
  const account = await findOrCreateAccountByAshatId({ ashatUserId: "xp-user", username: "xp-user", displayName: "XP User", role: "Member" });
  const cls = (await getCharacterClasses())[0];
  const created = await createCharacter({ accountId: account.id, name: "XP User", classId: cls.id, appearance: {}, cls });
  if (!created.ok) throw new Error("character creation failed");
  return created.character.id;
}

function row(characterId: number): { experience: number; level: number; skill_points: number } {
  return getDb().prepare("SELECT experience, level, skill_points FROM characters WHERE id = ?").get(characterId) as { experience: number; level: number; skill_points: number };
}

describe("grantExperience", () => {
  it("adds XP without leveling below the first threshold", async () => {
    const id = await makeCharacter();
    const granted = await grantExperience(id, 40);
    expect(granted).toMatchObject({ experience: 40, level: 1, previousLevel: 1, levelsGained: 0, rankPromotion: null });
    expect(row(id)).toEqual({ experience: 40, level: 1, skill_points: 1 });
  });

  it("levels up at the threshold and grants a skill point", async () => {
    const id = await makeCharacter();
    const granted = await grantExperience(id, 100);
    // Characters are created at level 1 with one starting skill point.
    expect(row(id)).toEqual({ experience: 100, level: 2, skill_points: 2 });
    expect(granted).toEqual({
      level: 2, previousLevel: 1, levelsGained: 1, experience: 100,
      skillPoints: 2, courierRank: expect.any(String), rankPromotion: null,
    });
  });

  it("handles multi-level jumps and ignores negative amounts", async () => {
    const id = await makeCharacter();
    await grantExperience(id, 600);
    const after = row(id);
    expect(after).toEqual({ experience: 600, level: 7, skill_points: 7 });

    await grantExperience(id, -50);
    expect(row(id).experience).toBe(600); // clamped, no XP loss
  });

  it("returns null for an unknown character", async () => {
    await runMigrations();
    expect(await grantExperience(99999, 10)).toBeNull();
  });
});
