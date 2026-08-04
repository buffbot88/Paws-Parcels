/**
 * Central client config — the game server URL is injected at build time by
 * Vite's `define` option (vite.config.ts). An empty string means "same
 * origin" (the default for single-process hosting). When set, all API
 * fetches and the WebSocket connect go to this absolute URL instead.
 *
 * Set via: VITE_GAME_SERVER_URL=https://ashatneuralhost.agpstudios.org
 *          npm run build
 */

declare const __GAME_SERVER_URL__: string;

/** Absolute base URL of the game server (e.g. "https://ashatneuralhost.agpstudios.org"). Empty = same-origin. */
export const GAME_SERVER_URL: string = typeof __GAME_SERVER_URL__ !== "undefined" ? __GAME_SERVER_URL__ : "";

/** Whether the client is configured for a remote game server (cross-origin). */
export const isRemoteServer: boolean = GAME_SERVER_URL.length > 0;

/**
 * Maintenance flag — when true, the client shows a "game server offline"
 * screen after login instead of booting Phaser. Set VITE_MAINTENANCE=false
 * in the build environment to enable the game.
 */
declare const __MAINTENANCE__: string;
export const MAINTENANCE: boolean = typeof __MAINTENANCE__ !== "undefined" ? __MAINTENANCE__ !== "false" : true;

/**
 * Build a full API path — when a remote game server is configured, prefix
 * the path with its origin; otherwise return the bare relative path (same-
 * origin, the single-process default).
 *
 * Example: apiPath("/api/auth/me") → "https://ashatneuralhost.agpstudios.org/api/auth/me"
 */
export function apiPath(path: string): string {
  if (GAME_SERVER_URL === "") return path;
  // Ensure no double-slash between the base and the path.
  const base = GAME_SERVER_URL.endsWith("/") ? GAME_SERVER_URL.slice(0, -1) : GAME_SERVER_URL;
  // Guard against a missing leading slash on the path.
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * The WebSocket URL for the game server's /ws endpoint.
 * Derives wss:// from https://, ws:// from http://.
 */
export function getWsUrl(): string {
  if (GAME_SERVER_URL !== "") {
    const url = new URL("/ws", GAME_SERVER_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
  // Same-origin fallback (Vite dev proxy or single-process hosting).
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}
