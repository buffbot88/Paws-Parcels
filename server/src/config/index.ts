import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from the server root (one dir up from src/config)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../../.env");

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function req(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return v;
}

function reqInt(key: string, fallback?: number): number {
  const v = process.env[key];
  if (v !== undefined) {
    const n = parseInt(v, 10);
    if (!isNaN(n)) return n;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable (integer): ${key}`);
}

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: string;
  isDev: boolean;
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

export const server: ServerConfig = {
  port: reqInt("SERVER_PORT", 3001),
  host: req("SERVER_HOST", "0.0.0.0"),
  nodeEnv: req("NODE_ENV", "development"),
  isDev: (req("NODE_ENV", "development") === "development"),
};

export const db: DbConfig = {
  host: req("DB_HOST", "localhost"),
  port: reqInt("DB_PORT", 3306),
  user: req("DB_USER", "paws_user"),
  password: req("DB_PASSWORD"),
  database: req("DB_NAME", "paws_and_parcels"),
};

export const auth: AuthConfig = {
  jwtSecret: req("JWT_SECRET"),
  accessTokenTtlSeconds: reqInt("JWT_ACCESS_TOKEN_TTL", 900),
  refreshTokenTtlSeconds: reqInt("JWT_REFRESH_TOKEN_TTL", 604800),
  bcryptRounds: reqInt("BCRYPT_ROUNDS", 12),
};

export function validateConfig(): string[] {
  const errors: string[] = [];
  try { server; } catch (e: any) { errors.push(e.message); }
  try { db; } catch (e: any) { errors.push(e.message); }
  try { auth; } catch (e: any) { errors.push(e.message); }
  return errors;
}