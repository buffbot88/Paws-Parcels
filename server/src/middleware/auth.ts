import type { IncomingMessage, ServerResponse } from "node:http";
import { extractBearerToken, verifyAccessToken } from "../auth/index.ts";
import { readSessionCookie } from "../auth/sessionCookie.ts";
import { getAccountByAshatId, type AccountRow } from "../models/Account.ts";
import { adminTierForRole, tierSatisfies } from "../models/Admin.ts";
import { errorResponse } from "./index.ts";

/**
 * Accounts carrying this status are locked out of the game and the API —
 * suspension and bans are enforced at both the HTTP and WS auth paths.
 */
const BLOCKED_ACCOUNT_STATUSES = new Set(["suspended", "banned"]);

/**
 * Authenticate an HTTP request: extract the Bearer JWT, verify it, and load
 * the linked account row. On success returns the account; on failure writes
 * the appropriate 401 response and returns null (callers must return).
 */
/** Require a valid session whose account role maps to the admin tier or above. */
export async function requireAdmin(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<AccountRow | null> {
  const account = await requireAccount(req, res);
  if (account === null) return null;
  if (!tierSatisfies(adminTierForRole(account.role), "admin")) {
    errorResponse(res, 403, "ADMIN_REQUIRED", "Admin role required");
    return null;
  }
  return account;
}

export async function requireAccount(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<AccountRow | null> {
  const authHeader = req.headers["authorization"];
  const token =
    extractBearerToken(typeof authHeader === "string" ? authHeader : undefined) ??
    readSessionCookie(req.headers.cookie);
  if (token === null) {
    errorResponse(res, 401, "UNAUTHORIZED", "Session cookie or Bearer token required");
    return null;
  }
  const payload = await verifyAccessToken(token);
  if (payload === null) {
    errorResponse(res, 401, "INVALID_TOKEN", "JWT verification failed");
    return null;
  }
  const account = await getAccountByAshatId(payload.ashatUserId);
  if (account === null) {
    errorResponse(
      res,
      401,
      "ACCOUNT_GONE",
      "Linked Ashat account no longer exists",
    );
    return null;
  }
  const status = await getAccountStatus(account.id);
  if (status !== null && BLOCKED_ACCOUNT_STATUSES.has(status)) {
    errorResponse(
      res,
      403,
      "ACCOUNT_SUSPENDED",
      status === "banned" ? "This account is banned" : "This account is suspended",
    );
    return null;
  }
  return account;
}

/** Read the account status column (migration 001) for ban enforcement. */
async function getAccountStatus(accountId: number): Promise<string | null> {
  try {
    const { getDb } = await import("../db/connection.ts");
    const row = getDb()
      .prepare("SELECT status FROM accounts WHERE id = ? LIMIT 1")
      .get(accountId) as { status?: unknown } | undefined;
    return row === undefined || row.status === undefined ? null : String(row.status);
  } catch {
    return null;
  }
}
