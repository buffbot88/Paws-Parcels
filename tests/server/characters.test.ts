import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the config loader BEFORE importing anything that uses it (same
// pattern as auth.test.ts) so server tests never need server_config.json.
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

vi.mock("../../server/src/models/Account.ts", () => ({
  getAccountByAshatId: vi.fn(),
}));

vi.mock("../../server/src/models/Character.ts", () => ({
  createCharacter: vi.fn(),
  getCharactersByAccountId: vi.fn(),
  toPublicCharacter: (c: Record<string, unknown>) => ({
    id: c.id,
    name: c.name,
    class_id: c.class_id,
    zone_id: c.zone_id,
    pos_x: c.pos_x,
    pos_y: c.pos_y,
    level: c.level,
  }),
}));

vi.mock("../../server/src/models/CharacterClass.ts", () => ({
  getCharacterClassById: vi.fn(),
  getCharacterClasses: vi.fn(),
  toPublicClass: (c: Record<string, unknown>) => ({
    id: c.id,
    key: c.key,
    display_name: c.display_name,
    animal: c.animal,
    role: c.role,
    primary_resource: c.primary_resource,
    base_stats: c.base_stats,
  }),
}));

import type { IncomingMessage, ServerResponse } from "node:http";
import { generateAccessToken } from "../../server/src/auth/index.ts";
import { getAccountByAshatId } from "../../server/src/models/Account.ts";
import {
  createCharacter,
  getCharactersByAccountId,
} from "../../server/src/models/Character.ts";
import {
  getCharacterClassById,
  getCharacterClasses,
} from "../../server/src/models/CharacterClass.ts";
import {
  classesHandler,
  createCharacterHandler,
  listCharactersHandler,
} from "../../server/src/routes/characters.ts";

const mockGetAccount = vi.mocked(getAccountByAshatId);
const mockGetCharacters = vi.mocked(getCharactersByAccountId);
const mockCreateCharacter = vi.mocked(createCharacter);
const mockGetClassById = vi.mocked(getCharacterClassById);
const mockGetClasses = vi.mocked(getCharacterClasses);

const ACCOUNT = {
  id: 7,
  username: "maple",
  email: null,
  display_name: "Maple",
  role: "Member",
  ashat_user_id: "u-7",
};

const CLASS_BEAR = {
  id: 1,
  key: "bear-warrior",
  display_name: "Bear Warrior",
  animal: "bear",
  role: "Melee Tank / Damage",
  primary_resource: "stamina",
  resource_max: 100,
  resource_regen_per_sec: 5,
  base_stats: { hp: 120, attack: 10, defense: 8, speed: 150 },
  description: "A sturdy melee fighter.",
};

function makeReq(opts: {
  method?: string;
  url?: string;
  authHeader?: string;
  body?: unknown;
}): IncomingMessage {
  const headers: Record<string, string> = {};
  if (opts.authHeader !== undefined) headers.authorization = opts.authHeader;
  return {
    method: opts.method ?? "GET",
    url: opts.url ?? "/",
    headers: headers as IncomingMessage["headers"],
    body: opts.body,
  } as unknown as IncomingMessage;
}

interface MockResponse extends ServerResponse {
  _status: number;
  _headers: Record<string, string>;
  _body: unknown;
  _ended: boolean;
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    _status: 0,
    _headers: {},
    _body: null,
    _ended: false,
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) res._headers[k] = v;
      }
      return res;
    },
    setHeader(name: string, value: string | string[]) {
      res._headers[name] = Array.isArray(value) ? value.join(",") : value;
      return res;
    },
    end(chunk?: string | Buffer) {
      res._ended = true;
      if (typeof chunk === "string") {
        try {
          res._body = JSON.parse(chunk);
        } catch {
          res._body = chunk;
        }
      }
      return res;
    },
    on() {
      return res;
    },
    once() {
      return res;
    },
    emit() {
      return true;
    },
  } as unknown as MockResponse;
  return res;
}

async function authedReq(): Promise<{ authHeader: string }> {
  const token = await generateAccessToken({
    accountId: ACCOUNT.id,
    ashatUserId: ACCOUNT.ashat_user_id,
    username: ACCOUNT.username,
    role: ACCOUNT.role,
  });
  return { authHeader: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===== GET /api/characters =====

describe("listCharactersHandler", () => {
  it("returns 401 without an Authorization header", async () => {
    const res = makeRes();
    await listCharactersHandler(makeReq({}), res);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("returns 401 for a bad token", async () => {
    const res = makeRes();
    await listCharactersHandler(makeReq({ authHeader: "Bearer garbage" }), res);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "INVALID_TOKEN" });
  });

  it("returns 401 (ACCOUNT_GONE) when the account is missing", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(null);
    const res = makeRes();
    await listCharactersHandler(makeReq({ authHeader }), res);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "ACCOUNT_GONE" });
  });

  it("returns an empty character list for a fresh account", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    mockGetCharacters.mockResolvedValue([]);
    const res = makeRes();
    await listCharactersHandler(makeReq({ authHeader }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ characters: [] });
  });

  it("returns the account's characters", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    mockGetCharacters.mockResolvedValue([
      {
        id: 1,
        account_id: 7,
        class_id: 1,
        name: "Maple",
        zone_id: "zone-clover-village",
        pos_x: 15,
        pos_y: 14,
        level: 1,
      },
    ]);
    const res = makeRes();
    await listCharactersHandler(makeReq({ authHeader }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      characters: [
        {
          id: 1,
          name: "Maple",
          class_id: 1,
          zone_id: "zone-clover-village",
          pos_x: 15,
          pos_y: 14,
          level: 1,
        },
      ],
    });
  });
});

// ===== GET /api/classes =====

describe("classesHandler", () => {
  it("requires auth", async () => {
    const res = makeRes();
    await classesHandler(makeReq({}), res);
    expect(res._status).toBe(401);
  });

  it("returns the class catalog", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    mockGetClasses.mockResolvedValue([CLASS_BEAR]);
    const res = makeRes();
    await classesHandler(makeReq({ authHeader }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      classes: [
        {
          id: 1,
          key: "bear-warrior",
          display_name: "Bear Warrior",
          animal: "bear",
          role: "Melee Tank / Damage",
          primary_resource: "stamina",
          base_stats: { hp: 120, attack: 10, defense: 8, speed: 150 },
        },
      ],
    });
  });
});

// ===== POST /api/characters =====

describe("createCharacterHandler", () => {
  it("requires auth", async () => {
    const res = makeRes();
    await createCharacterHandler(
      makeReq({ method: "POST", body: { name: "Maple", class_id: 1 } }),
      res,
    );
    expect(res._status).toBe(401);
  });

  it("rejects a name that is too short", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    const res = makeRes();
    await createCharacterHandler(
      makeReq({ method: "POST", authHeader, body: { name: "A", class_id: 1 } }),
      res,
    );
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "INVALID_NAME" });
  });

  it("rejects a name with unsupported characters", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    const res = makeRes();
    await createCharacterHandler(
      makeReq({
        method: "POST",
        authHeader,
        body: { name: "Maple!!!", class_id: 1 },
      }),
      res,
    );
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "INVALID_NAME" });
  });

  it("rejects a non-integer or missing class_id", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    for (const classId of [undefined, "1", 1.5, 0]) {
      const res = makeRes();
      await createCharacterHandler(
        makeReq({
          method: "POST",
          authHeader,
          body: { name: "Maple", class_id: classId },
        }),
        res,
      );
      expect(res._status).toBe(400);
      expect(res._body).toMatchObject({ error: "INVALID_CLASS_ID" });
    }
  });

  it("rejects an unknown class id", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    mockGetClassById.mockResolvedValue(null);
    const res = makeRes();
    await createCharacterHandler(
      makeReq({ method: "POST", authHeader, body: { name: "Maple", class_id: 99 } }),
      res,
    );
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "CLASS_NOT_FOUND" });
  });

  it("returns 409 NAME_TAKEN when the account already has that name", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    mockGetClassById.mockResolvedValue(CLASS_BEAR);
    mockCreateCharacter.mockResolvedValue({ ok: false, reason: "NAME_TAKEN" });
    const res = makeRes();
    await createCharacterHandler(
      makeReq({ method: "POST", authHeader, body: { name: "Maple", class_id: 1 } }),
      res,
    );
    expect(res._status).toBe(409);
    expect(res._body).toMatchObject({ error: "NAME_TAKEN" });
  });

  it("creates a character and returns 201 with the public shape", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    mockGetClassById.mockResolvedValue(CLASS_BEAR);
    mockCreateCharacter.mockResolvedValue({
      ok: true,
      character: {
        id: 10,
        account_id: 7,
        class_id: 1,
        name: "Maple",
        zone_id: "zone-clover-village",
        pos_x: 15,
        pos_y: 14,
        level: 1,
      },
    });
    const res = makeRes();
    await createCharacterHandler(
      makeReq({
        method: "POST",
        authHeader,
        body: { name: "Maple", class_id: 1, appearance: { fur: "brown" } },
      }),
      res,
    );
    expect(res._status).toBe(201);
    expect(res._body).toEqual({
      character: {
        id: 10,
        name: "Maple",
        class_id: 1,
        zone_id: "zone-clover-village",
        pos_x: 15,
        pos_y: 14,
        level: 1,
      },
    });
    expect(mockCreateCharacter).toHaveBeenCalledWith({
      accountId: 7,
      name: "Maple",
      classId: 1,
      appearance: { fur: "brown" },
      cls: CLASS_BEAR,
    });
  });

  it("trims whitespace from the submitted name", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    mockGetClassById.mockResolvedValue(CLASS_BEAR);
    mockCreateCharacter.mockResolvedValue({
      ok: true,
      character: {
        id: 11,
        account_id: 7,
        class_id: 1,
        name: "Maple",
        zone_id: "zone-clover-village",
        pos_x: 15,
        pos_y: 14,
        level: 1,
      },
    });
    const res = makeRes();
    await createCharacterHandler(
      makeReq({
        method: "POST",
        authHeader,
        body: { name: "  Maple  ", class_id: 1 },
      }),
      res,
    );
    expect(res._status).toBe(201);
    expect(mockCreateCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Maple" }),
    );
  });
});
