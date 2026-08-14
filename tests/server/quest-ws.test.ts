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
import { createCharacter } from "../../server/src/models/Character.ts";
import { getCharacterClasses } from "../../server/src/models/CharacterClass.ts";
import { acceptQuest, completeDelivery, getQuestInventory, getQuestState } from "../../server/src/models/Quest.ts";
import { GameServer, type SocketLike } from "../../server/src/ws/gameServer.ts";
import { issueWsToken, resetWsTokenStore } from "../../server/src/ws/tokenStore.ts";

const ZONE = "zone-clover-village";
const PIP_TILE = { x: 29, y: 31 };

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
    loadCharacter: async (id: number) => id === characterId
      ? { characterId: id, accountId, name: "Quest User", classKey: "bear-warrior", zoneId: ZONE, pos: { ...PIP_TILE }, hp: 100, maxHp: 100, attack: 5, defense: 5, speed: 4, critChance: 0.05, critMultiplier: 1.5 }
      : null,
    getZoneData: () => ({
      zoneId: ZONE, width: 100, height: 100, spawn: { x: 0, y: 0 },
      isWalkable: () => true, monsterSpawns: [],
    }),
    getNpcPosition: (npcId: string, zoneId: string) => (npcId === "npc-pip" && zoneId === ZONE ? { ...PIP_TILE } : null),
    getQuestState,
    acceptQuest,
    completeDelivery,
    getQuestInventory,
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
