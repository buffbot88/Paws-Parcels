import { afterEach, describe, expect, it, vi } from "vitest";

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
import { createCharacter } from "../../server/src/models/Character.ts";
import { getCharacterClasses } from "../../server/src/models/CharacterClass.ts";
import { acceptQuest, completeDelivery, getQuestInventory, getQuestState } from "../../server/src/models/Quest.ts";

afterEach(async () => {
  await closeDb();
  vi.restoreAllMocks();
});

describe("Clover Village tutorial quests", () => {
  it("starts with only the welcome route available and unlocks in order", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "quest-user", username: "quest-user", displayName: "Quest User", role: "Member" });
    const cls = (await getCharacterClasses())[0];
    const created = await createCharacter({ accountId: account.id, name: "Quest User", classId: cls.id, appearance: {}, cls });
    if (!created.ok) throw new Error("character creation failed");

    const initial = await getQuestState(created.character.id);
    expect(initial.map((q) => q.state)).toEqual(["available", "locked", "locked", "locked", "locked"]);
    const accepted = await acceptQuest(created.character.id, "quest-village-welcome");
    expect(accepted.ok).toBe(true);
    expect(getQuestInventory(created.character.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: "item-village-welcome-card", locked: true }),
    ]));

    const done = await completeDelivery(created.character.id, "npc-biscuit");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.quest.state).toBe("completed");
    expect(done.quests[1].state).toBe("available");
    expect(done.stamps).toBe(5);
    expect(done.xp).toBe(15);
    expect(getQuestInventory(created.character.id)).toHaveLength(0);
  });

  it("rejects a wrong recipient and a client-forged unbound parcel", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "quest-user-2", username: "quest-user-2", displayName: "Quest User 2", role: "Member" });
    const cls = (await getCharacterClasses())[0];
    const created = await createCharacter({ accountId: account.id, name: "Quest User 2", classId: cls.id, appearance: {}, cls });
    if (!created.ok) throw new Error("character creation failed");

    await acceptQuest(created.character.id, "quest-village-welcome");
    expect(await completeDelivery(created.character.id, "npc-maple")).toEqual({ ok: false, reason: "WRONG_DELIVERY_TARGET" });
    const item = getDb().prepare("SELECT id FROM item_definitions WHERE key = 'item-village-welcome-card'").get() as { id: number };
    getDb().prepare("UPDATE inventory_items SET stack_meta = ? WHERE character_id = ? AND item_definition_id = ?").run(JSON.stringify({ locked: false }), created.character.id, item.id);
    expect(await completeDelivery(created.character.id, "npc-biscuit")).toEqual({ ok: false, reason: "QUEST_ITEM_MISSING" });
  });
});
