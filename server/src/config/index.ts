import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Unified server config loader. Config comes from `server_config.json` at the
 * project root (missing file, malformed shape, or placeholder secrets cause
 * the server to fail fast). The ONE deliberate process.env exception is the
 * listen port: PaaS hosts (Render/Railway/Fly) inject it via $PORT.
 */

const CONFIG_RELATIVE_PATH = "server_config.json";
const JWS_PLACEHOLDER = "REPLACE_ME_JWT_SECRET_AT_LEAST_32_CHARS_LONG";

function resolveConfigPath(): string {
  return resolve(process.cwd(), CONFIG_RELATIVE_PATH);
}

class ConfigLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigLoadError";
  }
}

function loadConfigFromDisk(): unknown {
  const cfgPath = resolveConfigPath();
  if (!existsSync(cfgPath)) {
    throw new ConfigLoadError(
      `Missing ${CONFIG_RELATIVE_PATH} at project root. ` +
        `Copy server_config.example.json -> ${CONFIG_RELATIVE_PATH} and fill in the secrets.`,
    );
  }
  try {
    return JSON.parse(readFileSync(cfgPath, "utf-8"));
  } catch (err) {
    throw new ConfigLoadError(
      `Could not parse ${CONFIG_RELATIVE_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: string;
  isDev: boolean;
  corsAllowedOrigins: string[];
  debug: boolean;
  /**
   * Directory (relative to project root) of the built client to serve from
   * this process. Empty string disables static serving (API/WS only).
   */
  staticDir: string;
}

export interface DbConfig {
  /** Path to the SQLite database file (relative to the project root). */
  file: string;
}

export interface AuthConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
}

export interface OidcConfig {
  clientId: string;
  redirectUri: string;
  scopes: string;
  discoveryUrl: string;
  issuer: string;
  jwksTtlSeconds: number;
}

export interface AdminConfig {
  /** ASHAT Hub role -> admin tier overrides (merged over defaults). */
  roleTiers: Record<string, string>;
}

export interface AiConfig {
  /** Master switch — when false the AI game engine is inert (default). */
  enabled: boolean;
  /** Port for the game-owned llama-server instance (separate from the Hub's). */
  port: number;
  /** Path to the GGUF model (LFM2.5-VL-450M) and its vision projector. */
  modelPath: string;
  mmprojPath: string;
  /** Spin the instance down after this long without requests. */
  idleMs: number;
  /** Max time to wait for the instance to reach /health ready. */
  warmupTimeoutMs: number;
  /** Per-inference HTTP timeout; a miss falls back to deterministic AI. */
  requestTimeoutMs: number;
  /** How often the monster brain asks the model per zone. */
  monsterDecisionIntervalMs: number;
  maxTokensMonster: number;
  maxTokensNpc: number;
  /** Min ms between /api/npc/talk calls per account (1-core protection). */
  npcTalkMinIntervalMs: number;
}

const RAW = loadConfigFromDisk();
const cfg = validateAndNormalize(RAW);

function validateAndNormalize(raw: unknown): {
  server: ServerConfig;
  db: DbConfig;
  auth: AuthConfig;
  oidc: OidcConfig;
  admin: AdminConfig;
  ai: AiConfig;
} {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    throw new ConfigLoadError(
      `${CONFIG_RELATIVE_PATH} must be a JSON object at the top level.`,
    );
  }

  const obj = raw as Record<string, unknown>;
  const serverRaw = (obj.server ?? {}) as Record<string, unknown>;
  const dbRaw = (obj.db ?? {}) as Record<string, unknown>;
  const authRaw = (obj.auth ?? {}) as Record<string, unknown>;
  const oidcRaw = (obj.oidc ?? {}) as Record<string, unknown>;
  const aiRaw = (obj.ai ?? {}) as Record<string, unknown>;
  const adminRaw = (obj.admin ?? {}) as Record<string, unknown>;

  // server
  const configuredPort = num(serverRaw.port, 3001, errors, "server.port");
  // PaaS hosts inject the listen port via $PORT — honor it when present.
  const envPort = Number(process.env.PORT);
  const port =
    Number.isFinite(envPort) && envPort > 0 ? envPort : configuredPort;
  const host = str(serverRaw.host, "0.0.0.0", errors, "server.host");
  const nodeEnv = str(serverRaw.nodeEnv, "development", errors, "server.nodeEnv");
  const isDev = nodeEnv === "development";
  const corsAllowedOrigins = list(
    serverRaw.corsAllowedOrigins,
    ["http://localhost:5173", "http://localhost:3001"],
    errors,
    "server.corsAllowedOrigins",
  );
  const debug = bool(serverRaw.debug, isDev, errors, "server.debug");
  const staticDir = str(serverRaw.staticDir, "dist", errors, "server.staticDir");

  // db
  const dbFile = reqStr(dbRaw.file, "db.file", "", errors);

  // auth
  const jwtSecret = reqStr(
    authRaw.jwtSecret,
    "auth.jwtSecret",
    JWS_PLACEHOLDER,
    errors,
  );
  if (jwtSecret && jwtSecret.length < 32) {
    errors.push(
      `auth.jwtSecret must be at least 32 characters (got ${jwtSecret.length}).`,
    );
  }
  const accessTokenTtl = num(
    authRaw.accessTokenTtlSeconds,
    86_400,
    errors,
    "auth.accessTokenTtlSeconds",
  );

  // oidc (Phase 3 — ASHAT Hub as an OIDC issuer)
  const clientId = reqStr(oidcRaw.clientId, "oidc.clientId", "", errors);
  const redirectUri = reqStr(oidcRaw.redirectUri, "oidc.redirectUri", "", errors);
  if (redirectUri !== "" && !/^https?:\/\//.test(redirectUri)) {
    errors.push(
      `oidc.redirectUri must start with http:// or https:// (got "${redirectUri}").`,
    );
  }
  const scopes = str(oidcRaw.scopes, "openid profile", errors, "oidc.scopes");
  const discoveryUrl = reqStr(
    oidcRaw.discoveryUrl,
    "oidc.discoveryUrl",
    "",
    errors,
  );
  if (discoveryUrl !== "" && !/^https?:\/\//.test(discoveryUrl)) {
    errors.push(
      `oidc.discoveryUrl must start with http:// or https:// (got "${discoveryUrl}").`,
    );
  }
  const issuer = reqStr(oidcRaw.issuer, "oidc.issuer", "", errors);
  if (issuer !== "" && !/^https?:\/\//.test(issuer)) {
    errors.push(
      `oidc.issuer must start with http:// or https:// (got "${issuer}").`,
    );
  }
  const jwksTtlSeconds = num(
    oidcRaw.jwksTtlSeconds,
    600,
    errors,
    "oidc.jwksTtlSeconds",
  );
  if (jwksTtlSeconds < 30 || jwksTtlSeconds > 86400) {
    errors.push(
      `oidc.jwksTtlSeconds must be 30-86400 (got ${jwksTtlSeconds}).`,
    );
  }

  // admin — role-tier mapping (values are validated leniently: unknown tier
  // strings simply resolve to 'none' at the call site).
  let roleTiers: Record<string, string> = {};
  const roleTiersRaw = adminRaw.roleTiers;
  if (roleTiersRaw !== undefined) {
    if (typeof roleTiersRaw !== "object" || roleTiersRaw === null || Array.isArray(roleTiersRaw)) {
      errors.push("admin.roleTiers must be an object of { role: tier }.");
    } else {
      roleTiers = Object.fromEntries(
        Object.entries(roleTiersRaw as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      );
    }
  }

  if (errors.length > 0) {
    throw new ConfigLoadError(
      `Invalid ${CONFIG_RELATIVE_PATH}:\n  - ${errors.join("\n  - ")}`,
    );
  }

  // ai — AI game engine (Phase 4 experimental: power-managed 450M VL)
  const aiEnabled = bool(aiRaw.enabled, false, errors, "ai.enabled");
  const aiPort = num(aiRaw.port, 3101, errors, "ai.port");
  const modelPath = aiEnabled
    ? reqStr(aiRaw.modelPath, "ai.modelPath", "", errors)
    : str(aiRaw.modelPath, "", errors, "ai.modelPath");
  const mmprojPath = aiEnabled
    ? reqStr(aiRaw.mmprojPath, "ai.mmprojPath", "", errors)
    : str(aiRaw.mmprojPath, "", errors, "ai.mmprojPath");
  const idleMs = num(aiRaw.idleMs, 600_000, errors, "ai.idleMs");
  const warmupTimeoutMs = num(
    aiRaw.warmupTimeoutMs,
    90_000,
    errors,
    "ai.warmupTimeoutMs",
  );
  const requestTimeoutMs = num(
    aiRaw.requestTimeoutMs,
    4_000,
    errors,
    "ai.requestTimeoutMs",
  );
  const monsterDecisionIntervalMs = num(
    aiRaw.monsterDecisionIntervalMs,
    5_000,
    errors,
    "ai.monsterDecisionIntervalMs",
  );
  const maxTokensMonster = num(aiRaw.maxTokensMonster, 40, errors, "ai.maxTokensMonster");
  const maxTokensNpc = num(aiRaw.maxTokensNpc, 160, errors, "ai.maxTokensNpc");
  const npcTalkMinIntervalMs = num(
    aiRaw.npcTalkMinIntervalMs,
    6_000,
    errors,
    "ai.npcTalkMinIntervalMs",
  );
  if (idleMs < 5_000) {
    errors.push(`ai.idleMs must be at least 5000ms (got ${idleMs}).`);
  }
  if (requestTimeoutMs < 200 || requestTimeoutMs > 60_000) {
    errors.push(`ai.requestTimeoutMs must be 200-60000 (got ${requestTimeoutMs}).`);
  }
  if (npcTalkMinIntervalMs < 1000) {
    errors.push(
      `ai.npcTalkMinIntervalMs must be at least 1000ms (got ${npcTalkMinIntervalMs}).`,
    );
  }

  return {
    server: { port, host, nodeEnv, isDev, corsAllowedOrigins, debug, staticDir },
    db: {
      file: dbFile,
    },
    auth: {
      jwtSecret,
      accessTokenTtlSeconds: accessTokenTtl,
    },
    oidc: {
      clientId,
      redirectUri,
      scopes,
      discoveryUrl,
      issuer: issuer.replace(/\/$/, ""),
      jwksTtlSeconds,
    },
    ai: {
      enabled: aiEnabled,
      port: aiPort,
      modelPath,
      mmprojPath,
      idleMs,
      warmupTimeoutMs,
      requestTimeoutMs,
      monsterDecisionIntervalMs,
      maxTokensMonster,
      maxTokensNpc,
      npcTalkMinIntervalMs,
    },
    admin: {
      roleTiers,
    },
  };
}

// --- validators ---

function str(
  value: unknown,
  fallback: string,
  errors: string[],
  key: string,
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") {
    errors.push(`${key} must be a string.`);
    return fallback;
  }
  return value;
}

function num(
  value: unknown,
  fallback: number,
  errors: string[],
  key: string,
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${key} must be a finite number.`);
    return fallback;
  }
  return value;
}

function bool(
  value: unknown,
  fallback: boolean,
  errors: string[],
  key: string,
): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    errors.push(`${key} must be a boolean.`);
    return fallback;
  }
  return value;
}

function list(
  value: unknown,
  fallback: string[],
  errors: string[],
  key: string,
): string[] {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    errors.push(`${key} must be an array of strings.`);
    return fallback;
  }
  return value as string[];
}

function reqStr(
  value: unknown,
  key: string,
  placeholder: string,
  errors: string[],
): string {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${key} is required.`);
    return "";
  }
  if (value === placeholder) {
    errors.push(`${key} is still the placeholder value — replace it.`);
    return value;
  }
  return value;
}

export const server: ServerConfig = cfg.server;
export const db: DbConfig = cfg.db;
export const auth: AuthConfig = cfg.auth;
export const oidc: OidcConfig = cfg.oidc;
export const ai: AiConfig = cfg.ai;
export const admin: AdminConfig = cfg.admin;
