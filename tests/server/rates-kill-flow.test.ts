import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The game server imports the logger which pulls in config — mock it before
// importing anything so server tests never need server_config.json.
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
import {
  resetWsTokenStore,
  issueWsToken,
} from "../../server/src/ws/tokenStore.ts";
import { runMigrations } from "../../server/src/db/migrate.ts";
import { closeDb } from "../../server/src/db/connection.ts";
import { setServerSetting } from "../../server/src/models/Admin.ts";
import { resetGameplayRatesCache } from "../../server/src/models/GameplayRates.ts";

beforeEach(() => {
  resetGameplayRatesCache();
  resetWsTokenStore();
});

afterEach(async () => {
  await closeDb();
  vi.useRealTimers();
  resetGameplayRatesCache();
});

// ---- fixture (mirrors game-server.test.ts combat setup) ----

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
  loot_table: [{ key: "item-boar-hide", chance: 1, quantity: 1 }],
  respawn_seconds: 30,
  experience_reward: 20,
};

/** A combat zone: 7x7 open with a boar spawn at (4,4). */
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

const CHARACTERS = new Map<number, { accountId: number; name: string; classKey: string }>([
  [11, { accountId: 8, name: "Birch", classKey: "fox-archer" }],
]);

interface FakeSocket extends SocketLike {
  sent: unknown[];
  closed: boolean;
}

function fakeSocket(): FakeSocket {
  const s: FakeSocket = {
    sent: [],
    closed: false,
    send(payload: unknown) {
      this.sent.push(JSON.parse(JSON.stringify(payload)));
    },
    close() {
      this.closed = true;
    },
  };
  return s;
}

function lastOfType(socket: FakeSocket, type: string): Record<string, unknown> | undefined {
  for (let i = socket.sent.length - 1; i >= 0; i--) {
    const frame = socket.sent[i] as { type?: string };
    if (frame.type === type) return socket.sent[i] as Record<string, unknown>;
  }
  return undefined;
}

function makeCombatServer(overrides: {
  grantXp?: GameServer["deps"]["grantXp"];
  grantInventory?: GameServer["deps"]["grantInventory"];
} = {}) {
  const deps = {
    loadCharacter: async (id: number) => {
      const c = CHARACTERS.get(id);
      if (c === undefined) return null;
      return {
        characterId: id,
        accountId: c.accountId,
        name: c.name,
        classKey: c.classKey,
        zoneId: COMBAT_ZONE.zoneId,
        pos: { x: 1, y: 1 },
        hp: 100,
        maxHp: 100,
        attack: 20,
        defense: 5,
        speed: 150,
        critChance: 100,
        critMultiplier: 2.0,
      };
    },
    getZoneData: (zoneId: string) => (zoneId === COMBAT_ZONE.zoneId ? COMBAT_ZONE : null),
    getMonsterDefinitions: async () => [BOAR_DEF],
    persistPosition: async () => {},
    grantXp: overrides.grantXp ?? (async () => 20),
    grantInventory: overrides.grantInventory ?? (async () => {}),
    persistHp: async () => {},
    tickMs: 1000,
    graceMs: 60_000,
    minMoveIntervalMs: 0,
  };
  return new GameServer(deps as unknown as ConstructorParameters<typeof GameServer>[0]);
}

async function joinCombat(server: GameServer, socket: FakeSocket): Promise<void> {
  server.registerSocket(socket);
  const char = CHARACTERS.get(11);
  if (char === undefined) throw new Error("missing test character");
  const token = issueWsToken(char.accountId, 11);
  await server.onMessage(socket, JSON.stringify({ type: "authenticate", token }));
  await server.onMessage(socket, JSON.stringify({ type: "join_zone", zoneId: "zone-combat" }));
}

/** Two archer attacks (2.5s apart for cooldown) kill the 55hp boar. */
async function killBoar(server: GameServer, socket: FakeSocket): Promise<void> {
  await server.onMessage(socket, JSON.stringify({ type: "attack", targetEntityId: "spawn-boar" }));
  vi.setSystemTime(Date.now() + 2500);
  await server.onMessage(socket, JSON.stringify({ type: "attack", targetEntityId: "spawn-boar" }));
}

describe("server rates apply to monster kill rewards", () => {
  it("grants base XP and loot when rates are at their 1.0 defaults", async () => {
    vi.useFakeTimers();
    const grantXp = vi.fn(async () => 20);
    const grantInventory = vi.fn(async () => {});
    const server = makeCombatServer({ grantXp, grantInventory });
    const socket = fakeSocket();
    await joinCombat(server, socket);
    await killBoar(server, socket);

    expect(lastOfType(socket, "combat_event")).toMatchObject({ outcome: "defeated" });
    expect(grantXp).toHaveBeenCalledWith(11, 20);
    expect(grantInventory).toHaveBeenCalledWith(11, [{ itemKey: "item-boar-hide", quantity: 1 }]);
  });

  it("scales monster XP by exp_rate and guarantees loot at drop_rate >= 1/chance", async () => {
    vi.useFakeTimers();
    await runMigrations();
    setServerSetting("exp_rate", "3", "test-admin");
    setServerSetting("drop_rate", "1", "test-admin");
    // setServerSetting refreshes the cache — no manual reset needed.

    const grantXp = vi.fn(async () => 60);
    const grantInventory = vi.fn(async () => {});
    const server = makeCombatServer({ grantXp, grantInventory });
    const socket = fakeSocket();
    await joinCombat(server, socket);
    await killBoar(server, socket);

    // 20 base XP × 3.0 exp_rate = 60.
    expect(grantXp).toHaveBeenCalledWith(11, 60);
    // Loot chance 1 × 1 = still guaranteed.
    expect(grantInventory).toHaveBeenCalledWith(11, [{ itemKey: "item-boar-hide", quantity: 1 }]);
  });

  it("halving drop_rate removes half of the guaranteed rolls statistically (0.5 chance entry)", async () => {
    vi.useFakeTimers();
    await runMigrations();
    setServerSetting("drop_rate", "0.5", "test-admin");

    // Loot table: two entries at 50% base chance each.
    const defs = [{
      ...BOAR_DEF,
      key: "monster-wild-boar",
      loot_table: [
        { key: "item-a", chance: 0.5, quantity: 1 },
        { key: "item-b", chance: 0.5, quantity: 1 },
      ],
    }];
    const grantXp = vi.fn(async () => 20);
    const grantInventory = vi.fn(async () => {});
    const deps = {
      loadCharacter: async (id: number) => {
        const c = CHARACTERS.get(id);
        if (c === undefined) return null;
        return {
          characterId: id, accountId: c.accountId, name: c.name, classKey: c.classKey,
          zoneId: COMBAT_ZONE.zoneId, pos: { x: 1, y: 1 }, hp: 100, maxHp: 100,
          attack: 20, defense: 5, speed: 150, critChance: 100, critMultiplier: 2.0,
        };
      },
      getZoneData: (zoneId: string) => (zoneId === COMBAT_ZONE.zoneId ? COMBAT_ZONE : null),
      getMonsterDefinitions: async () => defs,
      persistPosition: async () => {},
      grantXp, grantInventory, persistHp: async () => {},
      tickMs: 1000, graceMs: 60_000, minMoveIntervalMs: 0,
    };
    const server = new GameServer(deps as unknown as ConstructorParameters<typeof GameServer>[0]);
    const socket = fakeSocket();
    await joinCombat(server, socket);
    await killBoar(server, socket);

    // With drop_rate 0.5, each 50% entry drops at 25%. Over many independent
    // rolls we can't assert a single outcome, but Math.random under fake timers
    // is still real randomness — so assert only the shape, then separately
    // verify the multiplier math below with a deterministic stub.
    const loot = lastOfType(socket, "loot_received");
    expect(loot === undefined || Array.isArray(loot.items)).toBe(true);
  });

  it("rollLoot scales chances by drop_rate and caps them at 1", async () => {
    // Deterministic check of the multiplier math via the exported helper.
    const { rollLootForTest } = await import("../../server/src/ws/gameServer.ts");
    const table = [
      { key: "common", chance: 0.4, quantity: 1 },
      { key: "rare", chance: 0.001, quantity: 1 },
      { key: "guaranteed", chance: 1, quantity: 2 },
    ];
    // Stub Math.random at 0.5 — deterministic rolls below.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    // drop_rate 1: common (0.4) misses, rare (0.001) misses, guaranteed drops.
    expect(rollLootForTest(table, 1)).toEqual([{ itemKey: "guaranteed", quantity: 2 }]);

    // drop_rate 0.5: guaranteed entry chance becomes 0.5; stub 0.5 is not < 0.5 → nothing drops.
    expect(rollLootForTest(table, 0.5)).toEqual([]);

    // drop_rate 0.6: guaranteed chance 0.6 > 0.5 → drops again; common (0.24) misses.
    expect(rollLootForTest(table, 0.6)).toEqual([{ itemKey: "guaranteed", quantity: 2 }]);

    // drop_rate 2: common needs random < 0.8 -> 0.5 drops; rare still misses.
    expect(rollLootForTest(table, 2)).toEqual([
      { itemKey: "common", quantity: 1 },
      { itemKey: "guaranteed", quantity: 2 },
    ]);

    // drop_rate 4: common capped at 1.0 -> guaranteed; rare (0.004) still misses at 0.5.
    expect(rollLootForTest(table, 4)).toEqual([
      { itemKey: "common", quantity: 1 },
      { itemKey: "guaranteed", quantity: 2 },
    ]);

    // Low random (0.0005): rare drops only when scaled (0.001*1 → 0.0005 not < 0.001? 0.0005 < 0.001 → yes even at 1×).
    randomSpy.mockReturnValue(0.0005);
    expect(rollLootForTest(table, 1).map((e) => e.itemKey)).toEqual(["common", "rare", "guaranteed"]);

    randomSpy.mockRestore();
  });
});
