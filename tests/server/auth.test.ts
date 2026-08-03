import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the config loader BEFORE importing anything that uses it. This is
// the only safe pattern: server/src/config/index.ts calls loadConfigFromDisk
// at module-load time, which would otherwise require a real server_config.json
// on disk before any server test runs.
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
    host: "localhost",
    port: 3306,
    user: "test_user",
    password: "test_password",
    database: "test_db",
  },
  auth: {
    jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x",
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 604800,
    bcryptRounds: 4,
  },
  ashatHub: {
    baseUrl: "https://ashat.test",
    sharedSecret: "test-shared-secret-of-sufficient-length-32-XX",
    callbackUrl: "https://game.test/sso-callback",
    verifyPath: "/api/sso/verify-session",
    loginPath: "/auth/session/",
    verifyTimeoutMs: 5000,
  },
}));

vi.mock("../../server/src/models/Account.ts", () => ({
  findOrCreateAccountByAshatId: vi.fn(),
  getAccountByAshatId: vi.fn(),
}));

vi.mock("../../server/src/models/Character.ts", () => ({
  getCharactersByAccountId: vi.fn(),
}));

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  extractBearerToken,
  generateAccessToken,
  verifyAccessToken,
  verifyAshatSession,
} from "../../server/src/auth/index.ts";
import {
  findOrCreateAccountByAshatId,
  getAccountByAshatId,
} from "../../server/src/models/Account.ts";
import { getCharactersByAccountId } from "../../server/src/models/Character.ts";
import {
  loginUrlHandler,
  logoutHandler,
  meHandler,
  ssoFinishHandler,
} from "../../server/src/routes/auth.ts";

const mockFindOrCreate = vi.mocked(findOrCreateAccountByAshatId);
const mockGetAccount = vi.mocked(getAccountByAshatId);
const mockGetCharacters = vi.mocked(getCharactersByAccountId);

// --- test helpers ---

function makeReq(opts: {
  method?: string;
  authHeader?: string;
  body?: unknown;
}): IncomingMessage {
  const headers: Record<string, string> = {};
  if (opts.authHeader !== undefined) headers.authorization = opts.authHeader;
  return {
    method: opts.method ?? "GET",
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

afterEach(() => {
  vi.clearAllMocks();
});

// ===== extractBearerToken =====

describe("extractBearerToken", () => {
  it("returns null for null input", () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it("returns null for non-Bearer scheme", () => {
    expect(extractBearerToken("Basic abcdef")).toBeNull();
  });

  it("returns the token for a valid Bearer header", () => {
    expect(extractBearerToken("Bearer my-jwt-token")).toBe("my-jwt-token");
  });

  it("trims whitespace around the token", () => {
    expect(extractBearerToken("Bearer  spaced-jwt  ")).toBe("spaced-jwt");
  });
});

// ===== JWT mint/verify =====

describe("generateAccessToken / verifyAccessToken", () => {
  it("mints a JWT that round-trips via verifyAccessToken", async () => {
    const token = await generateAccessToken({
      accountId: 42,
      ashatUserId: "u-abc",
      username: "pip",
      role: "Admin",
    });
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    const payload = await verifyAccessToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.accountId).toBe(42);
    expect(payload?.ashatUserId).toBe("u-abc");
    expect(payload?.username).toBe("pip");
    expect(payload?.role).toBe("Admin");
  });

  it("returns null for an obviously bad token", async () => {
    const payload = await verifyAccessToken("nope.definitely-not-a-jwt.garbage");
    expect(payload).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    // Build a token with a different secret by swapping config at runtime.
    const { auth } = await import("../../server/src/config/index.ts");
    const original = auth.jwtSecret;
    (auth as { jwtSecret: string }).jwtSecret =
      "different-secret-of-sufficient-length-32-x";
    try {
      const token = await generateAccessToken({
        accountId: 1,
        ashatUserId: "u",
        username: "x",
        role: "Member",
      });
      (auth as { jwtSecret: string }).jwtSecret = original;
      const verified = await verifyAccessToken(token);
      expect(verified).toBeNull();
    } finally {
      (auth as { jwtSecret: string }).jwtSecret = original;
    }
  });
});

// ===== verifyAshatSession =====

describe("verifyAshatSession", () => {
  it("returns the validated payload when Ashat responds valid: true", async () => {
    const responseBody = {
      valid: true,
      user_id: "u-abc",
      username: "pip",
      role: "Member",
      display_name: "Pip the Hedgehog",
      session_expires_at: "2030-01-01 00:00:00",
    };
    const fetcher = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await verifyAshatSession("sid-ok", fetcher);
    expect(result).toEqual(responseBody);
    expect(fetcher).toHaveBeenCalledOnce();
    const call = fetcher.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [unknown, RequestInit | undefined];
    expect(url).toBe("https://ashat.test/api/sso/verify-session");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["X-Paws-Shared-Secret"]).toBe(
      "test-shared-secret-of-sufficient-length-32-XX",
    );
    expect(init?.body).toBe(JSON.stringify({ session_id: "sid-ok" }));
  });

  it("returns null when Ashat responds with valid: false (and is OK)", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ valid: false, reason: "expired" }), {
        status: 200,
      });
    });
    const result = await verifyAshatSession("sid-old", fetcher as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("returns null on a 401 from Ashat", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 401 }));
    const result = await verifyAshatSession("sid", fetcher as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("returns null when the fetcher throws (network error)", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await verifyAshatSession("sid", fetcher as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("returns null when the response shape is not a valid verified payload", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ wrong: "shape" }), { status: 200 });
    });
    const result = await verifyAshatSession("sid", fetcher as unknown as typeof fetch);
    expect(result).toBeNull();
  });
});

// ===== loginUrlHandler =====

describe("loginUrlHandler", () => {
  it("returns the Ashat login URL with the callback query param encoded", async () => {
    const res = makeRes();
    await loginUrlHandler(makeReq({}), res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({
      provider: "ashat-hub",
      callbackUrl: "https://game.test/sso-callback",
    });
    expect((res._body as { url: string }).url).toBe(
      "https://ashat.test/auth/session/?callback=https%3A%2F%2Fgame.test%2Fsso-callback",
    );
  });
});

// ===== ssoFinishHandler =====

describe("ssoFinishHandler", () => {
  it("returns 400 when session_id is missing", async () => {
    const res = makeRes();
    await ssoFinishHandler(makeReq({ body: {} }), res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "MISSING_SESSION_ID" });
  });

  it("returns 401 when Ashat does not recognize the session", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("nope", { status: 401 }));
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      const res = makeRes();
      await ssoFinishHandler(
        makeReq({ method: "POST", body: { session_id: "sid-x" } }),
        res,
      );
      expect(res._status).toBe(401);
      expect(res._body).toMatchObject({ error: "SSO_VERIFY_FAILED" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("upserts the linked account and returns a JWT + account + characters on success", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          valid: true,
          user_id: "u-abc",
          username: "pip",
          role: "Member",
          display_name: "Pip the Hedgehog",
          session_expires_at: "2030-01-01 00:00:00",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    mockFindOrCreate.mockResolvedValue({
      id: 42,
      username: "pip",
      email: "pip@ashat.local",
      display_name: "Pip the Hedgehog",
      role: "Member",
      ashat_user_id: "u-abc",
    });
    mockGetCharacters.mockResolvedValue([]);

    const realFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      const res = makeRes();
      await ssoFinishHandler(
        makeReq({ method: "POST", body: { session_id: "sid-ok" } }),
        res,
      );
      expect(res._status).toBe(200);
      const body = res._body as { token: string; account: { id: number; ashat_user_id: string }; characters: unknown[] };
      expect(body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(body.account.id).toBe(42);
      expect(body.account.ashat_user_id).toBe("u-abc");
      expect(Array.isArray(body.characters)).toBe(true);
      expect(mockFindOrCreate).toHaveBeenCalledWith({
        ashatUserId: "u-abc",
        username: "pip",
        displayName: "Pip the Hedgehog",
        role: "Member",
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ===== meHandler =====

describe("meHandler", () => {
  it("returns 401 when no Authorization header is set", async () => {
    const res = makeRes();
    await meHandler(makeReq({}), res);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("returns 401 when the JWT is invalid", async () => {
    const res = makeRes();
    await meHandler(
      makeReq({ authHeader: "Bearer not-a-valid-jwt" }),
      res,
    );
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "INVALID_TOKEN" });
  });

  it("returns 401 (ACCOUNT_GONE) when the linked Ashat account no longer exists", async () => {
    const token = await generateAccessToken({
      accountId: 999,
      ashatUserId: "u-gone",
      username: "x",
      role: "Member",
    });
    mockGetAccount.mockResolvedValue(null);

    const res = makeRes();
    await meHandler(makeReq({ authHeader: `Bearer ${token}` }), res);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "ACCOUNT_GONE" });
  });

  it("returns account + characters on a valid token", async () => {
    const token = await generateAccessToken({
      accountId: 7,
      ashatUserId: "u-7",
      username: "maple",
      role: "Member",
    });
    mockGetAccount.mockResolvedValue({
      id: 7,
      username: "maple",
      email: null,
      display_name: "Maple",
      role: "Member",
      ashat_user_id: "u-7",
    });
    mockGetCharacters.mockResolvedValue([
      {
        id: 1,
        account_id: 7,
        class_id: 1,
        name: "Maple",
        zone_id: "zone-post-office",
        pos_x: 5,
        pos_y: 4,
        level: 1,
      },
    ]);

    const res = makeRes();
    await meHandler(makeReq({ authHeader: `Bearer ${token}` }), res);
    expect(res._status).toBe(200);
    const body = res._body as { account: { username: string }; characters: Array<{ name: string }> };
    expect(body.account.username).toBe("maple");
    expect(body.characters).toHaveLength(1);
    expect(body.characters[0].name).toBe("Maple");
  });
});

// ===== logoutHandler =====

describe("logoutHandler", () => {
  it("responds 200 { ok: true } — JWT is stateless, client deletes it from localStorage", async () => {
    const res = makeRes();
    await logoutHandler(makeReq({ method: "POST" }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
  });
});
