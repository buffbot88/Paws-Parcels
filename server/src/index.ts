import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
// Side-effect: config is validated and loaded at module import — any bad
// server_config.json fails fast before main() runs.
import { server as serverConfig } from "./config/index.ts";
import { getDb, closeDb, pingDb } from "./db/connection.ts";
import { runMigrations } from "./db/migrate.ts";
import { middleware, parseBody, jsonResponse, errorResponse } from "./middleware/index.ts";
import { logger } from "./middleware/logger.ts";
import { createRouter } from "./routes/index.ts";
import { GameServer } from "./ws/gameServer.ts";
import { loadZoneData } from "./ws/zoneData.ts";
import {
  getCharacterWithClass,
  updateCharacterPosition,
} from "./models/Character.ts";

async function main(): Promise<void> {

  logger.info("Paws & Parcels server starting", {
    port: serverConfig.port,
    environment: serverConfig.nodeEnv,
  });

  // Open the SQLite database and run migrations (the file is created on
  // first boot and committed with the repo).
  try {
    getDb();
    if (!(await pingDb())) {
      throw new Error("SQLite ping failed");
    }
    logger.info("SQLite database ready");
    await runMigrations();
  } catch (err) {
    logger.error("Failed to open SQLite or run migrations", {
      error: String(err),
    });
    process.exit(1);
  }

  const router = createRouter();

  // Phase 2 — WebSocket game server (authoritative presence + movement).
  // Position persistence is best-effort: gameplay continues in memory if the
  // DB write fails (design/architecture.md §9 fail-soft).
  const gameServer = new GameServer({
    loadCharacter: async (characterId) => {
      const row = await getCharacterWithClass(characterId);
      if (row === null) return null;
      return {
        characterId: row.id,
        accountId: row.account_id,
        name: row.name,
        classKey: row.class_key,
        zoneId: row.zone_id,
        pos: { x: row.pos_x, y: row.pos_y },
      };
    },
    getZoneData: loadZoneData,
    persistPosition: (characterId, zoneId, pos) =>
      updateCharacterPosition(characterId, zoneId, pos.x, pos.y),
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Apply CORS and other universal middleware
    await middleware(req, res);
    if (res.writableEnded) return; // OPTIONS preflight

    // Parse body for non-GET requests
    let body: unknown;
    try {
      body = await parseBody(req);
    } catch (err) {
      errorResponse(res, 400, "INVALID_JSON", "Request body is not valid JSON");
      return;
    }

    // Store body for route handlers
    (req as any).body = body;

    // Route resolution
    const matched = await router.resolve(req, res);

    if (!matched) {
      jsonResponse(res, 404, {
        error: "NOT_FOUND",
        message: `Route ${req.method} ${req.url} not found`,
      });
    }
  });

  // Attach the WebSocket server to the same HTTP server before listening.
  gameServer.attach(server);

  server.listen(serverConfig.port, serverConfig.host, () => {
    logger.info(`Server listening on http://${serverConfig.host}:${serverConfig.port}`);
    logger.info(`Health check: http://localhost:${serverConfig.port}/api/health`);
    logger.info(`WebSocket: ws://localhost:${serverConfig.port}/ws`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    gameServer.close();
    server.close(async () => {
      await closeDb();
      logger.info("Server shut down");
      process.exit(0);
    });
    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Unhandled error during startup:", err);
  process.exit(1);
});