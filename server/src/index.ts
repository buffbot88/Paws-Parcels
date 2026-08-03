import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
// Side-effect: config is validated and loaded at module import — any bad
// server_config.json fails fast before main() runs.
import { server as serverConfig } from "./config/index.ts";
import { getPool, closePool, pingDb } from "./db/connection.ts";
import { runMigrations } from "./db/migrate.ts";
import { middleware, parseBody, jsonResponse, errorResponse } from "./middleware/index.ts";
import { logger } from "./middleware/logger.ts";
import { createRouter } from "./routes/index.ts";

async function main(): Promise<void> {

  logger.info("Paws & Parcels server starting", {
    port: serverConfig.port,
    environment: serverConfig.nodeEnv,
  });

  // Connect to MySQL and run migrations
  try {
    const pool = getPool();
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    logger.info("MySQL connected");

    await runMigrations();
  } catch (err) {
    logger.error("Failed to connect to MySQL or run migrations", {
      error: String(err),
    });
    process.exit(1);
  }

  const router = createRouter();

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

  server.listen(serverConfig.port, serverConfig.host, () => {
    logger.info(`Server listening on http://${serverConfig.host}:${serverConfig.port}`);
    logger.info(`Health check: http://localhost:${serverConfig.port}/api/health`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(async () => {
      await closePool();
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