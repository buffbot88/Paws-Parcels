/**
 * Runtime client config — loaded from client-config.txt on the web server.
 * This lets operators change settings (game server URL, maintenance mode)
 * without rebuilding the client.
 *
 * The file is named .txt (not .json) because the ASHAT Hub Apache layer
 * denies all *.json responses below the document root — including
 * server_config.json — which made the old filename unfetchable.
 *
 * Fallback chain:
 *   1. client-config.txt (fetched at boot — production)
 *   2. Vite __GAME_SERVER_URL__ / __MAINTENANCE__ defines (local dev)
 *   3. Hardcoded defaults (same-origin, maintenance on)
 */

declare const __GAME_SERVER_URL__: string | undefined;
declare const __MAINTENANCE__: string | undefined;

export interface ClientConfig {
  /** Absolute URL of the game server. Empty = same-origin (Apache proxy). */
  gameServerUrl: string;
  /** When true, show maintenance screen after login instead of booting. */
  maintenance: boolean;
}

const DEFAULTS: ClientConfig = {
  gameServerUrl: typeof __GAME_SERVER_URL__ !== "undefined" ? __GAME_SERVER_URL__ : "",
  maintenance: typeof __MAINTENANCE__ !== "undefined" ? __MAINTENANCE__ !== "false" : true,
};

let loaded: ClientConfig | null = null;

/**
 * Load the client config from client-config.txt. Call once at app boot
 * (before any API/WS calls). Returns the resolved config.
 *
 * In production, client-config.txt sits alongside index.html on the web
 * server. In local dev (Vite), the file doesn't exist and the Vite defines
 * provide the defaults.
 */
export async function loadClientConfig(): Promise<ClientConfig> {
  if (loaded !== null) return loaded;

  try {
    const res = await fetch("./client-config.txt", { cache: "no-store" });
    if (res.ok) {
      const raw = (await res.json()) as Record<string, unknown>;
      loaded = {
        gameServerUrl:
          typeof raw.gameServerUrl === "string" ? raw.gameServerUrl : DEFAULTS.gameServerUrl,
        maintenance:
          typeof raw.maintenance === "boolean" ? raw.maintenance : DEFAULTS.maintenance,
      };
      return loaded;
    }
  } catch {
    // File not found (local dev) or network error — fall through to defaults.
  }

  loaded = { ...DEFAULTS };
  return loaded;
}

/** Get the already-loaded config. Returns null if loadClientConfig() hasn't been called yet. */
export function getClientConfig(): ClientConfig | null {
  return loaded;
}
