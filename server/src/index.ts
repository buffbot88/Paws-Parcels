import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import npcsJson from "../../src/data/npcs.json" with { type: "json" };
import cloverVillageMap from "../../src/data/maps/clover-village.json" with { type: "json" };
import happyValleyMap from "../../src/data/maps/happy-valley.json" with { type: "json" };
// Side-effect: config is validated and loaded at module import — any bad
// server_config.json fails fast before main() runs.
import { server as serverConfig, ai as aiConfig } from "./config/index.ts";
import { ModelInstance } from "./ai/ModelInstance.ts";
import { GameBrain } from "./ai/GameBrain.ts";
import { MonsterBrain } from "./ai/MonsterBrain.ts";
import { getDb, closeDb, pingDb } from "./db/connection.ts";
import { runMigrations } from "./db/migrate.ts";
import {
  middleware,
  parseBody,
  jsonResponse,
  errorResponse,
  RequestBodyTooLargeError,
} from "./middleware/index.ts";
import { logger } from "./middleware/logger.ts";
import { createRouter } from "./routes/index.ts";
import { createStaticClientServer } from "./static/client.ts";
import { GameServer } from "./ws/gameServer.ts";
import { loadZoneData } from "./ws/zoneData.ts";
import { getMonsterDefinitionsByZone } from "./models/Monster.ts";
import {
  getCharacterWithClass,
  updateCharacterPosition,
  updateCharacterHp,
  grantExperience,
  grantInventoryItems,
} from "./models/Character.ts";
import {
  getQuestState,
  acceptQuest,
  completeDelivery,
  getQuestInventory,
  resetFragileDeliveriesOnDefeat,
  searchQuest,
} from "./models/Quest.ts";
import { getInventoryState, moveInventoryItem, equipItem, unequipItem } from "./models/Equipment.ts";

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

  // Phase 4 experimental — AI game engine. The game-owned 450M VL instance
  // is power-managed: spawned on demand, spun down after idleMs idle, and
  // stopped on shutdown. When disabled (or on failure) the game falls back
  // to deterministic monster AI + canned dialogue.
  const modelInstance = aiConfig.enabled
    ? new ModelInstance({
        port: aiConfig.port,
        modelPath: aiConfig.modelPath,
        mmprojPath: aiConfig.mmprojPath,
        idleMs: aiConfig.idleMs,
        warmupTimeoutMs: aiConfig.warmupTimeoutMs,
      })
    : null;
  const gameBrain =
    modelInstance === null
      ? null
      : new GameBrain(modelInstance, {
          requestTimeoutMs: aiConfig.requestTimeoutMs,
        });
  const monsterBrain =
    gameBrain === null
      ? null
      : new MonsterBrain(gameBrain, {
          intervalMs: aiConfig.monsterDecisionIntervalMs,
          maxTokens: aiConfig.maxTokensMonster,
        });
  if (modelInstance !== null) {
    logger.info("AI game engine enabled — model instance is power-managed", {
      port: aiConfig.port,
      idleMs: aiConfig.idleMs,
    });
  }

  const router = createRouter({ npcBrain: gameBrain });

  // Phase 3.5 — single-process hosting: serve the built client (dist/) from
  // this same server so one host runs the whole game. When the dir is missing
  // (dev), the API/WS-only server still boots and requests fall through to 404.
  const staticDir = serverConfig.staticDir;
  const serveClientFile =
    staticDir !== "" ? createStaticClientServer(staticDir) : null;
  if (serveClientFile !== null) {
    if (!existsSync(staticDir)) {
      logger.warn(
        `Static client dir ./${staticDir} not found — API/WS only (run "npm run build" to serve the game).`,
      );
    } else {
      logger.info(`Serving client from ./${staticDir}`);
    }
  }

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
        hp: row.hp,
        maxHp: row.max_hp,
        attack: row.attack,
        defense: row.defense,
        speed: row.speed,
        critChance: row.crit_chance,
        critMultiplier: row.crit_multiplier,
      };
    },
    getZoneData: loadZoneData,
    getMonsterDefinitions: getMonsterDefinitionsByZone,
    persistPosition: (characterId, zoneId, pos) =>
      updateCharacterPosition(characterId, zoneId, pos.x, pos.y),
    persistHp: (characterId, hp, maxHp) =>
      updateCharacterHp(characterId, hp, maxHp),
    grantXp: (characterId, amount) => grantExperience(characterId, amount),
    grantInventory: (characterId, items) => grantInventoryItems(characterId, items),
    getNpcPosition: (npcId, zoneId) => {
      const npc = npcsJson.npcs.find((entry) => entry.id === npcId && entry.homeZone === zoneId);
      return npc === undefined ? null : npc.homeTile;
    },
    getObjectPosition: (objectId, zoneId) => {
      const map = zoneId === "zone-clover-village" ? cloverVillageMap : zoneId === "zone-happy-valley" ? happyValleyMap : null;
      const object = map?.interactables.find((entry) => entry.id === objectId);
      return object === undefined ? null : { x: object.x, y: object.y };
    },
    getQuestState,
    acceptQuest,
    completeDelivery,
    searchQuest,
    getQuestInventory,
    resetFragileDeliveriesOnDefeat,
    getInventoryState,
    moveInventoryItem,
    equipItem,
    unequipItem,
    monsterBrain,
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // Apply CORS and other universal middleware
      await middleware(req, res);
      if (res.writableEnded) return; // OPTIONS preflight

      // Parse body for non-GET requests
      let body: unknown;
      try {
        body = await parseBody(req);
      } catch (err) {
        if (err instanceof RequestBodyTooLargeError) {
          errorResponse(res, 413, "REQUEST_TOO_LARGE", "Request body exceeds the upload limit");
        } else {
          errorResponse(res, 400, "INVALID_JSON", "Request body is not valid JSON");
        }
        return;
      }

      // Store body for route handlers
      (req as any).body = body;

      // Route resolution
      const matched = await router.resolve(req, res);

      if (!matched) {
        // Not an API route — serve the built client (production single-process
        // hosting), otherwise 404.
        if (serveClientFile !== null && serveClientFile(req, res)) {
          return;
        }
        jsonResponse(res, 404, {
          error: "NOT_FOUND",
          message: `Route ${req.method} ${req.url} not found`,
        });
      }
    } catch (err) {
      // A handler bug must produce a 500, never an unhandled rejection that
      // takes the whole game server down.
      logger.error("Unhandled HTTP handler error", { url: req.url, err: String(err) });
      if (!res.headersSent) {
        errorResponse(res, 500, "INTERNAL_ERROR", "Internal server error");
      } else if (!res.writableEnded) {
        res.end();
      }
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
      if (modelInstance !== null) {
        await modelInstance.stop();
      }
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