import { auth as authConfig } from "../config/index.ts";

export const SESSION_COOKIE = "paws_session";

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${authConfig.accessTokenTtlSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  const value = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (value === undefined) return null;
  return decodeURIComponent(value.slice(SESSION_COOKIE.length + 1));
}
