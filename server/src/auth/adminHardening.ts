import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "../db/connection.ts";
import { auth as authConfig } from "../config/index.ts";

/**
 * Admin session hardening (three layers):
 *
 * 1. CSRF double-submit token — a random value in a cookie paired with an
 *    `X-Admin-CSRF` header on every admin mutation. A cross-site attacker can
 *    neither read the cookie (same-origin policy) nor set a custom header.
 * 2. Short-TTL step-up tokens — HMAC-signed single-use tokens minted by
 *    `POST /api/admin/step-up` after a password-free re-confirmation window;
 *    Level 3 (dangerous) operations must present one.
 * 3. Replay protection — step-up token JTI values land in an in-memory set
 *    until expiry, so a token intercepted in transit cannot be replayed.
 */

// ---- 1. CSRF double-submit ----

export const CSRF_COOKIE = "paws_csrf";
export const CSRF_HEADER = "x-admin-csrf";

/** Create (or reuse) the per-session CSRF secret and derive the cookie value. */
export function issueCsrfToken(reqCookie: string | null): string {
  if (reqCookie !== null && reqCookie.length === 64) return reqCookie;
  return randomBytes(32).toString("hex");
}

/** True when the header matches the cookie (constant-time compare). */
export function csrfMatches(cookieValue: string | null, headerValue: string | null): boolean {
  if (cookieValue === null || headerValue === null) return false;
  if (cookieValue.length !== headerValue.length) return false;
  return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(headerValue));
}

// ---- 2. Short-TTL step-up tokens ----

const STEP_UP_TTL_MS = 5 * 60 * 1000;

export interface StepUpToken {
  token: string;
  expiresAt: number;
}

function stepUpSecret(): Buffer {
  // Derived from the server JWT secret — same trust domain, no extra config.
  return Buffer.from(authConfig.jwtSecret, "utf-8");
}

interface StepUpPayload {
  accountId: number;
  issuedAt: number;
  expiresAt: number;
  jti: string;
}

/** Mint a single-use, account-bound step-up token. */
export function mintStepUpToken(accountId: number): StepUpToken {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + STEP_UP_TTL_MS;
  const jti = randomBytes(16).toString("hex");
  const payload: StepUpPayload = { accountId, issuedAt, expiresAt, jti };
  const body = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", stepUpSecret()).update(body).digest("base64url");
  sweepReplay();
  return { token: `${body}.${sig}`, expiresAt };
}

export type StepUpVerifyResult =
  | { ok: true }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "WRONG_ACCOUNT" | "REPLAYED" };

/** Replay guard: jtis seen until their expiry (single-use). */
const usedJtis = new Map<string, number>();

function sweepReplay(): void {
  const now = Date.now();
  for (const [jti, expiry] of usedJtis) {
    if (expiry <= now) usedJtis.delete(jti);
  }
}

/** Verify + consume a step-up token (single use, account-bound, TTL-bounded). */
export function verifyStepUpToken(token: string, accountId: number): StepUpVerifyResult {
  const dot = token.indexOf(".");
  if (dot === -1) return { ok: false, reason: "MALFORMED" };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", stepUpSecret()).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }
  let payload: StepUpPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as StepUpPayload;
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (typeof payload.expiresAt !== "number" || payload.expiresAt <= Date.now()) {
    return { ok: false, reason: "EXPIRED" };
  }
  if (Number(payload.accountId) !== accountId) {
    return { ok: false, reason: "WRONG_ACCOUNT" };
  }
  sweepReplay();
  if (usedJtis.has(payload.jti)) {
    return { ok: false, reason: "REPLAYED" };
  }
  usedJtis.set(payload.jti, payload.expiresAt);
  return { ok: true };
}

/** Test helper: drop all replay state. */
export function resetStepUpState(): void {
  usedJtis.clear();
}
