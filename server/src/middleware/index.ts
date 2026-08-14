import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { server as serverConfig } from "../config/index.ts";

/** CORS + JSON body parser + request logging middleware. */
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
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      resolve();
      return;
    }

    // Attach request ID
    res.setHeader("X-Request-Id", randomUUID().slice(0, 8));

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
