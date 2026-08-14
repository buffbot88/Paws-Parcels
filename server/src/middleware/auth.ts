import type { IncomingMessage, ServerResponse } from "node:http";
import { extractBearerToken, verifyAccessToken } from "../auth/index.ts";
import { getAccountByAshatId, type AccountRow } from "../models/Account.ts";
import { errorResponse } from "./index.ts";

/**
 * Authenticate an HTTP request: extract the Bearer JWT, verify it, and load
 * the linked account row. On success returns the account; on failure writes
 * the appropriate 401 response and returns null (callers must return).
 */
/** Require a valid session whose canonical account role is exactly Admin. */
export async function requireAdmin(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<AccountRow | null> {
  const account = await requireAccount(req, res);
  if (account === null) return null;
  if (account.role !== "Admin") {
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
  const token = extractBearerToken(
    typeof authHeader === "string" ? authHeader : undefined,
  );
  if (token === null) {
    errorResponse(res, 401, "UNAUTHORIZED", "Bearer token required");
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
  return account;
}
