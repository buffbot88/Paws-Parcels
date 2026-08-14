import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../server/src/config/index.ts", () => ({
  server: {
    port: 3001,
    host: "0.0.0.0",
    nodeEnv: "testing",
    isDev: true,
    corsAllowedOrigins: [],
    debug: false,
  },
  db: { file: ":memory:" },
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
    discoveryUrl: "https://ashat.test/.well-known/openid-configuration",
    issuer: "https://ashat.test",
    jwksTtlSeconds: 600,
  },
  ai: {
    enabled: false,
    port: 3101,
    modelPath: "",
    mmprojPath: "",
    idleMs: 600000,
    warmupTimeoutMs: 90000,
    requestTimeoutMs: 4000,
    monsterDecisionIntervalMs: 5000,
    maxTokensMonster: 40,
    maxTokensNpc: 160,
    npcTalkMinIntervalMs: 6000,
  },
}));

vi.mock("../../server/src/models/Account.ts", () => ({
  getAccountByAshatId: vi.fn(),
}));

import type { IncomingMessage, ServerResponse } from "node:http";
import { generateAccessToken } from "../../server/src/auth/index.ts";
import { getAccountByAshatId } from "../../server/src/models/Account.ts";
import { createVisualCaptureHandler } from "../../server/src/routes/visual-capture.ts";

const mockGetAccount = vi.mocked(getAccountByAshatId);

const ADMIN = {
  id: 7,
  username: "admin",
  email: null,
  display_name: "Admin",
  role: "Admin",
  ashat_user_id: "u-admin",
};
const MEMBER = { ...ADMIN, username: "member", role: "Member", ashat_user_id: "u-member" };

function pngDataUrl(): string {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  Buffer.from("IHDR").copy(bytes, 12);
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function makeReq(authHeader: string, body: unknown): IncomingMessage {
  return {
    method: "POST",
    url: "/api/admin/visual-capture",
    headers: { authorization: authHeader } as IncomingMessage["headers"],
    body,
  } as unknown as IncomingMessage;
}

interface MockResponse extends ServerResponse {
  status: number;
  body: unknown;
}

function makeRes(): MockResponse {
  const res = {
    status: 0,
    body: null,
    writeHead(status: number) {
      res.status = status;
      return res;
    },
    end(chunk?: string) {
      if (chunk !== undefined) res.body = JSON.parse(chunk);
      return res;
    },
  } as unknown as MockResponse;
  return res;
}

async function authHeader(account: typeof ADMIN): Promise<string> {
  const token = await generateAccessToken({
    accountId: account.id,
    ashatUserId: account.ashat_user_id,
    username: account.username,
    role: account.role,
  });
  return `Bearer ${token}`;
}

const metadata = {
  zoneId: "zone-clover-village",
  map: { width: 75, height: 75 },
  camera: { zoom: 0.8 },
  entities: [{ id: "local-player", x: 37, y: 38 }],
};

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "paws-capture-test-"));
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("POST /api/admin/visual-capture", () => {
  it("rejects a valid Member session before touching capture storage", async () => {
    mockGetAccount.mockResolvedValue(MEMBER);
    const response = makeRes();
    await createVisualCaptureHandler({ captureDir: directory })(
      makeReq(await authHeader(MEMBER), { image: pngDataUrl(), metadata }),
      response,
    );
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: "ADMIN_REQUIRED" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("returns a conflict without overwriting an existing capture id", async () => {
    mockGetAccount.mockResolvedValue(ADMIN);
    const handler = createVisualCaptureHandler({
      captureDir: directory,
      now: () => new Date("2026-08-10T12:00:00.000Z"),
      id: () => "fixed-id",
    });
    const body = { image: pngDataUrl(), metadata };
    const first = makeRes();
    await handler(makeReq(await authHeader(ADMIN), body), first);
    const second = makeRes();
    await handler(makeReq(await authHeader(ADMIN), body), second);
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(await readdir(directory)).toHaveLength(2);
  });

  it("stores both files for an Admin and returns the server filenames", async () => {
    mockGetAccount.mockResolvedValue(ADMIN);
    const response = makeRes();
    await createVisualCaptureHandler({
      captureDir: directory,
      now: () => new Date("2026-08-10T12:00:00.000Z"),
      id: () => "fixed-id",
    })(makeReq(await authHeader(ADMIN), { image: pngDataUrl(), metadata }), response);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      imageFile: "paws-visual-2026-08-10T12-00-00-000Z-fixed-id.png",
      metadataFile: "paws-visual-2026-08-10T12-00-00-000Z-fixed-id.json",
    });
    const files = await readdir(directory);
    expect(files).toHaveLength(2);
    const savedMetadata = JSON.parse(
      await readFile(join(directory, files.find((file) => file.endsWith(".json"))!), "utf8"),
    ) as Record<string, unknown>;
    expect(savedMetadata).toMatchObject({ zoneId: metadata.zoneId, capturedBy: "admin" });
  });
});
