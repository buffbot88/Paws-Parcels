import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/src/config/index.ts", () => ({
  server: { port: 3001, host: "127.0.0.1", nodeEnv: "testing", isDev: true, corsAllowedOrigins: [], debug: false, staticDir: "" },
  db: { file: ":memory:" },
  auth: { jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x", accessTokenTtlSeconds: 900 },
  oidc: { clientId: "test", redirectUri: "http://localhost/callback", scopes: "openid", discoveryUrl: "https://test/.well-known", issuer: "https://test", jwksTtlSeconds: 600 },
  admin: { roleTiers: {} },
  ai: { enabled: false, port: 3101, modelPath: "", mmprojPath: "", idleMs: 600000, warmupTimeoutMs: 90000, requestTimeoutMs: 4000, monsterDecisionIntervalMs: 5000, maxTokensMonster: 40, maxTokensNpc: 160, npcTalkMinIntervalMs: 6000 },
}));
import {
  isLegacyMigrationChecksum,
  migrationChecksum,
} from "../../server/src/db/migrate.ts";

describe("migration checksums", () => {
  it("uses SHA-256 for newly applied migration content", () => {
    const content = "CREATE TABLE parcels (id INTEGER);\n";
    expect(migrationChecksum(content)).toBe(
      createHash("sha256").update(content, "utf8").digest("hex"),
    );
    expect(migrationChecksum(content)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("recognizes historical decimal file-length checksums as legacy", () => {
    expect(isLegacyMigrationChecksum("1234")).toBe(true);
    expect(isLegacyMigrationChecksum("0")).toBe(true);
    expect(isLegacyMigrationChecksum("sha256:1234")).toBe(false);
    expect(isLegacyMigrationChecksum("not-a-checksum")).toBe(false);
  });
});
