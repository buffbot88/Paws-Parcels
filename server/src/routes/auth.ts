import { jwtVerify } from "jose";
import type { IncomingMessage, ServerResponse } from "node:http";
import { auth as authConfig, ashatHub as ashatConfig } from "../config/index.ts";
import {
  extractBearerToken,
  verifyAccessToken,
  verifyAshatSession,
} from "../auth/index.ts";
import {
  findOrCreateAccountByAshatId,
  getAccountByAshatId,
} from "../models/Account.ts";
import { getCharactersByAccountId } from "../models/Character.ts";
import { errorResponse, jsonResponse } from "../middleware/index.ts";
import { logger } from "../middleware/logger.ts";

/**
 * GET /api/auth/login-url
 * Returns the Ashat Hub URL the client should open in a popup. The client
 * uses postMessage from the popup back to the parent (window.opener) on
 * completion — see public/sso-callback.html (added in the client phase).
 */
export async function loginUrlHandler(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (
    ashatConfig.sharedSecret === "" ||
    ashatConfig.sharedSecret.length < 32 ||
    ashatConfig.callbackUrl === ""
  ) {
    errorResponse(
      res,
      503,
      "SSO_NOT_CONFIGURED",
      "Server-to-server trust secret or callback URL is missing from server_config.json",
    );
    return;
  }
  // Ashat Hub reads `?callback=...` and redirects there with session_id +
  // username + role + display_name after a successful login. URL-encode
  // it so multi-character values survive transit.
  const url =
    `${ashatConfig.baseUrl}${ashatConfig.loginPath}` +
    `?callback=${encodeURIComponent(ashatConfig.callbackUrl)}`;
  jsonResponse(res, 200, {
    url,
    provider: "ashat-hub",
    callbackUrl: ashatConfig.callbackUrl,
  });
}

/**
 * POST /api/auth/sso/finish
 * Body: { session_id: string, username?: string, role?: string, display_name?: string }
 * Server-to-server verifies the session_id against Ashat Hub, finds or
 * creates the linked Paws account, and returns a JWT the client stores
 * in localStorage. The `username/role/display_name` fields from the body
 * are taken as a hint only — the ashat-side verify response is the only
 * source of truth.
 */
export async function ssoFinishHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (req as unknown as { body?: { session_id?: string } }).body;
  const sessionId = typeof body?.session_id === "string" ? body.session_id : "";
  if (sessionId === "") {
    errorResponse(
      res,
      400,
      "MISSING_SESSION_ID",
      "Request body must include session_id (received from Ashat popup callback)",
    );
    return;
  }

  const verified = await verifyAshatSession(sessionId);
  if (verified === null) {
    errorResponse(
      res,
      401,
      "SSO_VERIFY_FAILED",
      "Ashat Hub did not recognize the session or the trust secret is misconfigured",
    );
    return;
  }

  const account = await findOrCreateAccountByAshatId({
    ashatUserId: verified.user_id,
    username: verified.username,
    displayName: verified.display_name,
    role: verified.role,
  });

  const token = await mintJwt({
    accountId: account.id,
    ashatUserId: verified.user_id,
    username: account.username ?? verified.username,
    role: account.role ?? verified.role,
  });

  logger.info("Issued JWT after SSO finish", {
    accountId: account.id,
    ashatUserId: verified.user_id,
    role: account.role,
  });

  const characters = await getCharactersByAccountId(account.id);
  jsonResponse(res, 200, {
    token,
    account: {
      id: account.id,
      username: account.username,
      display_name: account.display_name,
      role: account.role,
      ashat_user_id: account.ashat_user_id,
    },
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      class_id: c.class_id,
      zone_id: c.zone_id,
      pos_x: c.pos_x,
      pos_y: c.pos_y,
      level: c.level,
    })),
  });
}

/**
 * GET /api/auth/me
 * Validates the Bearer token the client sends and returns the linked
 * account + its characters. Used at game startup — if 401, the client
 * renders the login overlay.
 */
export async function meHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  const token = extractBearerToken(
    typeof authHeader === "string" ? authHeader : undefined,
  );
  if (token === null) {
    errorResponse(res, 401, "UNAUTHORIZED", "Bearer token required");
    return;
  }
  const payload = await verifyAccessToken(token);
  if (payload === null) {
    errorResponse(res, 401, "INVALID_TOKEN", "JWT verification failed");
    return;
  }
  const account = await getAccountByAshatId(payload.ashatUserId);
  if (account === null) {
    errorResponse(
      res,
      401,
      "ACCOUNT_GONE",
      "Linked Ashat account no longer exists",
    );
    return;
  }
  const characters = await getCharactersByAccountId(account.id);
  jsonResponse(res, 200, {
    account: {
      id: account.id,
      username: account.username,
      display_name: account.display_name,
      role: account.role,
      ashat_user_id: account.ashat_user_id,
    },
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      class_id: c.class_id,
      zone_id: c.zone_id,
      pos_x: c.pos_x,
      pos_y: c.pos_y,
      level: c.level,
    })),
  });
}

/**
 * POST /api/auth/logout
 * JWT is stateless and self-deleting via short TTL — the actual logout
 * is on the client (delete from localStorage). This endpoint exists so
 * the client can call it for symmetry, and so Phase 4 has a place to
 * add a token blacklist or refresh-token revocation.
 */
export async function logoutHandler(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  jsonResponse(res, 200, { ok: true });
}

async function mintJwt(payload: {
  accountId: number;
  ashatUserId: string;
  username: string;
  role: string;
}): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${authConfig.accessTokenTtlSeconds}s`)
    .sign(new TextEncoder().encode(authConfig.jwtSecret));
}

// Re-export for callers that want to inspect a token without minting a new one.
export async function verifyRequestJwt(token: string): Promise<unknown> {
  const { payload } = await jwtVerify(
    token,
    new TextEncoder().encode(authConfig.jwtSecret),
  );
  return payload;
}
