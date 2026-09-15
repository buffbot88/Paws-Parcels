import type { GameServer } from "./gameServer.ts";
import type { AdminRuntime } from "../admin/index.ts";

/**
 * Adapt the live GameServer to the AdminRuntime bridge the admin routes
 * consume. `aiEnabled`/`staticDirPresent` are read once at boot.
 */
export function createAdminRuntime(gameServer: GameServer, opts: { aiEnabled: boolean; staticDirPresent: boolean }): AdminRuntime {
  return {
    onlineCount: () => gameServer.onlineCount(),
    zonePlayerCounts: () => gameServer.zonePlayerCounts(),
    disconnectCharacter: (characterId) => gameServer.disconnectCharacter(characterId),
    aiEnabled: opts.aiEnabled,
    staticDirPresent: opts.staticDirPresent,
  };
}
