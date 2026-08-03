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

export function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.method === "GET" || req.method === "HEAD") {
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
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
    req.on("error", reject);
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
