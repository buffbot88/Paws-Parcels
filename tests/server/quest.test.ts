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
import { createCharacter, grantInventoryItems } from "../../server/src/models/Character.ts";
import { getCharacterClasses } from "../../server/src/models/CharacterClass.ts";
import { acceptQuest, completeDelivery, getQuestInventory, getQuestState, recordMonsterDefeat, resetFragileDeliveriesOnDefeat, searchQuest, visitDeliveryStop } from "../../server/src/models/Quest.ts";

const CIRCUIT: [string, string][] = [
  ["quest-village-welcome", "npc-biscuit"],
  ["quest-fresh-bread-biscuit", "npc-maple"],
  ["quest-flower-note-maple", "npc-lumi"],
  ["quest-moon-note-lumi", "npc-moss"],
  ["quest-garden-greeting-moss", "npc-pip"],
];

/** A fresh courier who has finished the tutorial circuit, so 4B side quests can unlock. */
async function circuitCourier(name: string): Promise<number> {
  const account = await findOrCreateAccountByAshatId({ ashatUserId: name, username: name, displayName: name, role: "Member" });
  const cls = (await getCharacterClasses())[0];
  const created = await createCharacter({ accountId: account.id, name, classId: cls.id, appearance: {}, cls });
  if (!created.ok) throw new Error("character creation failed");
  for (const [questId, targetId] of CIRCUIT) {
    expect((await acceptQuest(created.character.id, questId)).ok).toBe(true);
    expect((await completeDelivery(created.character.id, targetId)).ok).toBe(true);
  }
  return created.character.id;
}

async function completeSearch(characterId: number, questId: string, objectId: string, targetId: string): Promise<void> {
  expect((await acceptQuest(characterId, questId)).ok).toBe(true);
  expect((await searchQuest(characterId, objectId)).ok).toBe(true);
  expect((await completeDelivery(characterId, targetId)).ok).toBe(true);
}

function friendshipPoints(characterId: number, npcId: string): number {
  const row = getDb().prepare("SELECT points FROM friendships WHERE character_id = ? AND npc_id = ?").get(characterId, npcId) as { points: number } | undefined;
  return row?.points ?? 0;
}

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
    expect(done.stamps).toBe(8);
    expect(done.xp).toBe(40);
    expect(getQuestInventory(created.character.id)).toHaveLength(0);
  });

  it("teaches the full circuit and promotes the courier on the final delivery", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "circuit-user", username: "circuit-user", displayName: "Circuit User", role: "Member" });
    const cls = (await getCharacterClasses())[0];
    const created = await createCharacter({ accountId: account.id, name: "Circuit User", classId: cls.id, appearance: {}, cls });
    if (!created.ok) throw new Error("character creation failed");

    // Each leg's expected post-grant level and total XP: the circuit is tuned
    // to finish on level 5 (the closing delivery crosses two levels at once
    // and promotes the courier).
    const deliveries: NonNullable<Awaited<ReturnType<typeof completeDelivery>> & { ok: true }>["progression"][] = [];
    const route: [string, string, string, number, number][] = [
      ["quest-village-welcome", "npc-biscuit", "normal", 1, 40],
      ["quest-fresh-bread-biscuit", "npc-maple", "normal", 2, 100],
      ["quest-flower-note-maple", "npc-lumi", "fragile", 2, 180],
      ["quest-moon-note-lumi", "npc-moss", "normal", 3, 280],
      ["quest-garden-greeting-moss", "npc-pip", "normal", 5, 400],
    ];
    for (const [questId, targetId, condition, expectedLevel, expectedXp] of route) {
      const accepted = await acceptQuest(created.character.id, questId);
      expect(accepted.ok).toBe(true);
      const snapshot = (await getQuestState(created.character.id)).find((quest) => quest.questId === questId);
      expect(snapshot?.parcelCondition).toBe(condition);
      // Every leg of the tutorial carries the same welcome letter forward.
      expect(snapshot?.requiredItemId).toBe("item-village-welcome-card");
      expect(getQuestInventory(created.character.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({ itemKey: "item-village-welcome-card", locked: true }),
      ]));
      const completed = await completeDelivery(created.character.id, targetId);
      expect(completed.ok).toBe(true);
      // Onboarding must never stall on a clock: no leg sets a deadline.
      expect(snapshot?.deadlineAt).toBeNull();
      // Every delivery reports the progression it wrote, so the HUD can present
      // a level-up without re-deriving the curve.
      if (completed.ok) {
        expect(completed.progression).toMatchObject({
          level: expectedLevel,
          experience: expectedXp,
        });
        expect(completed.progression?.levelsGained).toBeGreaterThanOrEqual(0);
        deliveries.push(completed.progression);
      }
    }

    // The closing delivery is the celebration: two levels crossed and the rank
    // promoted together, reported as one progression frame.
    expect(deliveries[4]).toEqual({
      level: 5,
      previousLevel: 3,
      levelsGained: 2,
      experience: 400,
      // One skill point per level crossed, plus the one a fresh courier starts
      // with (level 1).
      skillPoints: 5,
      courierRank: "Courier",
      rankPromotion: "Courier",
    });

    const rank = getDb().prepare("SELECT courier_rank, level, experience FROM characters WHERE id = ?").get(created.character.id) as { courier_rank: string; level: number; experience: number };
    expect(rank.courier_rank).toBe("Courier");
    // The circuit is tuned to land the new courier exactly on level 5.
    expect(rank.experience).toBe(400);
    expect(rank.level).toBe(5);
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
    // Progress stores { delivered: 0, found: 1 } — the find must still show.
    expect(found.ok && found.quest.progress).toBe(1);
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

    // Finish the circuit — urgent routes are post-tutorial errands, never onboarding steps.
    expect((await acceptQuest(created.character.id, "quest-flower-note-maple")).ok).toBe(true);
    expect((await completeDelivery(created.character.id, "npc-lumi")).ok).toBe(true);
    for (const [questId, targetId] of [["quest-moon-note-lumi", "npc-moss"], ["quest-garden-greeting-moss", "npc-pip"]] as const) {
      expect((await acceptQuest(created.character.id, questId)).ok).toBe(true);
      expect((await completeDelivery(created.character.id, targetId)).ok).toBe(true);
    }

    expect((await acceptQuest(created.character.id, "quest-picnic-for-maple")).ok).toBe(true);
    const urgent = (await getQuestState(created.character.id)).find((quest) => quest.questId === "quest-picnic-for-maple");
    expect(urgent?.parcelCondition).toBe("urgent");
    expect(urgent?.deadlineAt).toEqual(expect.any(Number));

    getDb().prepare("UPDATE character_quest_progress SET accepted_at = ? WHERE character_id = ? AND quest_key = ?")
      .run(new Date(Date.now() - 181_000).toISOString(), created.character.id, "quest-picnic-for-maple");
    expect((await getQuestState(created.character.id)).find((quest) => quest.questId === "quest-picnic-for-maple")?.state).toBe("available");
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

describe("kill-count objectives", () => {
  it("credits only the named courier, caps at the count, and completes only after the count", async () => {
    await runMigrations();
    const killer = await circuitCourier("defeat-killer");
    const bystander = await circuitCourier("defeat-bystander");
    for (const courier of [killer, bystander]) {
      await completeSearch(courier, "quest-lost-pebble-moss", "object-rabbit-burrows", "npc-moss");
      expect((await acceptQuest(courier, "quest-moss-burrow-boars")).ok).toBe(true);
    }

    const early = await completeDelivery(killer, "npc-moss");
    expect(early).toMatchObject({ ok: false, reason: "QUEST_OBJECTIVE_INCOMPLETE" });
    expect(early.ok === false && early.message).toContain("4 more Wild Boar");

    expect(await recordMonsterDefeat(killer, "monster-valley-fox")).toBeNull();
    for (let kill = 1; kill <= 4; kill += 1) {
      const credited = await recordMonsterDefeat(killer, "monster-wild-boar");
      expect(credited?.quest).toMatchObject({ progress: kill, requiredQuantity: 4, defeat: { monsterKey: "monster-wild-boar", monsterName: "Wild Boar", count: 4 } });
      expect(credited?.message).toContain(`Wild Boar ${kill}/4`);
    }
    // A fifth kill is past the cap: no update and the tally stays at 4.
    expect(await recordMonsterDefeat(killer, "monster-wild-boar")).toBeNull();
    const snapshot = (await getQuestState(killer)).find((quest) => quest.questId === "quest-moss-burrow-boars");
    expect(snapshot?.progress).toBe(4);
    // The other courier on the same quest earned nothing from those kills.
    expect((await getQuestState(bystander)).find((quest) => quest.questId === "quest-moss-burrow-boars")?.progress).toBe(0);
    expect((await completeDelivery(bystander, "npc-moss")).ok).toBe(false);

    const done = await completeDelivery(killer, "npc-moss");
    expect(done.ok).toBe(true);
    expect(done.ok && done.quest).toMatchObject({ state: "completed", progress: 4 });
    expect(friendshipPoints(killer, "npc-moss")).toBe(6);
  });

  it("makes the golden acorn reachable through Moss's kill quests (friendship level 2 = 7 points)", async () => {
    await runMigrations();
    const courier = await circuitCourier("golden-acorn-courier");
    await completeSearch(courier, "quest-lost-pebble-moss", "object-rabbit-burrows", "npc-moss");
    for (const [questId, monsterKey] of [["quest-moss-burrow-boars", "monster-wild-boar"], ["quest-moss-fox-watch", "monster-valley-fox"]] as const) {
      expect((await getQuestState(courier)).find((quest) => quest.questId === "quest-golden-acorn-moss")?.state).toBe("locked");
      expect((await acceptQuest(courier, questId)).ok).toBe(true);
      for (let kill = 0; kill < 4; kill += 1) await recordMonsterDefeat(courier, monsterKey);
      expect((await completeDelivery(courier, "npc-moss")).ok).toBe(true);
    }
    expect(friendshipPoints(courier, "npc-moss")).toBe(9);
    expect((await getQuestState(courier)).find((quest) => quest.questId === "quest-golden-acorn-moss")?.state).toBe("available");
    await completeSearch(courier, "quest-golden-acorn-moss", "object-hollow-oak", "npc-moss");
    expect(friendshipPoints(courier, "npc-moss")).toBe(12);
  });
});

describe("batch 4 chains", () => {
  it("walks Safe Roads (Pip → Biscuit) and Lumi's Moonlight Survey (Lumi → Maple) to their friendship rewards", async () => {
    await runMigrations();
    const courier = await circuitCourier("batch-four-courier");

    await completeSearch(courier, "quest-biscuit-ingredient-run", "object-valley-blueberries", "npc-biscuit");
    await grantInventoryItems(courier, [{ itemKey: "item-boar-hide", quantity: 3 }, { itemKey: "item-grouse-feather", quantity: 3 }]);
    for (const questId of ["quest-valley-hides-for-satchels", "quest-valley-feathers-for-quills"]) {
      expect((await acceptQuest(courier, questId)).ok).toBe(true);
      expect((await completeDelivery(courier, "npc-pip")).ok).toBe(true);
    }
    expect((await acceptQuest(courier, "quest-valley-roads-safe")).ok).toBe(true);
    expect((await completeDelivery(courier, "npc-biscuit")).ok).toBe(true);
    expect(getQuestInventory(courier).some((item) => item.itemKey === "item-honey-jar")).toBe(true);

    await completeSearch(courier, "quest-lumis-lost-notebook", "object-pond-edge", "npc-lumi");
    expect((await acceptQuest(courier, "quest-lumi-grouse-survey")).ok).toBe(true);
    for (let kill = 0; kill < 3; kill += 1) await recordMonsterDefeat(courier, "monster-black-grouse");
    expect((await completeDelivery(courier, "npc-lumi")).ok).toBe(true);
    await grantInventoryItems(courier, [{ itemKey: "item-deer-antler", quantity: 1 }]);
    expect((await acceptQuest(courier, "quest-lumi-antler-study")).ok).toBe(true);
    expect((await completeDelivery(courier, "npc-lumi")).ok).toBe(true);
    expect((await acceptQuest(courier, "quest-lumi-findings-to-maple")).ok).toBe(true);
    expect((await completeDelivery(courier, "npc-maple")).ok).toBe(true);
    // Tutorial leg (+1) and the findings letter (+2) reach Maple's level-1 gate (3 points).
    expect(friendshipPoints(courier, "npc-maple")).toBe(3);
    expect((await acceptQuest(courier, "quest-maple-moonflower-thanks")).ok).toBe(true);
    expect((await completeDelivery(courier, "npc-maple")).ok).toBe(true);
    expect(getQuestInventory(courier).some((item) => item.itemKey === "item-cozy-scarf")).toBe(true);
  });
});

describe("multi-stop deliveries", () => {
  it("blocks the final delivery until every stop is visited and names the next stop", async () => {
    await runMigrations();
    const courier = await circuitCourier("multi-stop-courier");
    expect((await acceptQuest(courier, "quest-letters-two-stops")).ok).toBe(true);

    const early = await completeDelivery(courier, "npc-maple");
    expect(early).toMatchObject({ ok: false, reason: "DELIVERY_STOPS_REMAINING" });
    expect(early.ok === false && early.message).toContain("Biscuit");
    // Talking to a villager who is not a pending stop changes nothing.
    expect(await visitDeliveryStop(courier, "npc-lumi")).toBeNull();

    const visited = await visitDeliveryStop(courier, "npc-biscuit");
    expect(visited?.quest).toMatchObject({ state: "active", additionalStops: ["npc-biscuit"], visitedStops: ["npc-biscuit"] });
    expect(visited?.message).toContain("Maple");
    expect(await visitDeliveryStop(courier, "npc-biscuit")).toBeNull();

    const done = await completeDelivery(courier, "npc-maple");
    expect(done.ok).toBe(true);
    expect(done.ok && done.quest.state).toBe("completed");
    expect(getQuestInventory(courier).some((item) => item.itemKey === "item-sealed-letter")).toBe(false);
  });

  it("does not mark a stop visited without the bound parcel", async () => {
    await runMigrations();
    const courier = await circuitCourier("multi-stop-no-parcel");
    expect((await acceptQuest(courier, "quest-letters-two-stops")).ok).toBe(true);
    getDb().prepare("DELETE FROM inventory_items WHERE character_id = ?").run(courier);
    expect(await visitDeliveryStop(courier, "npc-biscuit")).toBeNull();
    expect((await getQuestState(courier)).find((quest) => quest.questId === "quest-letters-two-stops")?.visitedStops).toEqual([]);
  });
});
