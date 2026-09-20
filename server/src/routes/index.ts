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
  characterProfileHandler,
  unlockSkillHandler,
} from "./characters.ts";
import { wsTokenHandler } from "./ws-token.ts";
import { createNpcTalkHandler } from "./npc.ts";
import { createVisualCaptureHandler } from "./visual-capture.ts";
import {
  adminOverviewHandler,
  adminHealthHandler,
  adminZoneStatusHandler,
  adminPlayersHandler,
  adminPlayerDetailHandler,
  adminPlayerStatusHandler,
  adminGrantItemHandler,
  adminAdjustHandler,
  adminTeleportHandler,
  adminKickHandler,
  adminInventoryHandler,
  adminAuditHandler,
  adminSettingsHandler,
  adminTierHandler,
  adminRolesHandler,
  adminRolePermissionsHandler,
  adminRoleAssignmentsHandler,
  adminUsersHandler,
  adminStepUpHandler,
  adminItemsHandler,
  adminItemsMetaHandler,
  adminItemCreateHandler,
  adminItemUpdateHandler,
  adminItemDuplicateHandler,
  adminItemArchiveHandler,
  adminItemRestoreHandler,
} from "./admin/index.ts";
import type { GameBrain } from "../ai/GameBrain.ts";
import { ai as aiConfig } from "../config/index.ts";
import { jsonResponse } from "../middleware/index.ts";

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

  put(path: string, handler: RouteHandler): void {
    this.add("PUT", path, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.add("DELETE", path, handler);
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
        try {
          route.paramNames.forEach((name, i) => {
            params[name] = decodeURIComponent(match[i + 1]);
          });
        } catch {
          // Malformed %-encoding (e.g. /api/characters/%ff/profile) must 400,
          // not throw a URIError that crashes the server.
          jsonResponse(res, 400, { error: "BAD_PATH_ENCODING", message: "Path contains invalid percent-encoding" });
          return true;
        }
        await route.handler(req, res, params);
        return true;
      }
    }
    return false;
  }
}

/** Dependencies the API router can optionally receive. */
export interface RouterDeps {
  npcBrain?: GameBrain | null;
}

/** Create the API router with all routes. */
export function createRouter(deps?: RouterDeps): Router {
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
  router.get("/api/characters/:characterId/profile", characterProfileHandler);
  router.post("/api/characters/:characterId/skills/:skillKey/unlock", unlockSkillHandler);

  // Phase 2 — WebSocket handshake token (30s, single-use).
  router.get("/api/ws-token", wsTokenHandler);

  // Phase 4 experimental — AI game engine: dynamic NPC dialogue.
  router.post("/api/admin/visual-capture", createVisualCaptureHandler());

  // Admin Control Panel (foundation + player tools). All handlers resolve the
  // caller's admin tier internally; every mutation writes admin_audit_log.
  router.get("/api/admin/tier", adminTierHandler);
  router.get("/api/admin/overview", adminOverviewHandler);
  router.get("/api/admin/health", adminHealthHandler);
  router.get("/api/admin/zones/status", adminZoneStatusHandler);
  router.get("/api/admin/players", adminPlayersHandler);
  router.get("/api/admin/players/:accountId", adminPlayerDetailHandler);
  router.post("/api/admin/players/:accountId/status", adminPlayerStatusHandler);
  router.post("/api/admin/players/:accountId/grant-item", adminGrantItemHandler);
  router.post("/api/admin/players/:accountId/adjust", adminAdjustHandler);
  router.post("/api/admin/players/:accountId/teleport", adminTeleportHandler);
  router.post("/api/admin/players/:accountId/kick", adminKickHandler);
  router.post("/api/admin/inventory/:instanceId", adminInventoryHandler);
  router.get("/api/admin/audit", adminAuditHandler);
  router.get("/api/admin/audit/:auditId", adminAuditHandler);
  router.get("/api/admin/settings", adminSettingsHandler);
  router.put("/api/admin/settings", adminSettingsHandler);
  router.get("/api/admin/roles", adminRolesHandler);
  router.put("/api/admin/roles/:roleKey", adminRolePermissionsHandler);
  router.get("/api/admin/roles/assignments/:accountId", adminRoleAssignmentsHandler);
  router.put("/api/admin/roles/assignments/:accountId", adminRoleAssignmentsHandler);
  router.get("/api/admin/admin-users", adminUsersHandler);
  router.post("/api/admin/step-up", adminStepUpHandler);

  // Item Database + Item Editor (spec §25–26). `/items/meta` is registered
  // before `/items/:itemId` so the literal path wins.
  router.get("/api/admin/items/meta", adminItemsMetaHandler);
  router.get("/api/admin/items", adminItemsHandler);
  router.post("/api/admin/items", adminItemCreateHandler);
  router.get("/api/admin/items/:itemId", adminItemsHandler);
  router.put("/api/admin/items/:itemId", adminItemUpdateHandler);
  router.delete("/api/admin/items/:itemId", adminItemArchiveHandler);
  router.post("/api/admin/items/:itemId/duplicate", adminItemDuplicateHandler);
  router.post("/api/admin/items/:itemId/restore", adminItemRestoreHandler);

  router.post(
    "/api/npc/talk",
    createNpcTalkHandler({
      brain: deps?.npcBrain ?? null,
      npcTalkMinIntervalMs: aiConfig.npcTalkMinIntervalMs,
      maxTokensNpc: aiConfig.maxTokensNpc,
    }),
  );

  return router;
}
