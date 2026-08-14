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
import { acceptQuest, completeDelivery, getQuestInventory, getQuestState, resetFragileDeliveriesOnDefeat, searchQuest } from "../../server/src/models/Quest.ts";

afterEach(async () => {
  await closeDb();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Clover Village tutorial quests", () => {
  it("starts with only the welcome route available and unlocks in order", async () => {
    await runMigrations();
    expect((getDb().prepare("SELECT COUNT(*) AS count FROM quest_definitions").get() as { count: number }).count).toBe(0);
    expect((getDb().prepare("SELECT COUNT(*) AS count FROM character_quest_progress").get() as { count: number }).count).toBe(0);
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "quest-user", username: "quest-user", displayName: "Quest User", role: "Member" });
    const cls = (await getCharacterClasses())[0];
    const created = await createCharacter({ accountId: account.id, name: "Quest User", classId: cls.id, appearance: {}, cls });
    if (!created.ok) throw new Error("character creation failed");

    const initial = await getQuestState(created.character.id);
    expect(initial.filter((q) => !q.sideQuest).map((q) => q.state)).toEqual(["available", "locked", "locked", "locked", "locked"]);
    expect(initial.filter((q) => q.sideQuest).every((q) => q.state === "locked")).toBe(true);
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

  it("teaches the full circuit and promotes the courier on the final delivery", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "circuit-user", username: "circuit-user", displayName: "Circuit User", role: "Member" });
    const cls = (await getCharacterClasses())[0];
    const created = await createCharacter({ accountId: account.id, name: "Circuit User", classId: cls.id, appearance: {}, cls });
    if (!created.ok) throw new Error("character creation failed");

    const route: [string, string, string][] = [
      ["quest-village-welcome", "npc-biscuit", "normal"],
      ["quest-fresh-bread-biscuit", "npc-maple", "normal"],
      ["quest-flower-note-maple", "npc-lumi", "fragile"],
      ["quest-moon-note-lumi", "npc-moss", "urgent"],
      ["quest-garden-greeting-moss", "npc-pip", "normal"],
    ];
    for (const [questId, targetId, condition] of route) {
      const accepted = await acceptQuest(created.character.id, questId);
      expect(accepted.ok).toBe(true);
      const snapshot = (await getQuestState(created.character.id)).find((quest) => quest.questId === questId);
      expect(snapshot?.parcelCondition).toBe(condition);
      const completed = await completeDelivery(created.character.id, targetId);
      expect(completed.ok).toBe(true);
    }

    const rank = getDb().prepare("SELECT courier_rank FROM characters WHERE id = ?").get(created.character.id) as { courier_rank: string };
    expect(rank.courier_rank).toBe("Courier");
    expect((await getQuestState(created.character.id)).filter((quest) => !quest.sideQuest).every((quest) => quest.state === "completed")).toBe(true);
  });

  it("unlocks optional errands after the circuit, lets couriers search, and grants a friendship cosmetic", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "side-quest-user", username: "side-quest-user", displayName: "Side Quest User", role: "Member" });
    const cls = (await getCharacterClasses())[0];
    const created = await createCharacter({ accountId: account.id, name: "Side Quest User", classId: cls.id, appearance: {}, cls });
    if (!created.ok) throw new Error("character creation failed");

    const route: [string, string][] = [
      ["quest-village-welcome", "npc-biscuit"],
      ["quest-fresh-bread-biscuit", "npc-maple"],
      ["quest-flower-note-maple", "npc-lumi"],
      ["quest-moon-note-lumi", "npc-moss"],
      ["quest-garden-greeting-moss", "npc-pip"],
    ];
    for (const [questId, targetId] of route) {
      expect((await acceptQuest(created.character.id, questId)).ok).toBe(true);
      expect((await completeDelivery(created.character.id, targetId)).ok).toBe(true);
    }

    const state = await getQuestState(created.character.id);
    expect(state.find((quest) => quest.questId === "quest-lost-pebble-moss")?.state).toBe("available");
    expect(state.find((quest) => quest.questId === "quest-pip-courier-cap")?.state).toBe("locked");
    expect((await acceptQuest(created.character.id, "quest-lost-pebble-moss")).ok).toBe(true);
    const found = await searchQuest(created.character.id, "object-rabbit-burrows");
    expect(found.ok).toBe(true);
    expect(getQuestInventory(created.character.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: "item-polished-pebble", locked: false }),
    ]));
    expect((await completeDelivery(created.character.id, "npc-moss")).ok).toBe(true);
    const completed = await getQuestState(created.character.id);
    expect(completed.find((quest) => quest.questId === "quest-lost-pebble-moss")?.state).toBe("completed");
    expect(completed.find((quest) => quest.questId === "quest-moss-garden-key")?.state).toBe("available");
  });

  it("resets fragile parcels on defeat and expires urgent parcels into a retryable route", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "condition-user", username: "condition-user", displayName: "Condition User", role: "Member" });
    const cls = (await getCharacterClasses())[0];
    const created = await createCharacter({ accountId: account.id, name: "Condition User", classId: cls.id, appearance: {}, cls });
    if (!created.ok) throw new Error("character creation failed");

    for (const [questId, targetId] of [["quest-village-welcome", "npc-biscuit"], ["quest-fresh-bread-biscuit", "npc-maple"]] as const) {
      expect((await acceptQuest(created.character.id, questId)).ok).toBe(true);
      expect((await completeDelivery(created.character.id, targetId)).ok).toBe(true);
    }

    expect((await acceptQuest(created.character.id, "quest-flower-note-maple")).ok).toBe(true);
    expect(resetFragileDeliveriesOnDefeat(created.character.id)).toEqual(["quest-flower-note-maple"]);
    expect((await getQuestState(created.character.id)).find((quest) => quest.questId === "quest-flower-note-maple")?.state).toBe("available");
    expect(getQuestInventory(created.character.id)).toHaveLength(0);

    expect((await acceptQuest(created.character.id, "quest-flower-note-maple")).ok).toBe(true);
    expect((await completeDelivery(created.character.id, "npc-lumi")).ok).toBe(true);
    expect((await acceptQuest(created.character.id, "quest-moon-note-lumi")).ok).toBe(true);
    const urgent = (await getQuestState(created.character.id)).find((quest) => quest.questId === "quest-moon-note-lumi");
    expect(urgent?.deadlineAt).toEqual(expect.any(Number));

    getDb().prepare("UPDATE character_quest_progress SET accepted_at = ? WHERE character_id = ? AND quest_key = ?")
      .run(new Date(Date.now() - 91_000).toISOString(), created.character.id, "quest-moon-note-lumi");
    expect((await getQuestState(created.character.id)).find((quest) => quest.questId === "quest-moon-note-lumi")?.state).toBe("available");
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
