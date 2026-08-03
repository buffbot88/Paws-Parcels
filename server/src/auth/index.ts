import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { auth as authConfig, ashatHub as ashatConfig } from "../config/index.ts";
import { logger } from "../middleware/logger.ts";

/** Hash a plain-text password using bcryptjs. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, authConfig.bcryptRounds);
}

/** Compare a plain-text password against a stored hash. */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Generate a short-lived access token (JWT). */
export async function generateAccessToken(payload: {
  accountId: number;
  ashatUserId: string;
  username: string;
  role: string;
}): Promise<string> {
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${authConfig.accessTokenTtlSeconds}s`)
    .setIssuedAt()
    .sign(new TextEncoder().encode(authConfig.jwtSecret));
}

/** Verify and decode an access token. Returns null on failure. */
export async function verifyAccessToken(
  token: string,
): Promise<{
  accountId: number;
  ashatUserId: string;
  username: string;
  role: string;
} | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(authConfig.jwtSecret),
    );
    return {
      accountId: Number(payload.accountId),
      ashatUserId: String(payload.ashatUserId ?? ""),
      username: String(payload.username ?? ""),
      role: String(payload.role ?? "Member"),
    };
  } catch {
    return null;
  }
}

/** Extract the Bearer token from an Authorization header. */
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}

// ===== Ashat Hub SSO bridge (Phase 2) =====

export interface AshatVerifyResult {
  valid: true;
  user_id: string;
  username: string;
  role: string;
  display_name: string;
  session_expires_at: string;
}

/**
 * Server-to-server post to Ashat Hub's POST /api/sso/verify-session trust
 * anchor. The shared secret in the X-Paws-Shared-Secret header is the only
 * auth this call carries; refactor to JWKS-verified JWTs when the surface
 * grows (see design/architecture.md §6 — planned).
 *
 * `fetcher` is injected so tests can stub it without mocking node globals.
 */
export async function verifyAshatSession(
  sessionId: string,
  fetcher: typeof fetch = fetch,
): Promise<AshatVerifyResult | null> {
  if (
    ashatConfig.sharedSecret === "" ||
    ashatConfig.sharedSecret.length < 32
  ) {
    logger.error(
      "verifyAshatSession: ashatHub.sharedSecret is missing or too short",
    );
    return null;
  }
  const url = `${ashatConfig.baseUrl}${ashatConfig.verifyPath}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    ashatConfig.verifyTimeoutMs,
  );
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "X-Paws-Shared-Secret": ashatConfig.sharedSecret,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ session_id: sessionId }),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn("verifyAshatSession: non-2xx response", {
        status: response.status,
      });
      return null;
    }
    const payload: unknown = await response.json();
    if (!isAshatVerifyResult(payload)) {
      logger.warn("verifyAshatSession: response shape invalid", { payload });
      return null;
    }
    return payload;
  } catch (err) {
    logger.error("verifyAshatSession: fetch failed", { error: String(err) });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAshatVerifyResult(value: unknown): value is AshatVerifyResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.valid === true &&
    typeof v.user_id === "string" &&
    typeof v.username === "string" &&
    typeof v.role === "string" &&
    typeof v.display_name === "string"
  );
}
