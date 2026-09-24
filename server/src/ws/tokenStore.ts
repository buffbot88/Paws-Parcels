import { randomBytes } from "node:crypto";

/**
 * In-memory store for short-lived, single-use WebSocket handshake tokens
 * (design/architecture.md §5: 30s TTL, one use). Issued by GET /api/ws-token
 * and consumed by the first WS `authenticate` message.
 */

const WS_TOKEN_TTL_MS = 30_000;
/** Outstanding-token cap per account — bounds memory if issuance is spammed. */
const MAX_TOKENS_PER_ACCOUNT = 5;

interface WsTokenEntry {
  accountId: number;
  characterId: number;
  expiresAt: number;
  used: boolean;
}

const store = new Map<string, WsTokenEntry>();

/** Issue a fresh one-time WS handshake token bound to an account+character. */
export function issueWsToken(
  accountId: number,
  characterId: number,
): string {
  const now = Date.now();
  // Expired tokens are only deleted on consume, so prune them here — this is
  // the only place the store grows.
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) store.delete(key);
  }
  // Enforce the per-account cap, dropping the oldest tokens first.
  const mine: string[] = [];
  for (const [key, entry] of store) {
    if (entry.accountId === accountId) mine.push(key);
  }
  for (const key of mine.slice(0, Math.max(0, mine.length - (MAX_TOKENS_PER_ACCOUNT - 1)))) {
    store.delete(key);
  }
  const token = randomBytes(24).toString("base64url");
  store.set(token, {
    accountId,
    characterId,
    expiresAt: now + WS_TOKEN_TTL_MS,
    used: false,
  });
  return token;
}

/**
 * Consume a WS handshake token. Returns the bound identity, or null when the
 * token is unknown, expired, or already used. Tokens are deleted on consume
 * so they cannot be replayed even within the TTL.
 */
export function consumeWsToken(
  token: string,
): { accountId: number; characterId: number } | null {
  const entry = store.get(token);
  if (entry === undefined) return null;
  store.delete(token);
  if (entry.used || entry.expiresAt < Date.now()) return null;
  entry.used = true;
  return { accountId: entry.accountId, characterId: entry.characterId };
}

/** Forget all issued tokens (used by tests). */
export function resetWsTokenStore(): void {
  store.clear();
}

/** The token TTL in seconds — echoed to clients as `expiresIn`. */
export const WS_TOKEN_TTL_SECONDS = WS_TOKEN_TTL_MS / 1000;
