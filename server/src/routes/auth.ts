import { jwtVerify } from "jose";
import type { IncomingMessage, ServerResponse } from "node:http";
import { auth as authConfig, oidc as oidcConfig } from "../config/index.ts";
import {
  extractBearerToken,
  verifyAccessToken,
} from "../auth/index.ts";
import {
  exchangeAuthCode,
  getAuthorizationEndpoint,
  verifyOidcIdToken,
} from "../auth/oidc.ts";
import {
  findOrCreateAccountByAshatId,
  getAccountByAshatId,
} from "../models/Account.ts";
import { getCharactersByAccountId } from "../models/Character.ts";
import { errorResponse, jsonResponse } from "../middleware/index.ts";
import { logger } from "../middleware/logger.ts";

/**
 * GET /api/auth/login-url?state=...&code_challenge=...
 * Returns the ASHAT Hub authorize URL the client redirects the whole page
 * to. state + PKCE code_challenge come from the client (LoginOverlay holds
 * them in sessionStorage); the server only fills in its OIDC registration.
 */
export async function loginUrlHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const state = url.searchParams.get("state") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";

  if (state.length < 8) {
    errorResponse(
      res,
      400,
      "MISSING_STATE",
      "state query param is required (min 8 chars) — refresh and sign in again",
    );
    return;
  }
  if (codeChallenge.length < 43) {
    errorResponse(
      res,
      400,
      "MISSING_CODE_CHALLENGE",
      "code_challenge query param is required (S256 challenge is 43 chars)",
    );
    return;
  }

  const authorizationEndpoint = await getAuthorizationEndpoint();
  if (authorizationEndpoint === null) {
    errorResponse(
      res,
      502,
      "OIDC_DISCOVERY_FAILED",
      "Could not reach ASHAT Hub's OIDC discovery endpoint",
    );
    return;
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: oidcConfig.clientId,
    redirect_uri: oidcConfig.redirectUri,
    scope: oidcConfig.scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  const separator = authorizationEndpoint.includes("?") ? "&" : "?";
  jsonResponse(res, 200, {
    url: `${authorizationEndpoint}${separator}${params.toString()}`,
    provider: "ashat-hub-oidc",
    state,
  });
}

/**
 * POST /api/auth/oidc/callback
 * Body: { code: string, state: string, code_verifier: string }
 * The client's oidc-callback.html posts the code+state it received from
 * ASHAT. The server exchanges the code at the token endpoint (one round
 * trip), verifies the id_token against the JWKS, then upserts the linked
 * account and mints a session JWT.
 */
export async function oidcCallbackHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (req as unknown as { body?: Record<string, unknown> }).body;
  const code = typeof body?.code === "string" ? body.code : "";
  const codeVerifier =
    typeof body?.code_verifier === "string" ? body.code_verifier : "";

  if (code === "" || codeVerifier === "") {
    errorResponse(
      res,
      400,
      "MISSING_OIDC_PARAMS",
      "Request body must include code and code_verifier",
    );
    return;
  }

  const exchanged = await exchangeAuthCode(code, codeVerifier);
  if (exchanged.kind === "unreachable") {
    errorResponse(
      res,
      502,
      "OIDC_UPSTREAM_UNAVAILABLE",
      "ASHAT Hub's token endpoint could not be reached — try again in a moment",
    );
    return;
  }
  if (exchanged.kind === "rejected") {
    errorResponse(
      res,
      401,
      "OIDC_TOKEN_EXCHANGE_FAILED",
      "ASHAT Hub rejected the authorization code — sign in again",
    );
    return;
  }

  const verifyResult = await verifyOidcIdToken(exchanged.idToken);
  if (verifyResult.kind === "unreachable") {
    errorResponse(
      res,
      502,
      "OIDC_UPSTREAM_UNAVAILABLE",
      "ASHAT Hub's JWKS could not be reached — try again in a moment",
    );
    return;
  }
  if (verifyResult.kind === "invalid") {
    errorResponse(
      res,
      401,
      "OIDC_ID_TOKEN_INVALID",
      "ASHAT Hub's id_token failed signature/issuer/audience validation",
    );
    return;
  }
  const identity = verifyResult.identity;

  const account = await findOrCreateAccountByAshatId({
    ashatUserId: identity.sub,
    username: identity.username,
    displayName: identity.displayName,
    role: identity.role,
  });

  const token = await mintJwt({
    accountId: account.id,
    ashatUserId: identity.sub,
    username: account.username ?? identity.username,
    role: account.role ?? identity.role,
  });

  logger.info("Issued JWT after OIDC callback", {
    accountId: account.id,
    ashatUserId: identity.sub,
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
