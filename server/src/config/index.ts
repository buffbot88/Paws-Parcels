import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Unified server config loader. Never reads process.env — config comes
 * exclusively from `server_config.json` at the project root. Missing file,
 * malformed shape, or placeholder secrets cause the server to fail fast.
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
}

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface AuthConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  bcryptRounds: number;
}

export interface OidcConfig {
  clientId: string;
  redirectUri: string;
  scopes: string;
  discoveryUrl: string;
  issuer: string;
  jwksTtlSeconds: number;
}

const RAW = loadConfigFromDisk();
const cfg = validateAndNormalize(RAW);

function validateAndNormalize(raw: unknown): {
  server: ServerConfig;
  db: DbConfig;
  auth: AuthConfig;
  oidc: OidcConfig;
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

  // server
  const port = num(serverRaw.port, 3001, errors, "server.port");
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

  // db
  const dbHost = str(dbRaw.host, "localhost", errors, "db.host");
  const dbPort = num(dbRaw.port, 3306, errors, "db.port");
  const dbUser = str(dbRaw.user, "paws_user", errors, "db.user");
  const dbPassword = reqStr(
    dbRaw.password,
    "db.password",
    "REPLACE_ME_DB_PASSWORD",
    errors,
  );
  const dbName = str(dbRaw.database, "paws_and_parcels", errors, "db.database");

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
    900,
    errors,
    "auth.accessTokenTtlSeconds",
  );
  const refreshTokenTtl = num(
    authRaw.refreshTokenTtlSeconds,
    604800,
    errors,
    "auth.refreshTokenTtlSeconds",
  );
  const bcryptRounds = num(
    authRaw.bcryptRounds,
    12,
    errors,
    "auth.bcryptRounds",
  );
  if (bcryptRounds < 4 || bcryptRounds > 15) {
    errors.push(`auth.bcryptRounds must be 4-15 (got ${bcryptRounds}).`);
  }

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

  if (errors.length > 0) {
    throw new ConfigLoadError(
      `Invalid ${CONFIG_RELATIVE_PATH}:\n  - ${errors.join("\n  - ")}`,
    );
  }

  return {
    server: { port, host, nodeEnv, isDev, corsAllowedOrigins, debug },
    db: {
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
    },
    auth: {
      jwtSecret,
      accessTokenTtlSeconds: accessTokenTtl,
      refreshTokenTtlSeconds: refreshTokenTtl,
      bcryptRounds,
    },
    oidc: {
      clientId,
      redirectUri,
      scopes,
      discoveryUrl,
      issuer: issuer.replace(/\/$/, ""),
      jwksTtlSeconds,
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
