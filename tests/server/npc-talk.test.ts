import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the config loader BEFORE importing anything that uses it (same
// pattern as the other server tests) so we never need server_config.json.
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

import type { IncomingMessage, ServerResponse } from "node:http";
import { generateAccessToken } from "../../server/src/auth/index.ts";
import { getAccountByAshatId } from "../../server/src/models/Account.ts";
import {
  createNpcTalkHandler,
  type NpcInfo,
  type NpcTalkDeps,
} from "../../server/src/routes/npc.ts";
import { validSceneImage } from "../../server/src/ai/image.ts";
import type { GameBrain } from "../../server/src/ai/GameBrain.ts";

const mockGetAccount = vi.mocked(getAccountByAshatId);

const ACCOUNT = {
  id: 7,
  username: "maple",
  email: null,
  display_name: "Maple",
  role: "Member",
  ashat_user_id: "u-7",
};

/** A real minimal JPEG (SOI + SOF0, 1 component) as a data URL. */
function jpegDataUrl(width: number, height: number): string {
  const bytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ]);
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
}

const NPC_MIRA: NpcInfo = {
  id: "mira",
  name: "Mira",
  species: "fox",
  personality: "cheerful and quick-witted",
  role: "postmistress",
  homeZone: "zone-clover-village",
  homeTile: { x: 8, y: 6 },
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

function fakeBrain(completeJson = vi.fn()): GameBrain {
  return { completeJson } as unknown as GameBrain;
}

function makeHandler(
  brain: GameBrain | null,
  overrides: Partial<NpcTalkDeps> = {},
): ReturnType<typeof createNpcTalkHandler> {
  return createNpcTalkHandler({
    brain,
    npcTalkMinIntervalMs: 6_000,
    maxTokensNpc: 160,
    catalog: new Map([[NPC_MIRA.id, NPC_MIRA]]),
    now: () => NOW,
    ...overrides,
  });
}

let NOW = 1_000;

beforeEach(() => {
  NOW = 1_000;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function authedReq(): Promise<{ authHeader: string }> {
  const token = await generateAccessToken({
    accountId: ACCOUNT.id,
    ashatUserId: ACCOUNT.ashat_user_id,
    username: ACCOUNT.username,
    role: ACCOUNT.role,
  });
  return { authHeader: `Bearer ${token}` };
}

describe("POST /api/npc/talk", () => {
  it("returns 401 without an Authorization header", async () => {
    const res = makeRes();
    await makeHandler(null)(makeReq({ method: "POST", body: { npcId: "mira" } }), res);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("returns 400 when npcId is missing", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    const res = makeRes();
    await makeHandler(null)(makeReq({ method: "POST", authHeader, body: {} }), res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "MISSING_NPC" });
  });

  it("returns 404 for an unknown NPC", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    const res = makeRes();
    await makeHandler(null)(
      makeReq({ method: "POST", authHeader, body: { npcId: "nobody" } }),
      res,
    );
    expect(res._status).toBe(404);
    expect(res._body).toMatchObject({ error: "UNKNOWN_NPC" });
  });

  it("falls back to canned when the brain is disabled", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    const res = makeRes();
    await makeHandler(null)(
      makeReq({ method: "POST", authHeader, body: { npcId: "mira" } }),
      res,
    );
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ line: null, source: "canned" });
  });

  it("returns the AI line when the brain answers with JSON", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    const completeJson = vi.fn(
      async (_system: string, _user: unknown, _maxTokens: number) => ({
        line: "Another parcel for the valley? Lovely — the oaks will be glad.",
      }),
    );
    const res = makeRes();
    await makeHandler(fakeBrain(completeJson))(
      makeReq({
        method: "POST",
        authHeader,
        body: { npcId: "mira", topic: "deliveries", playerName: "Maple" },
      }),
      res,
    );
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      line: "Another parcel for the valley? Lovely — the oaks will be glad.",
      source: "ai",
    });
    // The NPC's personality is in the system prompt; the topic in the user text.
    const system = completeJson.mock.calls[0][0];
    const user = completeJson.mock.calls[0][1];
    expect(system).toContain("Mira");
    expect(system).toContain("cheerful and quick-witted");
    expect(String(user)).toContain("deliveries");
  });

  it("falls back to canned when the brain returns unusable output", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    const res = makeRes();
    await makeHandler(
      fakeBrain(vi.fn(async (_s: string, _u: unknown, _m: number) => null)),
    )(
      makeReq({ method: "POST", authHeader, body: { npcId: "mira" } }),
      res,
    );
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ line: null, source: "canned" });
  });

  it("passes a scene snapshot through to the model as an image part", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    const completeJson = vi.fn(
      async (_system: string, _user: unknown, _maxTokens: number) => ({
        line: "I can see the forest!",
      }),
    );
    const res = makeRes();
    const dataUrl = jpegDataUrl(320, 180);
    await makeHandler(fakeBrain(completeJson))(
      makeReq({
        method: "POST",
        authHeader,
        body: { npcId: "mira", sceneImage: dataUrl },
      }),
      res,
    );
    expect(res._status).toBe(200);
    const user = completeJson.mock.calls[0][1];
    expect(Array.isArray(user)).toBe(true);
    expect(user).toEqual([
      expect.objectContaining({ type: "text" }),
      { type: "image_url", image_url: { url: dataUrl } },
    ]);
  });

  it("rate-limits per account then allows again after the interval", async () => {
    const { authHeader } = await authedReq();
    mockGetAccount.mockResolvedValue(ACCOUNT);
    const handler = makeHandler(
      fakeBrain(vi.fn(async (_s: string, _u: unknown, _m: number) => ({ line: "hi" }))),
    );

    const first = makeRes();
    await handler(makeReq({ method: "POST", authHeader, body: { npcId: "mira" } }), first);
    expect(first._status).toBe(200);

    const limited = makeRes();
    await handler(makeReq({ method: "POST", authHeader, body: { npcId: "mira" } }), limited);
    expect(limited._status).toBe(429);
    expect(limited._body).toMatchObject({ error: "TOO_MANY_TALKS" });

    NOW += 6_001;
    const again = makeRes();
    await handler(makeReq({ method: "POST", authHeader, body: { npcId: "mira" } }), again);
    expect(again._status).toBe(200);
  });
});

describe("validSceneImage", () => {
  it("accepts a small real JPEG data URL", () => {
    const url = jpegDataUrl(64, 64);
    expect(validSceneImage(url)).toBe(url);
  });

  it("rejects non-strings and non-JPEG data URLs", () => {
    expect(validSceneImage(null)).toBeNull();
    expect(validSceneImage(42)).toBeNull();
    expect(validSceneImage("")).toBeNull();
    expect(validSceneImage("https://example.com/foo.jpg")).toBeNull();
    expect(validSceneImage("data:image/gif;base64,AAAA")).toBeNull();
    expect(validSceneImage("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")).toBeNull();
    expect(validSceneImage("data:image/webp;base64,UklGRiIAAABXRUJQVlA4TCEAAAAvAUAADQAAAAA")).toBeNull();
  });

  it("rejects payloads that do not parse as JPEG", () => {
    expect(validSceneImage("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(validSceneImage(`data:image/jpeg;base64,${"A".repeat(64)}`)).toBeNull();
  });

  it("rejects oversized byte payloads", () => {
    const huge = `data:image/jpeg;base64,${"A".repeat(200_001)}`;
    expect(validSceneImage(huge)).toBeNull();
  });

  it("rejects JPEGs with oversized frame dimensions", () => {
    expect(validSceneImage(jpegDataUrl(5000, 64))).toBeNull();
    expect(validSceneImage(jpegDataUrl(64, 5000))).toBeNull();
  });
});
