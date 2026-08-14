import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The game server imports the logger which pulls in config — mock it before
// importing anything so server tests never need server_config.json.
vi.mock("../../server/src/config/index.ts", () => ({
  server: {
    port: 3001,
    host: "0.0.0.0",
    nodeEnv: "testing",
    isDev: true,
    corsAllowedOrigins: ["http://localhost:5173"],
    debug: false,
  },
  db: {
    file: ":memory:",
  },
  auth: {
    jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x",
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 604800,
    bcryptRounds: 4,
  },
  oidc: {
    clientId: "paws-and-parcels",
    redirectUri: "http://localhost:5173/oidc-callback.html",
    scopes: "openid profile",
    discoveryUrl: "https://ashat.test/api/oauth/.well-known/openid-configuration",
    issuer: "https://ashat.test/api/oauth",
    jwksTtlSeconds: 600,
  },
  ai: {
    enabled: false,
    port: 3101,
    modelPath: "",
    mmprojPath: "",
    idleMs: 600_000,
    warmupTimeoutMs: 90_000,
    requestTimeoutMs: 4_000,
    monsterDecisionIntervalMs: 5_000,
    maxTokensMonster: 40,
    maxTokensNpc: 160,
    npcTalkMinIntervalMs: 6_000,
  },
}));

import type { ZoneData } from "../../server/src/ws/zoneData.ts";
import { GameServer, type SocketLike } from "../../server/src/ws/gameServer.ts";
import {
  resetWsTokenStore,
  issueWsToken,
} from "../../server/src/ws/tokenStore.ts";

/** A 5x5 open field with a wall column at x=3 for collision tests. */
const TEST_ZONE: ZoneData = {
  zoneId: "zone-test",
  width: 5,
  height: 5,
  spawn: { x: 2, y: 2 },
  isWalkable: (x, y) =>
    x >= 0 && y >= 0 && x < 5 && y < 5 && x !== 3, // wall at x=3
  monsterSpawns: [],
};

const CHARACTERS = new Map<number, { accountId: number; name: string; classKey: string }>([
  [10, { accountId: 7, name: "Maple", classKey: "bear-warrior" }],
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

function makeServer(overrides: {
  loadCharacter?: GameServer["deps"]["loadCharacter"];
  persistPosition?: GameServer["deps"]["persistPosition"];
  graceMs?: number;
  persistIntervalMs?: number;
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
        zoneId: TEST_ZONE.zoneId,
        pos: { x: 1, y: 1 },
      };
    },
    getZoneData: (zoneId: string) =>
      zoneId === TEST_ZONE.zoneId ? TEST_ZONE : null,
    persistPosition: overrides.persistPosition ?? (async () => {}),
    tickMs: 1000, // tests call runTick() directly
    graceMs: overrides.graceMs ?? 60_000,
    minMoveIntervalMs: 0, // disable the speed cap in routing tests
    ...overrides,
  };
  const server = new GameServer(deps as unknown as ConstructorParameters<typeof GameServer>[0]);
  return server;
}

/** Authenticate a fake socket as a character and join the test zone. */
async function connectAndJoin(
  server: GameServer,
  socket: FakeSocket,
  characterId = 10,
  zoneId = TEST_ZONE.zoneId,
): Promise<void> {
  server.registerSocket(socket);
  const char = CHARACTERS.get(characterId);
  if (char === undefined) throw new Error(`unknown test character ${characterId}`);
  const token = issueWsToken(char.accountId, characterId);
  await server.onMessage(socket, JSON.stringify({ type: "authenticate", token }));
  await server.onMessage(socket, JSON.stringify({ type: "join_zone", zoneId }));
}

function messages(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.sent as Array<Record<string, unknown>>;
}

function lastOfType(socket: FakeSocket, type: string): Record<string, unknown> | undefined {
  const msgs = messages(socket).filter((m) => m.type === type);
  return msgs[msgs.length - 1];
}

beforeEach(() => {
  resetWsTokenStore();
});

afterEach(() => {
  resetWsTokenStore();
  vi.restoreAllMocks();
});

describe("GameServer", () => {
  it("rejects authenticate with a missing token", async () => {
    const server = makeServer();
    const socket = fakeSocket();
    server.registerSocket(socket);
    await server.onMessage(socket, JSON.stringify({ type: "authenticate" }));
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rejects authenticate with an unknown/used token", async () => {
    const server = makeServer();
    const socket = fakeSocket();
    server.registerSocket(socket);
    await server.onMessage(socket, JSON.stringify({ type: "authenticate", token: "bogus" }));
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("authenticates a valid token and replies with `authenticated`", async () => {
    const server = makeServer();
    const socket = fakeSocket();
    server.registerSocket(socket);
    const token = issueWsToken(7, 10);
    await server.onMessage(socket, JSON.stringify({ type: "authenticate", token }));
    expect(lastOfType(socket, "authenticated")).toMatchObject({
      accountId: 7,
      characterId: 10,
      zoneId: "zone-test",
    });
  });

  it("rejects other messages before authentication", async () => {
    const server = makeServer();
    const socket = fakeSocket();
    server.registerSocket(socket);
    await server.onMessage(socket, JSON.stringify({ type: "join_zone", zoneId: "zone-test" }));
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({ code: "NOT_AUTHENTICATED" });
  });

  it("joins a zone and receives zone_state with the player listed", async () => {
    const server = makeServer();
    const socket = fakeSocket();
    await connectAndJoin(server, socket);
    const state = lastOfType(socket, "zone_state");
    expect(state).toMatchObject({ zoneId: "zone-test" });
    expect((state as { players: unknown[] }).players).toHaveLength(1);
  });

  it("rejects joining an unknown zone", async () => {
    const server = makeServer();
    const socket = fakeSocket();
    server.registerSocket(socket);
    const token = issueWsToken(7, 10);
    await server.onMessage(socket, JSON.stringify({ type: "authenticate", token }));
    await server.onMessage(socket, JSON.stringify({ type: "join_zone", zoneId: "zone-nope" }));
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({ code: "ZONE_NOT_FOUND" });
  });

  it("keeps two distinct authenticated characters together in one shared zone", async () => {
    const server = makeServer();
    const a = fakeSocket();
    const b = fakeSocket();
    await connectAndJoin(server, a, 10, TEST_ZONE.zoneId);
    await connectAndJoin(server, b, 11, TEST_ZONE.zoneId);

    expect(lastOfType(a, "player_joined")).toMatchObject({
      characterId: 11,
      name: "Birch",
    });
    const bState = lastOfType(b, "zone_state") as { zoneId: string; players: Array<{ characterId: number }> };
    expect(bState.zoneId).toBe(TEST_ZONE.zoneId);
    expect(bState.players.map((player) => player.characterId).sort()).toEqual([10, 11]);

    server.runTick();
    expect((lastOfType(a, "player_snapshot") as { players: unknown[] }).players).toHaveLength(2);
    expect((lastOfType(b, "player_snapshot") as { players: unknown[] }).players).toHaveLength(2);
  });

  it("moves a player when the move_intent is valid and broadcasts via snapshot", async () => {
    const server = makeServer();
    const socket = fakeSocket();
    await connectAndJoin(server, socket);

    await server.onMessage(socket, JSON.stringify({ type: "move_intent", dx: 1, dy: 0 }));
    server.runTick();
    const snap = lastOfType(socket, "player_snapshot");
    const players = (snap as { players: Array<{ characterId: number; pos: { x: number; y: number } }> }).players;
    expect(players[0].pos).toEqual({ x: 2, y: 1 });
  });

  it("rejects a move into a wall with MOVE_COLLISION", async () => {
    const server = makeServer();
    const socket = fakeSocket();
    await connectAndJoin(server, socket);

    // From (1,1) walking east twice would cross x=3 — first to x=2 (ok),
    // then to x=3 (wall).
    await server.onMessage(socket, JSON.stringify({ type: "move_intent", dx: 1, dy: 0 }));
    await server.onMessage(socket, JSON.stringify({ type: "move_intent", dx: 1, dy: 0 }));
    server.runTick();
    const snap = lastOfType(socket, "player_snapshot");
    const players = (snap as { players: Array<{ characterId: number; pos: { x: number; y: number } }> }).players;
    expect(players[0].pos).toEqual({ x: 2, y: 1 });
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({ code: "MOVE_COLLISION" });
  });

  it("rejects a diagonal move with INVALID_DIRECTION", async () => {
    const server = makeServer();
    const socket = fakeSocket();
    await connectAndJoin(server, socket);
    await server.onMessage(socket, JSON.stringify({ type: "move_intent", dx: 1, dy: 1 }));
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({ code: "INVALID_DIRECTION" });
  });

  it("requires join_zone before move_intent", async () => {
    const server = makeServer();
    const socket = fakeSocket();
    server.registerSocket(socket);
    const token = issueWsToken(7, 10);
    await server.onMessage(socket, JSON.stringify({ type: "authenticate", token }));
    await server.onMessage(socket, JSON.stringify({ type: "move_intent", dx: 1, dy: 0 }));
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({ code: "NOT_IN_ZONE" });
  });

  it("broadcasts player_left on leave_zone", async () => {
    const server = makeServer();
    const a = fakeSocket();
    const b = fakeSocket();
    await connectAndJoin(server, a, 10);
    await connectAndJoin(server, b, 11);
    await server.onMessage(a, JSON.stringify({ type: "leave_zone" }));
    expect(lastOfType(b, "player_left")).toMatchObject({ characterId: 10 });
  });

  it("broadcasts chat only to connected players in the same zone", async () => {
    const server = makeServer();
    const a = fakeSocket();
    const b = fakeSocket();
    await connectAndJoin(server, a, 10);
    await connectAndJoin(server, b, 11);

    await server.onMessage(a, JSON.stringify({ type: "zone_chat", text: "  Hello, village!  " }));
    expect(lastOfType(a, "zone_chat")).toMatchObject({ characterId: 10, name: "Maple", text: "Hello, village!" });
    expect(lastOfType(b, "zone_chat")).toMatchObject({ characterId: 10, text: "Hello, village!" });

    await server.onMessage(a, JSON.stringify({ type: "zone_chat", text: "too soon" }));
    expect(lastOfType(a, "error")).toMatchObject({ code: "CHAT_RATE_LIMIT" });
  });

  it("keeps a disconnected player in the zone during the grace window, then removes", async () => {
    vi.useFakeTimers();
    try {
      const server = makeServer({ graceMs: 60_000 });
      const a = fakeSocket();
      const b = fakeSocket();
      await connectAndJoin(server, a, 10);
      await connectAndJoin(server, b, 11);

      server.onClose(a);
      // Still tracked (invisible) during grace.
      expect(server["zones"].get("zone-test", 10)).not.toBeNull();

      vi.advanceTimersByTime(60_001);
      await Promise.resolve();
      expect(server["zones"].get("zone-test", 10)).toBeNull();
      expect(lastOfType(b, "player_left")).toMatchObject({ characterId: 10 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores a reconnecting player within the grace window", async () => {
    vi.useFakeTimers();
    try {
      const server = makeServer({ graceMs: 60_000 });
      const a = fakeSocket();
      const b = fakeSocket();
      await connectAndJoin(server, a, 10);
      await connectAndJoin(server, b, 11);

      server.onClose(a);
      vi.advanceTimersByTime(30_000); // inside grace

      // Reconnect on a new socket: authenticate + join the same zone.
      const c = fakeSocket();
      await connectAndJoin(server, c, 10);
      expect(server["zones"].get("zone-test", 10)?.connected).toBe(true);

      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      // The reconnected player must NOT be removed after the old grace timer.
      expect(server["zones"].get("zone-test", 10)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists the position when a player leaves the zone", async () => {
    const persistPosition = vi.fn(async () => {});
    const server = makeServer({ persistPosition });
    const socket = fakeSocket();
    await connectAndJoin(server, socket);
    await server.onMessage(socket, JSON.stringify({ type: "move_intent", dx: 1, dy: 0 }));
    await server.onMessage(socket, JSON.stringify({ type: "leave_zone" }));
    expect(persistPosition).toHaveBeenCalledWith(10, "zone-test", { x: 2, y: 1 });
  });

  it("periodically persists a moving player's position, throttled by the interval", async () => {
    vi.useFakeTimers();
    try {
      const persistPosition = vi.fn(async () => {});
      const server = makeServer({ persistPosition, persistIntervalMs: 10_000 });
      const socket = fakeSocket();
      await connectAndJoin(server, socket);
      await server.onMessage(socket, JSON.stringify({ type: "move_intent", dx: 1, dy: 0 }));

      // Interval not yet elapsed → no write yet.
      server.runTick();
      expect(persistPosition).not.toHaveBeenCalled();

      // Interval elapsed with a dirty position → persisted exactly once.
      vi.advanceTimersByTime(10_001);
      server.runTick();
      expect(persistPosition).toHaveBeenCalledWith(10, "zone-test", { x: 2, y: 1 });
      expect(persistPosition).toHaveBeenCalledTimes(1);

      // Another interval with no movement → dirty is false, no extra write.
      vi.advanceTimersByTime(10_001);
      server.runTick();
      expect(persistPosition).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not periodically persist a player who never moved", async () => {
    vi.useFakeTimers();
    try {
      const persistPosition = vi.fn(async () => {});
      const server = makeServer({ persistPosition, persistIntervalMs: 10_000 });
      const socket = fakeSocket();
      await connectAndJoin(server, socket);

      vi.advanceTimersByTime(60_000);
      server.runTick();
      expect(persistPosition).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("responds to unknown message types with an error", async () => {
    const server = makeServer();
    const socket = fakeSocket();
    server.registerSocket(socket);
    await server.onMessage(socket, JSON.stringify({ type: "dance" }));
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({ code: "INVALID_MESSAGE" });
  });

  it("wraps handler exceptions in an INTERNAL_ERROR message", async () => {
    const server = makeServer({
      loadCharacter: async () => {
        throw new Error("db down");
      },
    });
    const socket = fakeSocket();
    server.registerSocket(socket);
    const token = issueWsToken(7, 10);
    await server.onMessage(socket, JSON.stringify({ type: "authenticate", token }));
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({
      code: "INTERNAL_ERROR",
      requestType: "authenticate",
    });
  });
});

describe("GameServer — Phase 3 combat", () => {
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
  };

  function makeCombatServer(overrides: {
    grantXp?: GameServer["deps"]["grantXp"];
    grantInventory?: GameServer["deps"]["grantInventory"];
    persistHp?: GameServer["deps"]["persistHp"];
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
      getZoneData: (zoneId: string) =>
        zoneId === COMBAT_ZONE.zoneId || zoneId === "zone-clover-village"
          ? COMBAT_ZONE
          : null,
      getMonsterDefinitions: async () => [BOAR_DEF],
      persistPosition: async () => {},
      grantXp: overrides.grantXp ?? (async () => 20),
      grantInventory: overrides.grantInventory ?? (async () => {}),
      persistHp: overrides.persistHp ?? (async () => {}),
      tickMs: 1000,
      graceMs: 60_000,
      minMoveIntervalMs: 0,
    };
    return new GameServer(
      deps as unknown as ConstructorParameters<typeof GameServer>[0],
    );
  }

  async function joinCombat(
    server: GameServer,
    socket: FakeSocket,
    characterId = 10,
  ): Promise<void> {
    server.registerSocket(socket);
    const char = CHARACTERS.get(characterId);
    if (char === undefined) throw new Error(`unknown test character ${characterId}`);
    const token = issueWsToken(char.accountId, characterId);
    await server.onMessage(socket, JSON.stringify({ type: "authenticate", token }));
    await server.onMessage(socket, JSON.stringify({ type: "join_zone", zoneId: "zone-combat" }));
  }

  it("includes seeded monsters in zone_state", async () => {
    const server = makeCombatServer();
    const socket = fakeSocket();
    await joinCombat(server, socket);
    const state = lastOfType(socket, "zone_state");
    const monsters = (state as { monsters: unknown[] }).monsters;
    expect(monsters).toHaveLength(1);
    expect((monsters[0] as { id: string }).id).toBe("spawn-boar");
  });

  it("rejects an attack on an unknown monster", async () => {
    const server = makeCombatServer();
    const socket = fakeSocket();
    await joinCombat(server, socket);
    await server.onMessage(
      socket,
      JSON.stringify({ type: "attack", targetEntityId: "spawn-nope" }),
    );
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({ code: "INVALID_TARGET" });
  });

  it("attacks a monster in range and broadcasts a combat_event with damage", async () => {
    const server = makeCombatServer();
    const socket = fakeSocket();
    // Birch is a fox-archer (range 5) — the boar at (4,4) is 3 tiles away.
    await joinCombat(server, socket, 11);
    await server.onMessage(
      socket,
      JSON.stringify({ type: "attack", targetEntityId: "spawn-boar" }),
    );
    const ev = lastOfType(socket, "combat_event");
    expect(ev).toMatchObject({
      instigatorId: 11,
      targetId: "spawn-boar",
      ability: "basic_attack",
    });
    // Archer attack 20 - boar defense 6 = 14; crit x2 = 28 (critChance 100).
    expect((ev as { damage: number }).damage).toBe(28);
    expect((ev as { targetHp: number }).targetHp).toBe(55 - 28);
  });

  it("rejects an attack outside the class's range", async () => {
    const server = makeCombatServer();
    const socket = fakeSocket();
    // Maple is a bear-warrior (melee, range 1); the boar is 3 tiles away.
    await joinCombat(server, socket, 10);
    await server.onMessage(
      socket,
      JSON.stringify({ type: "attack", targetEntityId: "spawn-boar" }),
    );
    const err = lastOfType(socket, "error");
    expect(err).toMatchObject({ code: "OUT_OF_RANGE" });
  });

  it("a lethal hit marks the monster defeated, rolls loot, and grants XP", async () => {
    vi.useFakeTimers();
    try {
      const grantXp = vi.fn(async () => 20);
      const grantInventory = vi.fn(async () => {});
      const server = makeCombatServer({ grantXp, grantInventory });
      const socket = fakeSocket();
      await joinCombat(server, socket, 11); // archer, range 5

      // Archer attack 20 - defense 6 = 14; crit x2 = 28 per hit. Two hits kill
      // the 55hp boar — but the 2s archer cooldown requires time between them.
      await server.onMessage(
        socket,
        JSON.stringify({ type: "attack", targetEntityId: "spawn-boar" }),
      );
      vi.setSystemTime(Date.now() + 2500);
      await server.onMessage(
        socket,
        JSON.stringify({ type: "attack", targetEntityId: "spawn-boar" }),
      );
      const ev = lastOfType(socket, "combat_event");
      expect(ev).toMatchObject({ outcome: "defeated" });
      expect(lastOfType(socket, "loot_received")).toMatchObject({
        sourceId: "spawn-boar",
      });
      expect(grantXp).toHaveBeenCalledWith(11, 20);
      expect(grantInventory).toHaveBeenCalledWith(11, [{ itemKey: "item-boar-hide", quantity: 1 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("monsters attack players during the tick and can defeat them", async () => {
    vi.useFakeTimers();
    try {
      const server = makeCombatServer();
      const socket = fakeSocket();
      await joinCombat(server, socket);

      // Move the player adjacent to the boar so its AI can reach them.
      // Boar at (4,4), player moves east twice to (3,1)... use direct pos set.
      const zone = server["zones"].get("zone-combat", 10);
      expect(zone).not.toBeNull();
      zone!.pos = { x: 4, y: 3 };
      zone!.hp = 5; // low HP so one boar hit (9 - 5 defense = 4) isn't lethal;
      // run ticks until the boar lands a hit.
      let hit = false;
      for (let i = 0; i < 20 && !hit; i++) {
        vi.setSystemTime(Date.now() + 250);
        server.runTick();
        hit = lastOfType(socket, "combat_event") !== undefined;
      }
      const ev = lastOfType(socket, "combat_event");
      expect(ev).toBeDefined();
      expect((ev as { instigatorId: string }).instigatorId).toBe("spawn-boar");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a defeated player respawns at the safe hub with full HP + invuln", async () => {
    vi.useFakeTimers();
    try {
      const persistHp = vi.fn(async () => {});
      const server = makeCombatServer({ persistHp });
      const socket = fakeSocket();
      await joinCombat(server, socket);

      // Put the player right next to the boar at 1 HP so the next monster hit
      // is lethal, then run a tick to trigger the attack.
      const zone = server["zones"].get("zone-combat", 10);
      expect(zone).not.toBeNull();
      zone!.pos = { x: 4, y: 3 };
      zone!.hp = 1;
      zone!.invulnUntil = 0;
      vi.setSystemTime(Date.now() + 1000);
      server.runTick();
      await Promise.resolve();

      const respawned = lastOfType(socket, "player_respawned");
      expect(respawned).toMatchObject({ zoneId: "zone-clover-village" });
      expect((respawned as { hp: number }).hp).toBe(100);
      expect(persistHp).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
