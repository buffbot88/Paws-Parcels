import { importJWK, jwtVerify, type JWK, type JWTPayload } from "jose";
import { oidc as oidcConfig } from "../config/index.ts";
import { logger } from "../middleware/logger.ts";

/**
 * OIDC client for the ASHAT Hub issuer (Phase 3): discovery + JWKS are
 * fetched once and cached, and id_tokens are verified against the cached
 * public keys. No shared secret — trust comes from the RS256 signature.
 */

/** Identity claims extracted from a verified id_token. */
export interface OidcIdentity {
  sub: string;
  username: string;
  role: string;
  displayName: string;
}

/** Outcome of a token exchange — distinguishes upstream outage from rejection. */
export type TokenExchangeResult =
  | { kind: "ok"; idToken: string }
  | { kind: "unreachable" }
  | { kind: "rejected" };

/** Outcome of id_token verification — distinguishes upstream outage from invalid. */
export type OidcVerifyResult =
  | { kind: "ok"; identity: OidcIdentity }
  | { kind: "unreachable" }
  | { kind: "invalid" };

interface OidcDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

const REQUEST_TIMEOUT_MS = 5_000;

let discoveryCache: { value: OidcDiscovery; fetchedAt: number } | null = null;
let jwksCache: { keys: JWK[]; fetchedAt: number } | null = null;

/** Forget the cached discovery/JWKS documents (used by tests). */
export function resetOidcCache(): void {
  discoveryCache = null;
  jwksCache = null;
}

async function fetchDiscovery(
  fetcher: typeof fetch,
): Promise<OidcDiscovery | null> {
  const now = Date.now();
  if (
    discoveryCache !== null &&
    now - discoveryCache.fetchedAt < oidcConfig.jwksTtlSeconds * 1000
  ) {
    return discoveryCache.value;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetcher(oidcConfig.discoveryUrl, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn("fetchDiscovery: non-2xx from discovery", {
        status: res.status,
      });
      return null;
    }
    const doc = (await res.json()) as Record<string, unknown>;
    const value: OidcDiscovery = {
      authorizationEndpoint: String(doc.authorization_endpoint ?? ""),
      tokenEndpoint: String(doc.token_endpoint ?? ""),
      jwksUri: String(doc.jwks_uri ?? ""),
    };
    if (
      value.authorizationEndpoint === "" ||
      value.tokenEndpoint === "" ||
      value.jwksUri === ""
    ) {
      logger.warn("fetchDiscovery: discovery doc missing endpoint fields");
      return null;
    }
    discoveryCache = { value, fetchedAt: now };
    return value;
  } catch (err) {
    logger.error("fetchDiscovery: failed", { error: String(err) });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJwks(
  jwksUri: string,
  fetcher: typeof fetch,
): Promise<JWK[] | null> {
  const now = Date.now();
  if (
    jwksCache !== null &&
    now - jwksCache.fetchedAt < oidcConfig.jwksTtlSeconds * 1000
  ) {
    return jwksCache.keys;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetcher(jwksUri, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn("fetchJwks: non-2xx from jwks_uri", { status: res.status });
      return null;
    }
    const body = (await res.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      logger.warn("fetchJwks: jwks doc has no usable keys");
      return null;
    }
    const keys = body.keys.filter(isJwk);
    if (keys.length === 0) {
      logger.warn("fetchJwks: jwks doc keys are not JWK-shaped");
      return null;
    }
    jwksCache = { keys, fetchedAt: now };
    return keys;
  } catch (err) {
    logger.error("fetchJwks: failed", { error: String(err) });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isJwk(value: unknown): value is JWK {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.kty === "string" &&
    typeof v.n === "string" &&
    typeof v.e === "string"
  );
}

/**
 * Exchange an authorization code for an id_token at the ASHAT token
 * endpoint. Uses PKCE — no client secret exists for a public client.
 */
export async function exchangeAuthCode(
  code: string,
  codeVerifier: string,
  fetcher: typeof fetch = fetch,
): Promise<TokenExchangeResult> {
  const discovery = await fetchDiscovery(fetcher);
  if (discovery === null) return { kind: "unreachable" };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetcher(discovery.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: oidcConfig.redirectUri,
        client_id: oidcConfig.clientId,
        code_verifier: codeVerifier,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn("exchangeAuthCode: non-2xx from token endpoint", {
        status: res.status,
      });
      return { kind: "rejected" };
    }
    const body = (await res.json()) as { id_token?: unknown };
    if (typeof body.id_token !== "string" || body.id_token === "") {
      logger.warn("exchangeAuthCode: token response has no id_token");
      return { kind: "rejected" };
    }
    return { kind: "ok", idToken: body.id_token };
  } catch (err) {
    logger.error("exchangeAuthCode: failed", { error: String(err) });
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Return the cached discovery authorization endpoint, if reachable. */
export async function getAuthorizationEndpoint(
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const discovery = await fetchDiscovery(fetcher);
  return discovery === null ? null : discovery.authorizationEndpoint;
}

/**
 * Verify an RS256 id_token against the JWKS (signature + iss + aud + exp).
 * Distinguishes an upstream outage from a genuinely invalid token.
 */
export async function verifyOidcIdToken(
  idToken: string,
  fetcher: typeof fetch = fetch,
): Promise<OidcVerifyResult> {
  const discovery = await fetchDiscovery(fetcher);
  if (discovery === null) return { kind: "unreachable" };
  const keys = await fetchJwks(discovery.jwksUri, fetcher);
  if (keys === null) return { kind: "unreachable" };

  for (const jwk of keys) {
    try {
      const publicKey = await importJWK(jwk, "RS256");
      const { payload } = await jwtVerify(idToken, publicKey, {
        algorithms: ["RS256"],
        issuer: oidcConfig.issuer,
        audience: oidcConfig.clientId,
        clockTolerance: 30,
      });
      const identity = toIdentity(payload);
      if (identity !== null) return { kind: "ok", identity };
    } catch {
      // Wrong key (rotation) — try the next one.
    }
  }
  logger.warn("verifyOidcIdToken: no JWKS key verified the token");
  return { kind: "invalid" };
}

function toIdentity(payload: JWTPayload): OidcIdentity | null {
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const username = typeof payload.username === "string" ? payload.username : "";
  if (sub === "" || username === "") return null;
  return {
    sub,
    username,
    role: typeof payload.role === "string" ? payload.role : "Member",
    displayName:
      typeof payload.display_name === "string" ? payload.display_name : username,
  };
}
