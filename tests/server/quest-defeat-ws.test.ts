import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/src/config/index.ts", () => ({
  server: { port: 3001, host: "0.0.0.0", nodeEnv: "testing", isDev: true, corsAllowedOrigins: [], debug: false },
  db: { file: ":memory:" },
  auth: { jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x", accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800, bcryptRounds: 4 },
  oidc: { clientId: "test", redirectUri: "http://localhost/callback", scopes: "openid", discoveryUrl: "https://test/.well-known", issuer: "https://test", jwksTtlSeconds: 600 },
  ai: { enabled: false, port: 3101, modelPath: "", mmprojPath: "", idleMs: 600000, warmupTimeoutMs: 90000, requestTimeoutMs: 4000, monsterDecisionIntervalMs: 5000, maxTokensMonster: 40, maxTokensNpc: 160, npcTalkMinIntervalMs: 6000 },
  admin: { roleTiers: {} },
}));

import type { ZoneData } from "../../server/src/ws/zoneData.ts";
import { GameServer, type SocketLike } from "../../server/src/ws/gameServer.ts";
import { issueWsToken, resetWsTokenStore } from "../../server/src/ws/tokenStore.ts";
import { resetGameplayRatesCache } from "../../server/src/models/GameplayRates.ts";

beforeEach(() => {
  resetGameplayRatesCache();
  resetWsTokenStore();
});

afterEach(() => {
  vi.useRealTimers();
  resetGameplayRatesCache();
});

const BOAR_DEF = {
  id: 1,
  key: "monster-wild-boar",
  display_name: "Wild Boar",
  zone_id: 2,
  family_id: "happy-valley",
  level_min: 2,
  level_max: 3,
  max_hp: 55,
  attack: 9,
  defense: 6,
  speed: 120,
  aggro_behavior: "aggro" as const,
  attack_behavior: "melee" as const,
  loot_table: [],
  respawn_seconds: 30,
  experience_reward: 20,
};

const COMBAT_ZONE: ZoneData = {
  zoneId: "zone-combat",
  width: 7,
  height: 7,
  spawn: { x: 3, y: 3 },
  isWalkable: () => true,
  monsterSpawns: [{ id: "spawn-boar", key: "monster-wild-boar", x: 4, y: 4 }],
  maxPlayers: 32,
  transitions: [],
};

const CHARACTERS = new Map<number, { accountId: number; name: string }>([
  [11, { accountId: 8, name: "Killer" }],
  [12, { accountId: 9, name: "Bystander" }],
]);

interface FakeSocket extends SocketLike {
  sent: { type?: string; [key: string]: unknown }[];
}

function fakeSocket(): FakeSocket {
  return {
    sent: [],
    send(payload: unknown) { this.sent.push(JSON.parse(JSON.stringify(payload))); },
    close() {},
  };
}

async function join(server: GameServer, socket: FakeSocket, characterId: number): Promise<void> {
  server.registerSocket(socket);
  const token = issueWsToken(CHARACTERS.get(characterId)?.accountId ?? 0, characterId);
  await server.onMessage(socket, JSON.stringify({ type: "authenticate", token }));
  await server.onMessage(socket, JSON.stringify({ type: "join_zone", zoneId: COMBAT_ZONE.zoneId }));
}

describe("kill-count credit over WS", () => {
  it("credits the killing courier only and pushes a progress quest_updated to them", async () => {
    vi.useFakeTimers();
    const progress = {
      ok: true as const,
      quest: { questId: "quest-moss-burrow-boars", state: "active", progress: 1, requiredQuantity: 4 },
      quests: [],
      inventory: [],
      stamps: 0,
      xp: 0,
      message: "Wild Boar 1/4",
    };
    const recordMonsterDefeat = vi.fn(async () => progress);
    const server = new GameServer({
      loadCharacter: async (id: number) => {
        const character = CHARACTERS.get(id);
        return character === undefined ? null : {
          characterId: id, accountId: character.accountId, name: character.name, classKey: "fox-archer",
          zoneId: COMBAT_ZONE.zoneId, pos: { x: 1, y: 1 }, hp: 100, maxHp: 100,
          attack: 20, defense: 5, speed: 150, critChance: 100, critMultiplier: 2.0,
        };
      },
      getZoneData: (zoneId: string) => (zoneId === COMBAT_ZONE.zoneId ? COMBAT_ZONE : null),
      getMonsterDefinitions: async () => [BOAR_DEF],
      persistPosition: async () => {},
      grantXp: async () => null,
      grantInventory: async () => {},
      persistHp: async () => {},
      recordMonsterDefeat,
      tickMs: 1000,
      graceMs: 60_000,
      minMoveIntervalMs: 0,
    } as unknown as ConstructorParameters<typeof GameServer>[0]);
    const killer = fakeSocket();
    const bystander = fakeSocket();
    await join(server, killer, 11);
    await join(server, bystander, 12);

    await server.onMessage(killer, JSON.stringify({ type: "attack", targetEntityId: "spawn-boar" }));
    vi.setSystemTime(Date.now() + 2500);
    await server.onMessage(killer, JSON.stringify({ type: "attack", targetEntityId: "spawn-boar" }));
    // Rewards resolve on a detached promise chain after the lethal hit.
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();

    expect(recordMonsterDefeat).toHaveBeenCalledTimes(1);
    expect(recordMonsterDefeat).toHaveBeenCalledWith(11, "monster-wild-boar");
    expect(killer.sent.filter((frame) => frame.type === "quest_updated")).toEqual([
      expect.objectContaining({ action: "progress", message: "Wild Boar 1/4" }),
    ]);
    expect(bystander.sent.some((frame) => frame.type === "quest_updated")).toBe(false);
  });
});
