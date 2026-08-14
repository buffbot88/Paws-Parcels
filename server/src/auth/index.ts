import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { auth as authConfig } from "../config/index.ts";

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

/** Generate the server-authoritative 24-hour session JWT. */
export async function generateAccessToken(payload: {
  accountId: number;
  ashatUserId: string;
  username: string;
  role: string;
}): Promise<string> {
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${authConfig.accessTokenTtlSeconds}s`)
    .setIssuedAt()
    .sign(new TextEncoder().encode(authConfig.jwtSecret));
}

/** Verify and decode an access token. Returns null on failure. */
export async function verifyAccessToken(
  token: string,
): Promise<{
  accountId: number;
  ashatUserId: string;
  username: string;
  role: string;
} | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(authConfig.jwtSecret),
    );
    return {
      accountId: Number(payload.accountId),
      ashatUserId: String(payload.ashatUserId ?? ""),
      username: String(payload.username ?? ""),
      role: String(payload.role ?? "Member"),
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
