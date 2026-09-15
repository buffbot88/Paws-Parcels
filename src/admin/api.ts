/** Typed admin API client shared by all panel screens. */

export interface ApiError extends Error {
  code: string;
  status: number;
}

const TOKEN_KEY = "paws.auth.token";
const ACCOUNT_KEY = "paws.auth.account";

/** Read the game client's stored session JWT (same keys the game writes). */
function readStoredToken(): string | null {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "string") return parsed;
    }
    const raw2 = window.localStorage.getItem(TOKEN_KEY);
    return raw2;
  } catch {
    return null;
  }
}

/** The signed-in account cached by the game client (role lives here). */
export interface CachedAccount {
  id: number;
  username: string;
  display_name: string;
  role: string;
}

export function readCachedAccount(): CachedAccount | null {
  try {
    const raw = window.localStorage.getItem(ACCOUNT_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.id !== "number" || typeof parsed.username !== "string") return null;
    return {
      id: parsed.id,
      username: parsed.username,
      display_name: String(parsed.display_name ?? parsed.username),
      role: String(parsed.role ?? "Member"),
    };
  } catch {
    return null;
  }
}

/** Sign out locally (clears the shared game session storage). */
export function clearSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // storage unavailable — nothing to clear
  }
}

/** Cookie where the server stores the per-session CSRF secret. */
const CSRF_COOKIE = "paws_csrf";
/** Header that must echo the CSRF cookie on every admin mutation. */
export const CSRF_HEADER = "X-Admin-CSRF";
/** Header carrying the short-TTL step-up token on Level 3 operations. */
export const STEP_UP_HEADER = "X-Admin-Step-Up";

/** Read the CSRF cookie (double-submit pattern: cookie + header must match). */
function readCsrfCookie(): string | null {
  const pair = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE}=`));
  return pair === undefined ? null : decodeURIComponent(pair.slice(CSRF_COOKIE.length + 1));
}

/**
 * Ensure a CSRF cookie exists by touching any admin GET (the server mints it
 * in middleware), then return its value. Cached after first success.
 */
async function ensureCsrfToken(): Promise<string | null> {
  const existing = readCsrfCookie();
  if (existing !== null) return existing;
  await fetch("/api/admin/tier", { method: "GET", credentials: "include" }).catch(() => undefined);
  return readCsrfCookie();
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  const token = readStoredToken();
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    const csrf = await ensureCsrfToken();
    if (csrf !== null) headers[CSRF_HEADER] = csrf;
  }
  const res = await fetch(path, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON response body — treated as generic error below
  }
  if (!res.ok) {
    const err = new Error(
      (payload as { message?: string } | null)?.message ?? `Request failed (${res.status})`,
    ) as ApiError;
    err.code = (payload as { error?: string } | null)?.error ?? "REQUEST_FAILED";
    err.status = res.status;
    throw err;
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) => request<T>("POST", path, body ?? {}, extraHeaders),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),

  /**
   * Mint a short-TTL step-up token for a Level 3 operation. The token is
   * single-use — send it via `stepUpHeaders()` immediately before the call.
   */
  stepUp: (reason: string) =>
    request<{ token: string; expiresAt: number; ttlSeconds: number }>("POST", "/api/admin/step-up", { reason }),
};

/** Build the step-up header object for a freshly minted token. */
export function stepUpHeaders(token: string): Record<string, string> {
  return { [STEP_UP_HEADER]: token };
}

// ---- response shapes ----

export interface Overview {
  playersOnline: number;
  maxConcurrentPlayers: number;
  registeredPlayers: number;
  characters: number;
  expRate: number;
  dropRate: number;
  honorRate: number;
  levelCap: number;
  environment: { nodeEnv: string; runningInProduction: boolean };
  serverStatus: string;
}

export interface HealthService {
  name: string;
  status: string;
  note?: string;
}

export interface ZoneStatus {
  key: string;
  name: string;
  kind: string;
  maxPlayers: number;
  isSafe: boolean;
  playersOnline: number;
}

export interface PlayerListCharacter {
  id: number;
  name: string;
  level: number;
  zoneId: string;
  classKey: string;
  stamps: number;
  experience: number;
}

export interface PlayerRow {
  accountId: number;
  username: string;
  displayName: string;
  role: string;
  status: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  characters: PlayerListCharacter[];
}

export interface AdminHistoryEntry {
  id: number;
  action: string;
  reason: string;
  createdAt: string;
}

export interface PlayerDetail extends PlayerRow {
  email: string | null;
  adminHistory: AdminHistoryEntry[];
}

export interface AuditEntry {
  id: number;
  adminAccountId: number | null;
  adminUsername: string;
  action: string;
  category: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  environment: string;
  reason: string;
  beforeState: unknown;
  afterState: unknown;
  requestId: string;
  ip: string;
  createdAt: string;
}

export interface ServerSettings {
  expRate: number;
  dropRate: number;
  honorRate: number;
  maxConcurrentPlayers: number;
  levelCap: number;
  meta: { key: string; value: string; updatedBy: string; updatedAt: string }[];
}

export interface TierInfo {
  tier: "none" | "support" | "moderator" | "admin" | "developer";
  role: string;
  username: string;
  displayName: string;
}

// ---- roles & permissions (spec §70–71) ----

export interface AdminRole {
  roleKey: string;
  displayName: string;
  description: string;
  minTier: string;
  isSystem: boolean;
  permissions: string[];
  assignedCount: number;
}

export interface RolesResponse {
  roles: AdminRole[];
  allPermissions: string[];
  caller: {
    accountId: number;
    username: string;
    tier: string;
    assignedRoles: string[];
    canManageRoles: boolean;
  };
}

export interface AdminUserRow {
  accountId: number;
  username: string;
  displayName: string;
  hubRole: string;
  tier: string;
  status: string;
  lastLoginAt: string | null;
  assignedRoles: string[];
}
