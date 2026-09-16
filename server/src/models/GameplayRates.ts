import { getDb } from "../db/connection.ts";

type SqlRow = Record<string, unknown>;

/**
 * Cached gameplay rate multipliers from the `server_settings` table.
 *
 * These feed the hot XP-grant and loot-roll code paths, so reads are cached
 * in memory with a short TTL instead of hitting SQLite every combat tick.
 * The cache is refreshed in three ways:
 * - TTL expiry (10s) — catches out-of-band DB edits (other processes, SQL).
 * - `setServerSetting()` (the admin settings write path) calls
 *   `refreshGameplayRates()` inline, so a panel change applies to the very next
 *   kill/loot/quest hand-in rather than waiting for the TTL.
 * - `invalidateGameplayRates()` — explicit drop (tests, manual invalidation).
 *
 * All values are fail-safe: a missing/corrupt table or non-numeric value
 * falls back to 1.0× so gameplay never breaks because of a settings typo.
 */

export interface GameplayRates {
  expRate: number;
  dropRate: number;
}

const CACHE_TTL_MS = 10_000;

const cache: { rates: GameplayRates; loadedAt: number } = {
  rates: { expRate: 1, dropRate: 1 },
  loadedAt: 0,
};

function readRate(key: string, fallback: number): number {
  try {
    const row = getDb().prepare("SELECT `value` FROM server_settings WHERE `key` = ?").get(key) as
      | SqlRow
      | undefined;
    if (row === undefined) return fallback;
    const parsed = Number(row.value);
    // Reject NaN, negatives, and absurd values — 1.0 is safer than a typo.
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fallback;
    return parsed;
  } catch {
    // Table missing (pre-migration DB) or DB not ready — keep the default.
    return fallback;
  }
}

function loadRates(): GameplayRates {
  return {
    expRate: readRate("exp_rate", 1),
    dropRate: readRate("drop_rate", 1),
  };
}

/** Current multipliers, served from cache and refreshed at most every 10s. */
export function getGameplayRates(): GameplayRates {
  const now = Date.now();
  if (now - cache.loadedAt > CACHE_TTL_MS) {
    cache.rates = loadRates();
    cache.loadedAt = now;
  }
  return cache.rates;
}

/** Drop the cache so the next read reloads from the DB. */
export function invalidateGameplayRates(): void {
  cache.loadedAt = 0;
}

/** Force a reload now and return the fresh values (used after settings writes). */
export function refreshGameplayRates(): GameplayRates {
  cache.rates = loadRates();
  cache.loadedAt = Date.now();
  return cache.rates;
}

/** Test helper: reset cache and clock so tests start from a clean slate. */
export function resetGameplayRatesCache(): void {
  cache.rates = { expRate: 1, dropRate: 1 };
  cache.loadedAt = 0;
}
