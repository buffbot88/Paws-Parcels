import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the config loader before importing anything that uses it; the DB opens
// in memory so the model tests run the real migrations.
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

import { runMigrations } from "../../server/src/db/migrate.ts";
import { closeDb, getDb } from "../../server/src/db/connection.ts";
import { findOrCreateAccountByAshatId } from "../../server/src/models/Account.ts";
import {
  createCharacter,
  getCharacterById,
  getCharactersByAccountId,
  getCharacterWithClass,
  toPublicCharacter,
  updateCharacterAppearance,
} from "../../server/src/models/Character.ts";
import { getCharacterClasses } from "../../server/src/models/CharacterClass.ts";
import { normalizeAppearance } from "../../src/game/appearance.ts";
import { toClassKey } from "../../src/game/classStats.ts";
import type { ZoneData } from "../../server/src/ws/zoneData.ts";
import { GameServer, type SocketLike } from "../../server/src/ws/gameServer.ts";
import { issueWsToken, resetWsTokenStore } from "../../server/src/ws/tokenStore.ts";

const ZONE: ZoneData = {
  zoneId: "zone-test",
  width: 5,
  height: 5,
  spawn: { x: 2, y: 2 },
  isWalkable: (x, y) => x >= 0 && y >= 0 && x < 5 && y < 5,
  monsterSpawns: [],
  maxPlayers: 32,
  transitions: [],
};

const CHARACTERS = new Map<number, { accountId: number; name: string; classKey: string; appearance?: unknown }>([
  // Stored look carries a colour the bear body can't show (fur2) and an upper-case hex.
  [10, { accountId: 7, name: "Maple", classKey: "bear-warrior", appearance: { species: "panda", colors: { fur: "#ABCDEF", fur2: "#000000" } } }],
  // Legacy row: nothing saved yet.
  [11, { accountId: 8, name: "Birch", classKey: "fox-archer", appearance: {} }],
]);

interface FakeSocket extends SocketLike {
  sent: Array<Record<string, unknown>>;
}

function fakeSocket(): FakeSocket {
  return {
    sent: [],
    send(payload: unknown) {
      this.sent.push(JSON.parse(JSON.stringify(payload)) as Record<string, unknown>);
    },
    close() {},
  };
}

function makeServer(persistAppearance = vi.fn(async () => {})): GameServer {
  return new GameServer({
    loadCharacter: async (id: number) => {
      const c = CHARACTERS.get(id);
      if (c === undefined) return null;
      return {
        characterId: id, accountId: c.accountId, name: c.name, classKey: c.classKey, zoneId: ZONE.zoneId,
        pos: { x: 1, y: 1 }, hp: 100, maxHp: 100, attack: 10, defense: 5, speed: 150, critChance: 0, critMultiplier: 1.5,
        appearance: c.appearance,
      };
    },
    getZoneData: (zoneId: string) => (zoneId === ZONE.zoneId ? ZONE : null),
    persistAppearance,
    tickMs: 1000,
    minMoveIntervalMs: 0,
  });
}

async function connectAndJoin(server: GameServer, socket: FakeSocket, characterId: number): Promise<void> {
  server.registerSocket(socket);
  const char = CHARACTERS.get(characterId);
  if (char === undefined) throw new Error(`unknown test character ${characterId}`);
  await server.onMessage(socket, JSON.stringify({ type: "authenticate", token: issueWsToken(char.accountId, characterId) }));
  await server.onMessage(socket, JSON.stringify({ type: "join_zone", zoneId: ZONE.zoneId }));
}

function lastOfType(socket: FakeSocket, type: string): Record<string, unknown> | undefined {
  return socket.sent.filter((m) => m.type === type).at(-1);
}

type PlayerEntry = { characterId: number; appearance: unknown };

function entryFor(frame: Record<string, unknown> | undefined, characterId: number): PlayerEntry | undefined {
  return (frame?.players as PlayerEntry[] | undefined)?.find((p) => p.characterId === characterId);
}

const PANDA = { species: "panda", colors: { fur: "#abcdef" } };
const FOX_DEFAULT = { species: "fox", colors: {} };

beforeEach(() => resetWsTokenStore());

afterEach(async () => {
  resetWsTokenStore();
  await closeDb();
  vi.restoreAllMocks();
});

describe("appearance over the game socket", () => {
  it("normalizes the stored look into player_joined, zone_state and player_snapshot", async () => {
    const server = makeServer();
    const a = fakeSocket();
    const b = fakeSocket();
    await connectAndJoin(server, a, 10);
    await connectAndJoin(server, b, 11);

    expect(lastOfType(a, "player_joined")).toMatchObject({ characterId: 11, appearance: FOX_DEFAULT });
    const state = lastOfType(b, "zone_state");
    expect(entryFor(state, 10)?.appearance).toEqual(PANDA);
    expect(entryFor(state, 11)?.appearance).toEqual(FOX_DEFAULT);

    server.runTick();
    const snap = lastOfType(a, "player_snapshot");
    expect(entryFor(snap, 10)?.appearance).toEqual(PANDA);
    expect(entryFor(snap, 11)?.appearance).toEqual(FOX_DEFAULT);
  });

  it("set_appearance normalizes, persists, and broadcasts to the whole zone including the sender", async () => {
    const persist = vi.fn(async () => {});
    const server = makeServer(persist);
    const a = fakeSocket();
    const b = fakeSocket();
    await connectAndJoin(server, a, 11);
    await connectAndJoin(server, b, 10);

    await server.onMessage(a, JSON.stringify({
      type: "set_appearance",
      appearance: { species: "wolf", colors: { fur: "#8F96A3", eyes: "nope", wings: "#ffffff" }, extra: true },
    }));

    const expected = { species: "wolf", colors: { fur: "#8f96a3" } };
    expect(persist).toHaveBeenCalledWith(11, expected);
    expect(lastOfType(a, "player_appearance")).toEqual({ type: "player_appearance", characterId: 11, appearance: expected });
    expect(lastOfType(b, "player_appearance")).toEqual({ type: "player_appearance", characterId: 11, appearance: expected });

    server.runTick();
    expect(entryFor(lastOfType(b, "player_snapshot"), 11)?.appearance).toEqual(expected);
  });

  it("falls back to the class animal for an unknown species", async () => {
    const persist = vi.fn(async () => {});
    const server = makeServer(persist);
    const a = fakeSocket();
    await connectAndJoin(server, a, 11);

    await server.onMessage(a, JSON.stringify({ type: "set_appearance", appearance: { species: "dragon", colors: { fur: "#123456" } } }));
    expect(lastOfType(a, "player_appearance")).toMatchObject({ appearance: { species: "fox", colors: { fur: "#123456" } } });

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5_000);
    await server.onMessage(a, JSON.stringify({ type: "set_appearance", appearance: "not an object" }));
    expect(lastOfType(a, "player_appearance")).toMatchObject({ appearance: FOX_DEFAULT });
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("rate-limits set_appearance to one per second per character", async () => {
    const persist = vi.fn(async () => {});
    const server = makeServer(persist);
    const a = fakeSocket();
    await connectAndJoin(server, a, 10);
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);

    await server.onMessage(a, JSON.stringify({ type: "set_appearance", appearance: { species: "bear" } }));
    now.mockReturnValue(start + 999);
    await server.onMessage(a, JSON.stringify({ type: "set_appearance", appearance: { species: "capybara" } }));
    expect(lastOfType(a, "error")).toMatchObject({ code: "RATE_LIMITED", requestType: "set_appearance" });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(a.sent.filter((m) => m.type === "player_appearance")).toHaveLength(1);

    now.mockReturnValue(start + 1000);
    await server.onMessage(a, JSON.stringify({ type: "set_appearance", appearance: { species: "capybara" } }));
    expect(persist).toHaveBeenCalledTimes(2);
    expect(lastOfType(a, "player_appearance")).toMatchObject({ appearance: { species: "capybara", colors: {} } });
  });

  it("requires being in a zone", async () => {
    const server = makeServer();
    const a = fakeSocket();
    server.registerSocket(a);
    await server.onMessage(a, JSON.stringify({ type: "authenticate", token: issueWsToken(7, 10) }));
    await server.onMessage(a, JSON.stringify({ type: "set_appearance", appearance: { species: "bear" } }));
    expect(lastOfType(a, "error")).toMatchObject({ code: "NOT_IN_ZONE", requestType: "set_appearance" });
  });
});

describe("appearance persistence", () => {
  async function newCharacter(appearance: unknown, classIndex = 0) {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "u-look", username: "look", displayName: "Look", role: "Member" });
    const cls = (await getCharacterClasses())[classIndex];
    const created = await createCharacter({
      accountId: account.id, name: `Look ${classIndex}`, classId: cls.id, cls,
      appearance: normalizeAppearance(appearance, toClassKey(cls.key)),
    });
    if (!created.ok) throw new Error("create failed");
    return { account, character: created.character };
  }

  it("stores the normalized look on create and returns it from toPublicCharacter", async () => {
    const { account, character } = await newCharacter({ species: "capybara", colors: { outfit: "#112233", fur2: "#445566" } });
    const expected = { species: "capybara", colors: { outfit: "#112233" } };
    expect(toPublicCharacter(character).appearance).toEqual(expected);
    const listed = await getCharactersByAccountId(account.id);
    expect(toPublicCharacter(listed[0])).toMatchObject({ id: character.id, appearance: expected });
    expect((await getCharacterById(character.id))?.appearance).toEqual(expected);
    expect((await getCharacterWithClass(character.id))?.appearance).toEqual(expected);
  });

  it("updateCharacterAppearance persists and bumps updated_at", async () => {
    const { character } = await newCharacter({});
    getDb().prepare("UPDATE characters SET updated_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", character.id);
    await updateCharacterAppearance(character.id, { species: "panda", colors: { eyes: "#202020" } });
    expect((await getCharacterWithClass(character.id))?.appearance).toEqual({ species: "panda", colors: { eyes: "#202020" } });
    const row = getDb().prepare("SELECT updated_at FROM characters WHERE id = ?").get(character.id) as { updated_at: string };
    expect(row.updated_at).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("gives a legacy '{}' row its class animal on session load", async () => {
    const { character } = await newCharacter({});
    getDb().prepare("UPDATE characters SET appearance = '{}' WHERE id = ?").run(character.id);
    expect((await getCharacterById(character.id))?.appearance).toEqual({});
    expect((await getCharacterWithClass(character.id))?.appearance).toEqual({ species: "bear", colors: {} });
  });
});
