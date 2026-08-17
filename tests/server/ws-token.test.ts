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
  setLastPlayedCharacter: vi.fn(),
}));

vi.mock("../../server/src/models/Character.ts", () => ({
  getCharacterById: vi.fn(),
}));

import type { IncomingMessage, ServerResponse } from "node:http";
import { generateAccessToken } from "../../server/src/auth/index.ts";
import { getAccountByAshatId } from "../../server/src/models/Account.ts";
import { getCharacterById } from "../../server/src/models/Character.ts";
import { wsTokenHandler } from "../../server/src/routes/ws-token.ts";
import {
  WS_TOKEN_TTL_SECONDS,
  consumeWsToken,
  issueWsToken,
  resetWsTokenStore,
} from "../../server/src/ws/tokenStore.ts";

const mockGetAccount = vi.mocked(getAccountByAshatId);
const mockGetCharacter = vi.mocked(getCharacterById);

const ACCOUNT = {
  id: 7,
  username: "maple",
  email: null,
  display_name: "Maple",
  role: "Member",
  ashat_user_id: "u-7",
};

const CHARACTER = {
  id: 10,
  account_id: 7,
  class_id: 1,
  name: "Maple",
  zone_id: "zone-clover-village",
  pos_x: 15,
  pos_y: 13,
  level: 1,
};

function makeReq(opts: { url?: string; authHeader?: string }): IncomingMessage {
  const headers: Record<string, string> = {};
  if (opts.authHeader !== undefined) headers.authorization = opts.authHeader;
  return {
    method: "GET",
    url: opts.url ?? "/api/ws-token?characterId=10",
    headers: headers as IncomingMessage["headers"],
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

beforeEach(() => {
  vi.clearAllMocks();
  resetWsTokenStore();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetWsTokenStore();
});

// ===== token store =====

describe("ws handshake token store", () => {
  it("issues a token that consumes to the bound identity", () => {
    const token = issueWsToken(7, 10);
    expect(token.length).toBeGreaterThan(20);
    expect(consumeWsToken(token)).toEqual({ accountId: 7, characterId: 10 });
  });

  it("is single-use: the second consume returns null", () => {
    const token = issueWsToken(7, 10);
    expect(consumeWsToken(token)).not.toBeNull();
    expect(consumeWsToken(token)).toBeNull();
  });

  it("rejects unknown tokens", () => {
    expect(consumeWsToken("not-a-real-token")).toBeNull();
  });

  it("rejects expired tokens", () => {
    vi.useFakeTimers();
    try {
      const token = issueWsToken(7, 10);
      vi.advanceTimersByTime((WS_TOKEN_TTL_SECONDS + 1) * 1000);
      expect(consumeWsToken(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps outstanding tokens per account, evicting the oldest first", () => {
    const first = issueWsToken(7, 10);
    for (let i = 0; i < 4; i++) issueWsToken(7, 10);
    const sixth = issueWsToken(7, 10);
    // The first token is evicted by the cap; the newest is still valid.
    expect(consumeWsToken(first)).toBeNull();
    expect(consumeWsToken(sixth)).toEqual({ accountId: 7, characterId: 10 });
  });

  it("evicting one account never touches another account's tokens", () => {
    const other = issueWsToken(8, 11);
    for (let i = 0; i < 5; i++) issueWsToken(7, 10);
    expect(consumeWsToken(other)).toEqual({ accountId: 8, characterId: 11 });
  });

  it("prunes expired tokens on issue", () => {
    vi.useFakeTimers();
    try {
      const stale = issueWsToken(7, 10);
      vi.advanceTimersByTime((WS_TOKEN_TTL_SECONDS + 1) * 1000);
      issueWsToken(8, 11); // issuance prunes the expired entry
      expect(consumeWsToken(stale)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ===== GET /api/ws-token =====

describe("wsTokenHandler", () => {
  it("returns 401 without an Authorization header", async () => {
    const res = makeRes();
    await wsTokenHandler(makeReq({ authHeader: undefined }), res);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("returns 400 for a missing/invalid characterId", async () => {
    const token = await generateAccessToken({
      accountId: 7,
      ashatUserId: "u-7",
      username: "maple",
      role: "Member",
    });
    mockGetAccount.mockResolvedValue(ACCOUNT);
    for (const qs of ["", "?characterId=abc", "?characterId=0", "?characterId=-2"]) {
      const res = makeRes();
      await wsTokenHandler(
        makeReq({ url: `/api/ws-token${qs}`, authHeader: `Bearer ${token}` }),
        res,
      );
      expect(res._status).toBe(400);
      expect(res._body).toMatchObject({ error: "INVALID_CHARACTER_ID" });
    }
  });

  it("returns 404 for a character the account does not own", async () => {
    const token = await generateAccessToken({
      accountId: 7,
      ashatUserId: "u-7",
      username: "maple",
      role: "Member",
    });
    mockGetAccount.mockResolvedValue(ACCOUNT);
    mockGetCharacter.mockResolvedValue({ ...CHARACTER, account_id: 999 });
    const res = makeRes();
    await wsTokenHandler(
      makeReq({ url: "/api/ws-token?characterId=10", authHeader: `Bearer ${token}` }),
      res,
    );
    expect(res._status).toBe(404);
    expect(res._body).toMatchObject({ error: "CHARACTER_NOT_FOUND" });
  });

  it("returns 404 when the character does not exist", async () => {
    const token = await generateAccessToken({
      accountId: 7,
      ashatUserId: "u-7",
      username: "maple",
      role: "Member",
    });
    mockGetAccount.mockResolvedValue(ACCOUNT);
    mockGetCharacter.mockResolvedValue(null);
    const res = makeRes();
    await wsTokenHandler(
      makeReq({ url: "/api/ws-token?characterId=10", authHeader: `Bearer ${token}` }),
      res,
    );
    expect(res._status).toBe(404);
    expect(res._body).toMatchObject({ error: "CHARACTER_NOT_FOUND" });
  });

  it("still issues to a capped account after the oldest token was evicted", async () => {
    const token = await generateAccessToken({
      accountId: 7,
      ashatUserId: "u-7",
      username: "maple",
      role: "Member",
    });
    mockGetAccount.mockResolvedValue(ACCOUNT);
    mockGetCharacter.mockResolvedValue(CHARACTER);
    for (let i = 0; i < 6; i++) issueWsToken(7, 10); // flood past the cap
    const res = makeRes();
    await wsTokenHandler(
      makeReq({ url: "/api/ws-token?characterId=10", authHeader: `Bearer ${token}` }),
      res,
    );
    expect(res._status).toBe(200);
    const body = res._body as { wsToken: string };
    expect(consumeWsToken(body.wsToken)).toEqual({ accountId: 7, characterId: 10 });
  });

  it("issues a single-use token for an owned character", async () => {
    const token = await generateAccessToken({
      accountId: 7,
      ashatUserId: "u-7",
      username: "maple",
      role: "Member",
    });
    mockGetAccount.mockResolvedValue(ACCOUNT);
    mockGetCharacter.mockResolvedValue(CHARACTER);
    const res = makeRes();
    await wsTokenHandler(
      makeReq({ url: "/api/ws-token?characterId=10", authHeader: `Bearer ${token}` }),
      res,
    );
    expect(res._status).toBe(200);
    const body = res._body as { wsToken: string; expiresIn: number; characterId: number; zoneId: string };
    expect(body.expiresIn).toBe(WS_TOKEN_TTL_SECONDS);
    expect(body.characterId).toBe(10);
    expect(body.zoneId).toBe("zone-clover-village");
    expect(consumeWsToken(body.wsToken)).toEqual({ accountId: 7, characterId: 10 });
  });
});
