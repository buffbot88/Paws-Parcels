import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { auth as authConfig } from "../config/index.ts";

const secret = new TextEncoder().encode(authConfig.jwtSecret);

/** Hash a plain-text password using bcryptjs. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, authConfig.bcryptRounds);
}

/** Compare a plain-text password against a stored hash. */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Generate a short-lived access token (JWT). */
export async function generateAccessToken(payload: {
  accountId: number;
  characterId?: number;
}): Promise<string> {
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${authConfig.accessTokenTtlSeconds}s`)
    .setIssuedAt()
    .sign(secret);
}

/** Verify and decode an access token. Returns null on failure. */
export async function verifyAccessToken(
  token: string,
): Promise<{ accountId: number; characterId?: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      accountId: payload.accountId as number,
      characterId: payload.characterId as number | undefined,
    };
  } catch {
    return null;
  }
}

/** Extract the Bearer token from an Authorization header. */
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}