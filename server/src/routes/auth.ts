import type { IncomingMessage, ServerResponse } from "node:http";
import { oidc as oidcConfig } from "../config/index.ts";
import { generateAccessToken } from "../auth/index.ts";
import { clearSessionCookie, sessionCookie } from "../auth/sessionCookie.ts";
import {
  exchangeAuthCode,
  getAuthorizationEndpoint,
  verifyOidcIdToken,
} from "../auth/oidc.ts";
import {
  findOrCreateAccountByAshatId,
  toPublicAccount,
} from "../models/Account.ts";
import {  getCharactersByAccountId, toPublicCharacter } from "../models/Character.ts";
import { requireAccount } from "../middleware/auth.ts";
import { errorResponse, jsonResponse } from "../middleware/index.ts";
import { logger } from "../middleware/logger.ts";

/**
 * GET /api/auth/login-url?state=...&code_challenge=...
 * Returns the ASHAT Hub authorize URL the client redirects the whole page
 * to. state + PKCE code_challenge come from the client (LoginOverlay holds
 * them in sessionStorage); the resulting session JWT (TTL from auth config) is
 * persisted client-side so a page refresh does not require another sign-in.
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

  const token = await generateAccessToken({
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
  res.setHeader("Set-Cookie", sessionCookie(token));
  jsonResponse(res, 200, {
    token,
    account: toPublicAccount(account),
    characters: characters.map(toPublicCharacter),
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
  const account = await requireAccount(req, res);
  if (account === null) return;
  const characters = await getCharactersByAccountId(account.id);
  jsonResponse(res, 200, {
    account: toPublicAccount(account),
    characters: characters.map(toPublicCharacter),
  });
}

/**
 * POST /api/auth/logout
 * JWT is stateless and expires after the configured session TTL — the actual logout
 * is on the client (delete from localStorage). This endpoint exists so
 * the client can call it for symmetry, and so Phase 4 has a place to
 * add a token blacklist or refresh-token revocation.
 */
export async function logoutHandler(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader("Set-Cookie", clearSessionCookie());
  jsonResponse(res, 200, { ok: true });
}

