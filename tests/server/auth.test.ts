import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type KeyLike,
} from "jose";

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
    file: ":memory:",
  },
  auth: {
    jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x",
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 604800,
    bcryptRounds: 4,
    devLoginEnabled: false,
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
  findOrCreateAccountByAshatId: vi.fn(),
  getAccountByAshatId: vi.fn(),
  toPublicAccount: (a: Record<string, unknown>) => ({
    id: a.id,
    username: a.username,
    display_name: a.display_name,
    role: a.role,
    ashat_user_id: a.ashat_user_id,
  }),
}));

vi.mock("../../server/src/models/Character.ts", () => ({
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

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  extractBearerToken,
  generateAccessToken,
  verifyAccessToken,
} from "../../server/src/auth/index.ts";
import {
  resetOidcCache,
  verifyOidcIdToken,
} from "../../server/src/auth/oidc.ts";
import {
  findOrCreateAccountByAshatId,
  getAccountByAshatId,
} from "../../server/src/models/Account.ts";
import { getCharactersByAccountId } from "../../server/src/models/Character.ts";
import {
  loginUrlHandler,
  logoutHandler,
  meHandler,
  oidcCallbackHandler,
  devLoginHandler,
} from "../../server/src/routes/auth.ts";

const mockFindOrCreate = vi.mocked(findOrCreateAccountByAshatId);
const mockGetAccount = vi.mocked(getAccountByAshatId);
const mockGetCharacters = vi.mocked(getCharactersByAccountId);

// --- OIDC test fixtures ---

const ISSUER = "https://ashat.test/api/oauth";
const AUDIENCE = "paws-and-parcels";

let privateKey: KeyLike | null = null;
let publicJwk: JWK | null = null;

async function getKeyPair(): Promise<{ privateKey: KeyLike; publicJwk: JWK }> {
  if (privateKey === null || publicJwk === null) {
    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
  }
  return { privateKey, publicJwk };
}

/** Sign a valid RS256 id_token the way ASHAT's OAuthServer::issueIdToken does. */
async function signIdToken(overrides?: {
  iss?: string;
  aud?: string;
  sub?: string;
  username?: string;
  role?: string;
  display_name?: string;
  exp?: string | number;
}): Promise<string> {
  const { privateKey } = await getKeyPair();
  const claims = {
    username: overrides?.username ?? "pip",
    role: overrides?.role ?? "Member",
    display_name: overrides?.display_name ?? "Pip the Hedgehog",
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "ashat-oauth-key-1" })
    .setIssuer(overrides?.iss ?? ISSUER)
    .setAudience(overrides?.aud ?? AUDIENCE)
    .setSubject(overrides?.sub ?? "u-abc")
    .setIssuedAt()
    .setExpirationTime(overrides?.exp ?? "5m")
    .sign(privateKey);
}

/** A fetcher stub that mimics ASHAT Hub's discovery + jwks + token endpoints. */
function makeOidcFetcher(opts: {
  discovery?: boolean;
  jwks?: boolean;
  tokenStatus?: number;
  idToken?: string;
} = {}): typeof fetch {
  return (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const DISCOVERY_URL =
      "https://ashat.test/api/oauth/.well-known/openid-configuration";
    const JWKS_URL = "https://ashat.test/api/oauth/.well-known/jwks.json";
    const TOKEN_URL = "https://ashat.test/api/oauth/token";

    if (url === DISCOVERY_URL) {
      if (opts.discovery === false) return new Response("nope", { status: 500 });
      return new Response(
        JSON.stringify({
          issuer: "https://ashat.test",
          authorization_endpoint: "https://ashat.test/api/oauth/authorize",
          token_endpoint: TOKEN_URL,
          jwks_uri: JWKS_URL,
          response_types_supported: ["code"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url === JWKS_URL) {
      if (opts.jwks === false) return new Response("nope", { status: 500 });
      const jwk = await getKeyPair().then((p) => p.publicJwk);
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === TOKEN_URL) {
      const status = opts.tokenStatus ?? 200;
      if (status !== 200) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
      const body = opts.idToken
        ? { access_token: "at", id_token: opts.idToken, token_type: "Bearer", expires_in: 300 }
        : { error: "invalid_grant" };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

// --- request/response helpers ---

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

beforeEach(() => {
  resetOidcCache();
  vi.spyOn(globalThis, "fetch").mockImplementation(makeOidcFetcher());
});

afterEach(() => {
  vi.restoreAllMocks();
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

// ===== JWT mint/verify (Paws session tokens) =====

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

// ===== verifyOidcIdToken =====

describe("verifyOidcIdToken", () => {
  it("verifies a valid RS256 id_token and returns the identity", async () => {
    const idToken = await signIdToken();
    const result = await verifyOidcIdToken(idToken);
    expect(result).toEqual({
      kind: "ok",
      identity: {
        sub: "u-abc",
        username: "pip",
        role: "Member",
        displayName: "Pip the Hedgehog",
      },
    });
  });

  it("rejects a token with the wrong issuer", async () => {
    const idToken = await signIdToken({ iss: "https://evil.test/api/oauth" });
    expect(await verifyOidcIdToken(idToken)).toEqual({ kind: "invalid" });
  });

  it("rejects a token with the wrong audience", async () => {
    const idToken = await signIdToken({ aud: "some-other-client" });
    expect(await verifyOidcIdToken(idToken)).toEqual({ kind: "invalid" });
  });

  it("rejects an expired token", async () => {
    const idToken = await signIdToken({ exp: "-10m" });
    expect(await verifyOidcIdToken(idToken)).toEqual({ kind: "invalid" });
  });

  it("rejects a token whose signature is tampered with", async () => {
    const good = await signIdToken();
    const [h, p, s] = good.split(".");
    // Flip a bit in the *decoded* signature instead of editing its text: the
    // last base64url character carries padding bits, so replacing it can leave
    // the decoded signature byte-identical — roughly a 1-in-16 chance of
    // handing the valid token to this "tampered" path. Text edits near a fixed
    // suffix can flake the same way; a bit flip cannot.
    const signature = Buffer.from(s!, "base64url");
    signature[0] ^= 0x01;
    const tampered = `${h}.${p}.${signature.toString("base64url")}`;
    expect(tampered).not.toBe(good);
    expect(await verifyOidcIdToken(tampered)).toEqual({ kind: "invalid" });
  });

  it("reports unreachable when the JWKS endpoint is down", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      makeOidcFetcher({ jwks: false }),
    );
    const idToken = await signIdToken();
    expect(await verifyOidcIdToken(idToken)).toEqual({ kind: "unreachable" });
  });

  it("reports unreachable when discovery is down", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      makeOidcFetcher({ discovery: false }),
    );
    const idToken = await signIdToken();
    expect(await verifyOidcIdToken(idToken)).toEqual({ kind: "unreachable" });
  });

  it("returns invalid for a garbage token", async () => {
    expect(await verifyOidcIdToken("not.a.jwt")).toEqual({ kind: "invalid" });
  });
});

// ===== loginUrlHandler =====

describe("loginUrlHandler", () => {
  it("returns 400 when state is missing", async () => {
    const res = makeRes();
    await loginUrlHandler(
      makeReq({ url: "/api/auth/login-url?code_challenge=" + "a".repeat(43) }),
      res,
    );
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "MISSING_STATE" });
  });

  it("returns 400 when code_challenge is too short", async () => {
    const res = makeRes();
    await loginUrlHandler(
      makeReq({ url: "/api/auth/login-url?state=abcdefgh&code_challenge=short" }),
      res,
    );
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "MISSING_CODE_CHALLENGE" });
  });

  it("returns the authorize URL with OIDC params when state + challenge are present", async () => {
    const res = makeRes();
    await loginUrlHandler(
      makeReq({
        url:
          "/api/auth/login-url?state=abc12345&code_challenge=" +
          "a".repeat(43),
      }),
      res,
    );
    expect(res._status).toBe(200);
    const body = res._body as { url: string; provider: string; state: string };
    expect(body.provider).toBe("ashat-hub-oidc");
    expect(body.state).toBe("abc12345");
    const parsed = new URL(body.url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://ashat.test/api/oauth/authorize",
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("paws-and-parcels");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/oidc-callback.html",
    );
    expect(parsed.searchParams.get("scope")).toBe("openid profile");
    expect(parsed.searchParams.get("state")).toBe("abc12345");
    expect(parsed.searchParams.get("code_challenge")).toBe("a".repeat(43));
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("returns 502 when discovery is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      makeOidcFetcher({ discovery: false }),
    );
    const res = makeRes();
    await loginUrlHandler(
      makeReq({
        url: "/api/auth/login-url?state=abc12345&code_challenge=" + "a".repeat(43),
      }),
      res,
    );
    expect(res._status).toBe(502);
    expect(res._body).toMatchObject({ error: "OIDC_DISCOVERY_FAILED" });
  });
});

// ===== oidcCallbackHandler =====

describe("oidcCallbackHandler", () => {
  it("returns 400 when code or code_verifier is missing", async () => {
    const res = makeRes();
    await oidcCallbackHandler(makeReq({ method: "POST", body: {} }), res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "MISSING_OIDC_PARAMS" });
  });

  it("returns 401 when the token exchange fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      makeOidcFetcher({ tokenStatus: 400 }),
    );
    const res = makeRes();
    await oidcCallbackHandler(
      makeReq({ method: "POST", body: { code: "code-x", code_verifier: "v".repeat(43) } }),
      res,
    );
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "OIDC_TOKEN_EXCHANGE_FAILED" });
  });

  it("returns 502 when the token exchange cannot reach ASHAT", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      makeOidcFetcher({ discovery: false }),
    );
    const res = makeRes();
    await oidcCallbackHandler(
      makeReq({ method: "POST", body: { code: "code-x", code_verifier: "v".repeat(43) } }),
      res,
    );
    expect(res._status).toBe(502);
    expect(res._body).toMatchObject({ error: "OIDC_UPSTREAM_UNAVAILABLE" });
  });

  it("returns 502 when the JWKS cannot be reached after a successful exchange", async () => {
    const idToken = await signIdToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      makeOidcFetcher({ idToken, jwks: false }),
    );
    const res = makeRes();
    await oidcCallbackHandler(
      makeReq({ method: "POST", body: { code: "code-x", code_verifier: "v".repeat(43) } }),
      res,
    );
    expect(res._status).toBe(502);
    expect(res._body).toMatchObject({ error: "OIDC_UPSTREAM_UNAVAILABLE" });
  });

  it("returns 401 when the id_token fails verification", async () => {
    // Token endpoint returns an id_token signed with a DIFFERENT key.
    const otherPair = await generateKeyPair("RS256", { extractable: true });
    const foreignToken = await new SignJWT({
      username: "pip",
      role: "Member",
      display_name: "Pip",
    })
      .setProtectedHeader({ alg: "RS256", kid: "other-key" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("u-abc")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(otherPair.privateKey);

    vi.spyOn(globalThis, "fetch").mockImplementation(
      makeOidcFetcher({ idToken: foreignToken }),
    );
    const res = makeRes();
    await oidcCallbackHandler(
      makeReq({
        method: "POST",
        body: { code: "code-x", code_verifier: "v".repeat(43) },
      }),
      res,
    );
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "OIDC_ID_TOKEN_INVALID" });
  });

  it("upserts the linked account and returns a JWT + account + characters on success", async () => {
    const idToken = await signIdToken({
      username: "pip",
      role: "Member",
      display_name: "Pip the Hedgehog",
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      makeOidcFetcher({ idToken }),
    );

    mockFindOrCreate.mockResolvedValue({
      id: 42,
      username: "pip",
      email: "pip@ashat.local",
      display_name: "Pip the Hedgehog",
      role: "Member",
      ashat_user_id: "u-abc",
    });
    mockGetCharacters.mockResolvedValue([]);

    const res = makeRes();
    await oidcCallbackHandler(
      makeReq({
        method: "POST",
        body: { code: "code-ok", code_verifier: "v".repeat(43) },
      }),
      res,
    );
    expect(res._status).toBe(200);
    const body = res._body as {
      token: string;
      account: { id: number; ashat_user_id: string };
      characters: unknown[];
    };
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
    await meHandler(makeReq({ authHeader: "Bearer not-a-valid-jwt" }), res);
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
        zone_id: "zone-clover-village",
        pos_x: 5,
        pos_y: 4,
        level: 1,
        appearance: {},
      },
    ]);

    const res = makeRes();
    await meHandler(makeReq({ authHeader: `Bearer ${token}` }), res);
    expect(res._status).toBe(200);
    const body = res._body as {
      account: { username: string };
      characters: Array<{ name: string }>;
    };
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
  });
});

// ===== devLoginHandler =====

describe("devLoginHandler", () => {
  it("returns 404 when devLoginEnabled is false (default)", async () => {
    const res = makeRes();
    await devLoginHandler(makeReq({ method: "POST" }), res);
    expect(res._status).toBe(404);
    expect(res._body).toMatchObject({ error: "NOT_FOUND" });
  });

  it("returns 404 when nodeEnv is not development even if enabled", async () => {
    const { server, auth } = await import("../../server/src/config/index.ts");
    const originalEnv = server.nodeEnv;
    const originalAuth = auth.devLoginEnabled;
    (server as { nodeEnv: string }).nodeEnv = "production";
    (auth as { devLoginEnabled: boolean }).devLoginEnabled = true;

    try {
      const res = makeRes();
      await devLoginHandler(makeReq({ method: "POST" }), res);
      expect(res._status).toBe(404);
    } finally {
      (server as { nodeEnv: string }).nodeEnv = originalEnv;
      (auth as { devLoginEnabled: boolean }).devLoginEnabled = originalAuth;
    }
  });

  it("returns 200 and a JWT + test account when enabled in development", async () => {
    const { server, auth } = await import("../../server/src/config/index.ts");
    const originalEnv = server.nodeEnv;
    const originalAuth = auth.devLoginEnabled;
    (server as { nodeEnv: string }).nodeEnv = "development";
    (auth as { devLoginEnabled: boolean }).devLoginEnabled = true;

    mockFindOrCreate.mockResolvedValue({
      id: 99,
      username: "dev_courier",
      email: "dev@ashat.local",
      display_name: "Local Dev Courier",
      role: "Member",
      ashat_user_id: "dev-local-1234",
    });
    mockGetCharacters.mockResolvedValue([]);

    try {
      const res = makeRes();
      await devLoginHandler(makeReq({ method: "POST" }), res);
      expect(res._status).toBe(200);

      const body = res._body as {
        token: string;
        account: { id: number; ashat_user_id: string; role: string };
        characters: unknown[];
      };

      expect(body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(body.account.id).toBe(99);
      expect(body.account.ashat_user_id).toBe("dev-local-1234");

      // Prove the account has no admin privileges (Member role)
      expect(body.account.role).toBe("Member");

      expect(Array.isArray(body.characters)).toBe(true);
      expect(mockFindOrCreate).toHaveBeenCalledWith({
        ashatUserId: "dev-local-1234",
        username: "dev_courier",
        displayName: "Local Dev Courier",
        role: "Member",
      });

    } finally {
      (server as { nodeEnv: string }).nodeEnv = originalEnv;
      (auth as { devLoginEnabled: boolean }).devLoginEnabled = originalAuth;
    }
  });
});
