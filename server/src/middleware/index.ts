import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { server as serverConfig } from "../config/index.ts";

/** Paths that count as admin API surface for CSRF enforcement. */
export function isAdminApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/admin/") && pathname !== "/api/admin/csrf";
}

/**
 * Read a cookie value from the request's Cookie header (best-effort; the
 * session cookie reader stays the single source for paws_session).
 */
function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (cookieHeader === undefined) return null;
  const pair = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (pair === undefined) return null;
  return decodeURIComponent(pair.slice(name.length + 1));
}

/** CORS + JSON body parser + request logging + admin CSRF middleware. */
export function middleware(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  return new Promise((resolve) => {
    // CORS headers
    const origin = req.headers.origin || "";
    const allowList = new Set(serverConfig.corsAllowedOrigins);
    const allowOrigin =
      serverConfig.isDev || allowList.has(origin) ? origin : "";
    if (allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowOrigin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-CSRF, X-Admin-Step-Up");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      resolve();
      return;
    }

    // Attach request ID
    res.setHeader("X-Request-Id", randomUUID().slice(0, 8));

    // Admin CSRF (double-submit cookie + header). GETs mint the cookie so the
    // panel can echo it back; mutations on /api/admin/* must present a match.
    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      // malformed URL falls through to routing (404)
    }
    if (isAdminApiPath(pathname)) {
      // Lazy import avoids a config-loader cycle at module init.
      void import("../auth/adminHardening.ts").then(({ CSRF_COOKIE, CSRF_HEADER, issueCsrfToken, csrfMatches }) => {
        const cookieValue = readCookie(req.headers.cookie, CSRF_COOKIE);
        if (req.method === "GET" || req.method === "HEAD") {
          const issued = issueCsrfToken(cookieValue);
          if (issued !== cookieValue) {
            res.setHeader("Set-Cookie", `${CSRF_COOKIE}=${issued}; Path=/; Max-Age=86400; SameSite=Strict`);
          }
          resolve();
          return;
        }
        const headerValue = typeof req.headers[CSRF_HEADER] === "string" ? (req.headers[CSRF_HEADER] as string) : null;
        if (!csrfMatches(cookieValue, headerValue)) {
          errorResponse(res, 403, "CSRF_CHECK_FAILED", "Missing or mismatched X-Admin-CSRF header");
          resolve();
          return;
        }
        resolve();
      }).catch(() => {
        // hardening module failure must not silently pass mutations
        errorResponse(res, 500, "INTERNAL_ERROR", "Security middleware failure");
      });
      return;
    }

    resolve();
  });
}

const MAX_JSON_BODY_BYTES = 2_400_000;

/** Error raised when a JSON request exceeds the server-wide buffering limit. */
export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the upload limit");
    this.name = "RequestBodyTooLargeError";
  }
}

export function parseBody(
  req: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.method === "GET" || req.method === "HEAD") {
      resolve(undefined);
      return;
    }
    const declaredLength = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      // Consume the rejected request before returning so keep-alive sockets
      // are not left with unread bytes from the oversized body.
      req.resume();
      reject(new RequestBodyTooLargeError());
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const failTooLarge = (): void => {
      if (settled) return;
      settled = true;
      // Drain the remainder so keep-alive connections are not left with a
      // half-consumed request body after the 413 response.
      req.resume();
      reject(new RequestBodyTooLargeError());
    };
    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buffer.byteLength;
      if (received > maxBytes) {
        failTooLarge();
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function jsonResponse(
  res: ServerResponse,
  status: number,
  data: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function errorResponse(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  jsonResponse(res, status, { error: code, message });
}
