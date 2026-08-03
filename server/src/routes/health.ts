import type { IncomingMessage, ServerResponse } from "node:http";
import { pingDb } from "../db/connection.ts";
import { jsonResponse, errorResponse } from "../middleware/index.ts";
import { logger } from "../middleware/logger.ts";

/** GET /api/health — liveness + DB reachability check. */
export async function healthHandler(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const dbOk = await pingDb();
  const status = dbOk ? 200 : 503;
  const response = {
    status: dbOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    db: dbOk ? "connected" : "unreachable",
  };

  if (!dbOk) {
    logger.warn("Health check: DB unreachable");
  }

  jsonResponse(res, status, response);
}