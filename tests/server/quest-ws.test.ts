import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/src/config/index.ts", () => ({
  server: { port: 3001, host: "0.0.0.0", nodeEnv: "testing", isDev: true, corsAllowedOrigins: [], debug: false },
  db: { file: ":memory:" },
  auth: { jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x", accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800, bcryptRounds: 4 },
  oidc: { clientId: "test", redirectUri: "http://localhost/callback", scopes: "openid", discoveryUrl: "https://test/.well-known", issuer: "https://test", jwksTtlSeconds: 600 },
  ai: { enabled: false, port: 3101, modelPath: "", mmprojPath: "", idleMs: 600000, warmupTimeoutMs: 90000, requestTimeoutMs: 4000, monsterDecisionIntervalMs: 5000, maxTokensMonster: 40, maxTokensNpc: 160, npcTalkMinIntervalMs: 6000 },
}));

import { runMigrations } from "../../server/src/db/migrate.ts";
import { closeDb } from "../../server/src/db/connection.ts";
import { findOrCreateAccountByAshatId } from "../../server/src/models/Account.ts";
import { createCharacter, getCharacterWithClass, grantInventoryItems } from "../../server/src/models/Character.ts";
import { getCharacterClasses } from "../../server/src/models/CharacterClass.ts";
import { acceptQuest, completeDelivery, getQuestInventory, getQuestState } from "../../server/src/models/Quest.ts";
import { equipItem, getInventoryState, unequipItem } from "../../server/src/models/Equipment.ts";
import { GameServer, type SocketLike } from "../../server/src/ws/gameServer.ts";
import { issueWsToken, resetWsTokenStore } from "../../server/src/ws/tokenStore.ts";

const ZONE = "zone-clover-village";
const PIP_TILE = { x: 29, y: 31 };
const BISCUIT_TILE = { x: 34, y: 33 };

interface FakeSocket extends SocketLike {
  sent: unknown[];
  closed: boolean;
}

function fakeSocket(): FakeSocket {
  const s: FakeSocket = {
    sent: [],
    closed: false,
    send(payload: unknown) { this.sent.push(JSON.parse(JSON.stringify(payload))); },
    close() { this.closed = true; },
  };
  return s;
}

function lastOfType(socket: FakeSocket, type: string): Record<string, unknown> | undefined {
  const msgs = socket.sent.filter((m) => (m as { type: string }).type === type);
  return msgs[msgs.length - 1] as Record<string, unknown> | undefined;
}

function makeServer(characterId: number, accountId: number) {
  return new GameServer({
    loadCharacter: async (id: number) => {
      if (id !== characterId) return null;
      const row = await getCharacterWithClass(id);
      return row === null ? null : { characterId: id, accountId, name: row.name, classKey: row.class_key, zoneId: ZONE, pos: { ...PIP_TILE }, hp: row.hp, maxHp: row.max_hp, attack: row.attack, defense: row.defense, speed: row.speed, critChance: row.crit_chance, critMultiplier: row.crit_multiplier };
    },
    getZoneData: () => ({
      zoneId: ZONE, width: 100, height: 100, spawn: { x: 0, y: 0 },
      isWalkable: () => true, monsterSpawns: [],
    }),
    // The circuit's first two stops: Pip hands out the welcome letter, Biscuit
    // receives it.
    getNpcPosition: (npcId: string, zoneId: string) => {
      if (zoneId !== ZONE) return null;
      if (npcId === "npc-pip") return { ...PIP_TILE };
      if (npcId === "npc-biscuit") return { ...BISCUIT_TILE };
      return null;
    },
    getQuestState,
    acceptQuest,
    completeDelivery,
    getQuestInventory,
    getInventoryState,
    equipItem,
    unequipItem,
  } as unknown as ConstructorParameters<typeof GameServer>[0]);
}

async function connectAndJoin(server: GameServer, socket: FakeSocket, characterId: number, accountId: number) {
  server.registerSocket(socket);
  const token = issueWsToken(accountId, characterId);
  await server.onMessage(socket, JSON.stringify({ type: "authenticate", token }));
  await server.onMessage(socket, JSON.stringify({ type: "join_zone", zoneId: ZONE }));
}

afterEach(async () => {
  resetWsTokenStore();
  await closeDb();
  vi.restoreAllMocks();
});

describe("GameServer quest flow (WS)", () => {
  it("zone_state carries quests, interact with Pip offers the quest, accept activates it", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "ws-quest-user", username: "ws-quest-user", displayName: "WS Quest User", role: "Member" });
    const cls = (await getCharacterClasses())[0];
    const created = await createCharacter({ accountId: account.id, name: "WS Quest User", classId: cls.id, appearance: {}, cls });
    if (!created.ok) throw new Error("character creation failed");

    const server = makeServer(created.character.id, account.id);
    const socket = fakeSocket();
    await connectAndJoin(server, socket, created.character.id, account.id);

    // 1. zone_state carries the seeded tutorial quests.
    const state = lastOfType(socket, "zone_state");
    const quests = (state as { quests?: Array<{ questId: string; state: string }> }).quests ?? [];
    expect(quests.map((q) => q.questId)).toContain("quest-village-welcome");
    expect(quests.find((q) => q.questId === "quest-village-welcome")?.state).toBe("available");

    // 2. interact with Pip → npc_interaction with the offer (no error).
    await server.onMessage(socket, JSON.stringify({ type: "interact", targetId: "npc-pip", kind: "npc" }));
    const npc = lastOfType(socket, "npc_interaction");
    expect(npc).toBeDefined();
    expect(npc).toMatchObject({ npcId: "npc-pip" });
    expect((npc as { quests?: Array<{ questId: string }> }).quests?.map((q) => q.questId)).toContain("quest-village-welcome");

    // 3. accept the offered quest → quest_updated (active) + inventory_updated.
    await server.onMessage(socket, JSON.stringify({ type: "accept_quest", questId: "quest-village-welcome" }));
    const updated = lastOfType(socket, "quest_updated");
    expect(updated).toBeDefined();
    expect(updated).toMatchObject({ action: "accepted" });
    expect((updated as { quest: { questId: string; state: string } }).quest).toMatchObject({ questId: "quest-village-welcome", state: "active" });
  });

  it("equips and unequips JSON-authored gear through authoritative WS transactions", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "ws-equipment-user", username: "ws-equipment-user", displayName: "WS Equipment User", role: "Member" });
    const cls = (await getCharacterClasses())[0];
    const created = await createCharacter({ accountId: account.id, name: "WS Equipment User", classId: cls.id, appearance: {}, cls });
    if (!created.ok) throw new Error("character creation failed");
    await grantInventoryItems(created.character.id, [{ itemKey: "item-training-blade", quantity: 1 }]);

    const server = makeServer(created.character.id, account.id);
    const socket = fakeSocket();
    await connectAndJoin(server, socket, created.character.id, account.id);
    const blade = getInventoryState(created.character.id).items.find((item) => item.itemKey === "item-training-blade");
    if (blade === undefined) throw new Error("gear grant failed");

    await server.onMessage(socket, JSON.stringify({ type: "equip_item", itemInstanceId: blade.itemInstanceId, slot: "weapon" }));
    const equipped = lastOfType(socket, "inventory_updated");
    expect(equipped).toMatchObject({ type: "inventory_updated", message: "Weapon equipped." });
    expect((equipped as { equipment: Array<{ slot: string }> }).equipment.map((item) => item.slot)).toContain("weapon");
    expect((equipped as { stats: { attack: number } }).stats.attack).toBe(cls.base_stats.attack + 3);

    await server.onMessage(socket, JSON.stringify({ type: "unequip_item", slot: "weapon" }));
    expect(lastOfType(socket, "inventory_updated")).toMatchObject({ message: "Weapon unequipped." });
  });

  it("a delivery frame carries the progression the server just wrote", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "ws-delivery-user", username: "ws-delivery-user", displayName: "WS Delivery User", role: "Member" });
    const cls = (await getCharacterClasses())[0];
    const created = await createCharacter({ accountId: account.id, name: "WS Delivery User", classId: cls.id, appearance: {}, cls });
    if (!created.ok) throw new Error("character creation failed");

    const server = makeServer(created.character.id, account.id);
    const socket = fakeSocket();
    await connectAndJoin(server, socket, created.character.id, account.id);
    const player = (server as unknown as { zones: { get: (z: string, c: number) => { pos: { x: number; y: number } } | null } }).zones.get(ZONE, created.character.id);

    await server.onMessage(socket, JSON.stringify({ type: "accept_quest", questId: "quest-village-welcome" }));
    expect(lastOfType(socket, "quest_updated")).toMatchObject({ action: "accepted" });
    // Accepting awards nothing, so it carries no progression block at all.
    expect(lastOfType(socket, "quest_updated")).not.toHaveProperty("progression");

    if (player) player.pos = { ...BISCUIT_TILE };
    await server.onMessage(socket, JSON.stringify({ type: "interact", targetId: "npc-biscuit", kind: "npc" }));

    // The HUD reads level/rank straight off this frame — the first delivery
    // crosses no level, so it reports level 1 with zero levels gained.
    expect(lastOfType(socket, "quest_updated")).toMatchObject({
      action: "delivery",
      stamps: 8,
      xp: 40,
      progression: {
        level: 1,
        previousLevel: 1,
        levelsGained: 0,
        experience: 40,
        courierRank: "Trainee",
        rankPromotion: null,
      },
    });
  });

  it("interact with an out-of-range NPC is rejected with OUT_OF_RANGE", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "ws-quest-user2", username: "ws-quest-user2", displayName: "WS Quest User 2", role: "Member" });
    const cls = (await getCharacterClasses())[0];
    const created = await createCharacter({ accountId: account.id, name: "WS Quest User 2", classId: cls.id, appearance: {}, cls });
    if (!created.ok) throw new Error("character creation failed");

    // Player far from Pip → out of range.
    const server = makeServer(created.character.id, account.id);
    const socket = fakeSocket();
    await connectAndJoin(server, socket, created.character.id, account.id);
    const player = (server as unknown as { zones: { get: (z: string, c: number) => { pos: { x: number; y: number } } | null } }).zones.get(ZONE, created.character.id);
    if (player) { player.pos = { x: 0, y: 0 }; }

    await server.onMessage(socket, JSON.stringify({ type: "interact", targetId: "npc-pip", kind: "npc" }));
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({ code: "OUT_OF_RANGE", requestType: "interact" });
  });
});
