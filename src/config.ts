/**
 * Central client config — resolves the game server URL and maintenance flag
 * from the runtime-loaded server_config.json (on the web server) with Vite
 * build-time defines as fallback for local dev.
 *
 * Resolution order:
 *   1. server_config.json (fetched at boot by clientConfig.ts)
 *   2. Vite __GAME_SERVER_URL__ / __MAINTENANCE__ defines
 *   3. Hardcoded defaults (same-origin, maintenance on)
 *
 * apiPath() and getWsUrl() read the loaded config dynamically, so they
 * always use the latest values after loadClientConfig() completes.
 */

import { getClientConfig } from "./clientConfig.ts";

// --- Vite build-time defines (used as fallback before server_config.json loads) ---

declare const __GAME_SERVER_URL__: string | undefined;
declare const __MAINTENANCE__: string | undefined;

const BUILD_GAME_SERVER_URL: string =
  typeof __GAME_SERVER_URL__ !== "undefined" ? __GAME_SERVER_URL__ : "";
const BUILD_MAINTENANCE: boolean =
  typeof __MAINTENANCE__ !== "undefined" ? __MAINTENANCE__ !== "false" : true;

// --- Runtime accessors ---

/** The resolved game server URL (reads from loaded config or build-time default). */
export function getGameServerUrl(): string {
  return getClientConfig()?.gameServerUrl ?? BUILD_GAME_SERVER_URL;
}

/** Whether the client is configured for a remote game server (cross-origin). */
export function isRemoteServer(): boolean {
  return getGameServerUrl().length > 0;
}

/** Whether maintenance mode is active (reads from loaded config or build-time default). */
export function isMaintenance(): boolean {
  return getClientConfig()?.maintenance ?? BUILD_MAINTENANCE;
}

/**
 * Build a full API path — when a remote game server is configured, prefix
 * the path with its origin; otherwise return the bare relative path (same-
 * origin, the single-process default).
 *
 * Example: apiPath("/api/auth/me") → "https://ashatneuralhost.agpstudios.org/api/auth/me"
 */
export function apiPath(path: string): string {
  const baseUrl = getGameServerUrl();
  if (baseUrl === "") return path;
  // Ensure no double-slash between the base and the path.
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  // Guard against a missing leading slash on the path.
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * The WebSocket URL for the game server's /ws endpoint.
 * Derives wss:// from https://, ws:// from http://.
 */
export function getWsUrl(): string {
  const baseUrl = getGameServerUrl();
  if (baseUrl !== "") {
    const url = new URL("/ws", baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
  // Same-origin fallback (Vite dev proxy or single-process hosting).
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}
