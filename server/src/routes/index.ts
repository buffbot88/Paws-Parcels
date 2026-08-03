import type { IncomingMessage, ServerResponse } from "node:http";
import { healthHandler } from "./health.ts";
import {
  loginUrlHandler,
  logoutHandler,
  meHandler,
  oidcCallbackHandler,
} from "./auth.ts";
import {
  classesHandler,
  createCharacterHandler,
  listCharactersHandler,
} from "./characters.ts";
import { wsTokenHandler } from "./ws-token.ts";

/** Route handler signature. */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

/** Simple path-based router (no Express dependency). */
export class Router {
  private routes: Array<{
    method: string;
    pattern: RegExp;
    paramNames: string[];
    handler: RouteHandler;
  }> = [];

  get(path: string, handler: RouteHandler): void {
    this.add("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.add("POST", path, handler);
  }

  private add(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const regexStr = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${regexStr}$`),
      paramNames,
      handler,
    });
  }

  async resolve(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = path.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
        await route.handler(req, res, params);
        return true;
      }
    }
    return false;
  }
}

/** Create the API router with all routes. */
export function createRouter(): Router {
  const router = new Router();

  // Liveness probe (no DB ping — start of server boot).
  router.get("/api/health", healthHandler);

  // Phase 3 — ASHAT Hub OIDC (authorization code + PKCE)
  router.get("/api/auth/login-url", loginUrlHandler);
  router.post("/api/auth/oidc/callback", oidcCallbackHandler);
  router.get("/api/auth/me", meHandler);
  router.post("/api/auth/logout", logoutHandler);

  // Character management (list, class catalog, create).
  router.get("/api/characters", listCharactersHandler);
  router.get("/api/classes", classesHandler);
  router.post("/api/characters", createCharacterHandler);

  // Phase 2 — WebSocket handshake token (30s, single-use).
  router.get("/api/ws-token", wsTokenHandler);

  return router;
}
