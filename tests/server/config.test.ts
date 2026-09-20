import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: () => true,
  readFileSync: () => JSON.stringify({
    server: { port: 3001, host: "127.0.0.1", nodeEnv: "test", corsAllowedOrigins: [], debug: false, staticDir: "" },
    db: { file: ":memory:" },
    auth: { jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x", accessTokenTtlSeconds: 900 },
    oidc: { clientId: "test-client", redirectUri: "http://localhost/callback", scopes: "openid", discoveryUrl: "https://issuer.test/.well-known", issuer: "https://issuer.test", jwksTtlSeconds: 600 },
    admin: { roleTiers: {} },
    ai: { enabled: false },
  }),
}));

const { validateAndNormalize } = await import("../../server/src/config/index.ts");

function validConfig(): Record<string, unknown> {
  return {
    server: { port: 3001, host: "127.0.0.1", nodeEnv: "test", corsAllowedOrigins: [], debug: false, staticDir: "" },
    db: { file: ":memory:" },
    auth: { jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x", accessTokenTtlSeconds: 900 },
    oidc: {
      clientId: "test-client",
      redirectUri: "http://localhost/callback",
      scopes: "openid",
      discoveryUrl: "https://issuer.test/.well-known/openid-configuration",
      issuer: "https://issuer.test",
      jwksTtlSeconds: 600,
    },
    admin: { roleTiers: {} },
    ai: { enabled: false },
  };
}

describe("server configuration AI validation", () => {
  it("accepts valid AI-disabled configuration", () => {
    const config = validateAndNormalize(validConfig());
    expect(config.ai.enabled).toBe(false);
    expect(config.ai.modelPath).toBe("");
  });

  it("accepts valid AI-enabled configuration", () => {
    const raw = validConfig();
    raw.ai = {
      enabled: true,
      modelPath: "/models/game.gguf",
      mmprojPath: "/models/projector.gguf",
      idleMs: 5_000,
      requestTimeoutMs: 200,
      npcTalkMinIntervalMs: 1_000,
    };
    expect(validateAndNormalize(raw).ai.enabled).toBe(true);
  });

  it.each([
    ["idleMs", 4_999],
    ["requestTimeoutMs", 199],
    ["npcTalkMinIntervalMs", 999],
  ])("rejects invalid AI %s", (key, value) => {
    const raw = validConfig();
    raw.ai = { enabled: false, [key]: value };
    expect(() => validateAndNormalize(raw)).toThrow(new RegExp(`ai\\.${key}`));
  });

  it.each(["modelPath", "mmprojPath"])("rejects enabled AI with missing %s", (key) => {
    const raw = validConfig();
    raw.ai = { enabled: true, modelPath: "/models/game.gguf", mmprojPath: "/models/projector.gguf" };
    delete (raw.ai as Record<string, unknown>)[key];
    expect(() => validateAndNormalize(raw)).toThrow(new RegExp(`ai\\.${key}`));
  });
});
