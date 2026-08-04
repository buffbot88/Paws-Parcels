import { apiPath } from "../config.ts";

/**
 * Browser WebSocket client for the Phase 2 game server (design/network-protocol.md).
 *
 * Lifecycle:
 *   1. fetch GET /api/ws-token?characterId=N using the stored JWT
 *   2. open ws(s)://host/ws
 *   3. send { type: "authenticate", token }
 *   4. on `authenticated`, join the current zone
 *   5. send throttled move_intents; handle zone_state / player_joined /
 *      player_left / player_snapshot / error
 *
 * WebSocket and fetch are injected so the class is unit-testable without a
 * browser. Callers register handlers via `callbacks`.
 */

export interface NetPlayerPos {
  characterId: number;
  pos: { x: number; y: number };
}

export interface NetPlayerInfo extends NetPlayerPos {
  name: string;
  classKey: string;
}

/** A monster as sent by the server (zone_state + monster_snapshot). */
export interface NetMonsterInfo {
  id: string;
  key: string;
  displayName: string;
  pos: { x: number; y: number };
  hp: number;
  maxHp: number;
  alive: boolean;
}

/** A resolved combat hit (player → monster or monster → player). */
export interface NetCombatEvent {
  instigatorId: string;
  targetId: string;
  ability: string;
  damage: number;
  targetHp: number;
  targetMaxHp: number;
  outcome: "hit" | "crit" | "defeated";
}

/** Player defeat payload — respawn the scene at the safe hub. */
export interface NetRespawnInfo {
  zoneId: string;
  pos: { x: number; y: number };
  hp: number;
  maxHp: number;
}

export type NetStatus =
  | "idle"
  | "fetching-token"
  | "connecting"
  | "authenticating"
  | "joined"
  | "reconnecting"
  | "closed";

export interface GameSocketCallbacks {
  onStatus?: (status: NetStatus, detail?: string) => void;
  onAuthenticated?: (info: {
    accountId: number;
    characterId: number;
    zoneId: string;
    hp?: number;
    maxHp?: number;
  }) => void;
  onZoneState?: (zoneId: string, players: NetPlayerInfo[], monsters: NetMonsterInfo[]) => void;
  onPlayerJoined?: (player: NetPlayerInfo) => void;
  onPlayerLeft?: (characterId: number) => void;
  onSnapshot?: (players: NetPlayerPos[]) => void;
  onMonsterSnapshot?: (monsters: NetMonsterInfo[]) => void;
  onCombatEvent?: (event: NetCombatEvent) => void;
  onRespawn?: (info: NetRespawnInfo) => void;
  onLoot?: (sourceId: string, items: { itemKey: string; quantity: number }[]) => void;
  onError?: (code: string, message: string) => void;
}

export interface GameSocketOptions {
  /** ws(s):// URL of the game server's /ws endpoint. */
  wsUrl: string;
  /** The account JWT used to obtain the ws-token (Bearer header). */
  getToken: () => string | null;
  /** The character id to open the session as. */
  getCharacterId: () => number | null;
  /** Token endpoint base (same origin in dev via Vite proxy). */
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  /** Min ms between move_intents (server enforces a 1-tile speed cap). */
  moveIntervalMs?: number;
  /** Reconnect attempts after an unexpected close (server grace is 60s). */
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  now?: () => number;
}

const WS_READY_OPEN = 1;

/** Serializes a payload the way the server expects (single JSON frame). */
export function encodeMessage(payload: unknown): string {
  return JSON.stringify(payload);
}

/** Parse a server frame; returns null when the frame isn't valid JSON. */
export function decodeMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class GameSocket {
  private readonly opts: Required<Pick<GameSocketOptions, "tokenUrl" | "fetchImpl" | "WebSocketImpl" | "moveIntervalMs" | "maxReconnectAttempts" | "reconnectDelayMs" | "now">> &
    GameSocketOptions;
  private ws: WebSocket | null = null;
  private status: NetStatus = "idle";
  private authenticated = false;
  private joinedZoneId: string | null = null;
  private pendingZoneId: string | null = null;
  private lastIntentAt = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private wsToken: string | null = null;

  readonly callbacks: GameSocketCallbacks = {};

  constructor(opts: GameSocketOptions) {
    this.opts = {
      tokenUrl: apiPath("/api/ws-token"),
      fetchImpl: fetch,
      WebSocketImpl: WebSocket,
      moveIntervalMs: 260,
      maxReconnectAttempts: 3,
      reconnectDelayMs: 1200,
      now: () => Date.now(),
      ...opts,
    };
  }

  get statusValue(): NetStatus {
    return this.status;
  }

  /** Start the session: fetch a token, connect, authenticate. */
  async connect(): Promise<void> {
    // Re-entrancy guard — never stack a second socket on a live one.
    if (this.ws !== null && this.ws.readyState === WS_READY_OPEN) return;
    this.closedByUser = false;
    const token = this.opts.getToken();
    if (token === null) {
      this.setStatus("closed", "Not signed in");
      return;
    }
    this.setStatus("fetching-token");

    try {
      this.wsToken = await this.fetchWsToken(token);
    } catch (err) {
      this.wsToken = null;
      this.setStatus("closed", "Could not reach the server for a ws-token");
      this.callbacks.onError?.("WS_TOKEN_FAILED", "Network error fetching ws-token");
      return;
    }
    if (this.wsToken === null) {
      // fetchWsToken already fired onError for HTTP failures.
      this.setStatus("closed", "Could not obtain a ws-token");
      return;
    }
    // The user may have closed while we were fetching.
    if (this.closedByUser) return;

    this.setStatus("connecting");
    const WS = this.opts.WebSocketImpl;
    const ws = new WS(this.opts.wsUrl);
    this.ws = ws;
    ws.onopen = () => {
      if (this.wsToken !== null) {
        this.setStatus("authenticating");
        ws.send(encodeMessage({ type: "authenticate", token: this.wsToken }));
      }
    };
    ws.onmessage = (event: MessageEvent) => {
      const msg = decodeMessage(event.data);
      if (msg === null) return;
      this.dispatch(msg);
    };
    ws.onclose = () => this.handleClose();
    ws.onerror = () => {
      // onclose follows; leave status to handleClose.
    };
  }

  /** Ask the server for a fresh session (after reconnect). */
  private async fetchWsToken(jwt: string): Promise<string | null> {
    const characterId = this.opts.getCharacterId();
    if (characterId === null) return null;
    const url = `${this.opts.tokenUrl}?characterId=${encodeURIComponent(String(characterId))}`;
    const res = await this.opts.fetchImpl(url, {
      headers: { Authorization: `Bearer ${jwt}` },
      credentials: "omit",
    });
    if (!res.ok) {
      this.callbacks.onError?.("WS_TOKEN_FAILED", `Server returned ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { wsToken?: unknown };
    if (typeof body.wsToken !== "string") return null;
    return body.wsToken;
  }

  /** Join (or switch to) a zone. Safe to call before authentication completes. */
  joinZone(zoneId: string): void {
    this.pendingZoneId = zoneId;
    if (this.ws !== null && this.authenticated && this.ws.readyState === WS_READY_OPEN) {
      this.ws.send(encodeMessage({ type: "join_zone", zoneId }));
      this.joinedZoneId = zoneId;
    }
  }

  /** Send a move intent if we're joined and enough time has passed. */
  moveIntent(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null) return;
    if (this.ws.readyState !== WS_READY_OPEN) return;
    const now = this.opts.now();
    if (now - this.lastIntentAt < this.opts.moveIntervalMs) return;
    this.lastIntentAt = now;
    this.ws.send(encodeMessage({ type: "move_intent", dx, dy }));
  }

  /** Send an attack intent against a monster entity (server validates all). */
  attack(targetEntityId: string): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null) return;
    if (this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(
      encodeMessage({ type: "attack", targetEntityId, ability: "basic_attack" }),
    );
  }

  /** Notify the server we're leaving the zone (scene transition / shutdown). */
  leaveZone(): void {
    if (this.ws !== null && this.joinedZoneId !== null && this.ws.readyState === WS_READY_OPEN) {
      this.ws.send(encodeMessage({ type: "leave_zone" }));
    }
    this.joinedZoneId = null;
    // Don't resurrect the zone on the next reconnect.
    this.pendingZoneId = null;
  }

  /** Close the socket (logout / page teardown). No reconnect after this. */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.authenticated = false;
    this.joinedZoneId = null;
    this.pendingZoneId = null;
    this.setStatus("closed");
  }

  private dispatch(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "authenticated": {
        this.authenticated = true;
        this.reconnectAttempts = 0;
        const zoneId = typeof msg.zoneId === "string" ? msg.zoneId : "";
        this.callbacks.onAuthenticated?.({
          accountId: Number(msg.accountId),
          characterId: Number(msg.characterId),
          zoneId,
          hp: Number(msg.hp),
          maxHp: Number(msg.maxHp),
        });
        if (this.pendingZoneId !== null && zoneId !== "") {
          this.joinZone(this.pendingZoneId);
        }
        break;
      }
      case "zone_state": {
        this.setStatus("joined");
        const zoneId = typeof msg.zoneId === "string" ? msg.zoneId : "";
        this.joinedZoneId = zoneId;
        this.callbacks.onZoneState?.(
          zoneId,
          normalizePlayers(msg.players),
          normalizeMonsters(msg.monsters),
        );
        break;
      }
      case "player_joined":
        this.callbacks.onPlayerJoined?.(normalizePlayer(msg));
        break;
      case "player_left":
        this.callbacks.onPlayerLeft?.(Number(msg.characterId));
        break;
      case "player_snapshot":
        this.callbacks.onSnapshot?.(normalizePositions(msg.players));
        break;
      case "monster_snapshot":
        this.callbacks.onMonsterSnapshot?.(normalizeMonsters(msg.monsters));
        break;
      case "combat_event": {
        const outcome =
          msg.outcome === "crit" || msg.outcome === "defeated"
            ? msg.outcome
            : "hit";
        this.callbacks.onCombatEvent?.({
          instigatorId: String(msg.instigatorId),
          targetId: String(msg.targetId),
          ability: typeof msg.ability === "string" ? msg.ability : "basic_attack",
          damage: Number(msg.damage ?? 0),
          targetHp: Number(msg.targetHp ?? 0),
          targetMaxHp: Number(msg.targetMaxHp ?? 0),
          outcome,
        });
        break;
      }
      case "player_respawned": {
        const pos = msg.pos as { x?: unknown; y?: unknown } | undefined;
        this.callbacks.onRespawn?.({
          zoneId: typeof msg.zoneId === "string" ? msg.zoneId : "zone-clover-village",
          pos: {
            x: Number(pos?.x ?? 15),
            y: Number(pos?.y ?? 13),
          },
          hp: Number(msg.hp ?? 0),
          maxHp: Number(msg.maxHp ?? 0),
        });
        break;
      }
      case "loot_received":
        this.callbacks.onLoot?.(
          String(msg.sourceId ?? ""),
          normalizeLoot(msg.items),
        );
        break;
      case "error": {
        const code = typeof msg.code === "string" ? msg.code : "UNKNOWN";
        const message = typeof msg.message === "string" ? msg.message : "Server error";
        this.callbacks.onError?.(code, message);
        break;
      }
      default:
        break;
    }
  }

  private handleClose(): void {
    const wasAuthenticated = this.authenticated;
    this.ws = null;
    this.authenticated = false;
    this.joinedZoneId = null;

    if (this.closedByUser) {
      this.setStatus("closed");
      return;
    }
    if (wasAuthenticated && this.reconnectAttempts < this.opts.maxReconnectAttempts) {
      this.reconnectAttempts += 1;
      this.setStatus("reconnecting", `Attempt ${this.reconnectAttempts}`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.connect();
      }, this.opts.reconnectDelayMs * this.reconnectAttempts);
    } else {
      this.setStatus("closed", "Connection lost");
    }
  }

  private setStatus(status: NetStatus, detail?: string): void {
    this.status = status;
    this.callbacks.onStatus?.(status, detail);
  }
}

function normalizePlayer(msg: Record<string, unknown>): NetPlayerInfo {
  const pos = msg.pos as { x?: unknown; y?: unknown } | undefined;
  return {
    characterId: Number(msg.characterId),
    name: typeof msg.name === "string" ? msg.name : "Courier",
    classKey: typeof msg.classKey === "string" ? msg.classKey : "bear-warrior",
    pos: {
      x: Number(pos?.x ?? 0),
      y: Number(pos?.y ?? 0),
    },
  };
}

function normalizePlayers(raw: unknown): NetPlayerInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const entry = p as Record<string, unknown>;
    return normalizePlayer(entry);
  });
}

/** player_snapshot frames carry only characterId + pos (per network-protocol.md). */
function normalizePositions(raw: unknown): NetPlayerPos[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const entry = p as Record<string, unknown>;
    const pos = entry.pos as { x?: unknown; y?: unknown } | undefined;
    return {
      characterId: Number(entry.characterId),
      pos: {
        x: Number(pos?.x ?? 0),
        y: Number(pos?.y ?? 0),
      },
    };
  });
}

/** Monster entries (zone_state / monster_snapshot). */
function normalizeMonsters(raw: unknown): NetMonsterInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const entry = p as Record<string, unknown>;
    const pos = entry.pos as { x?: unknown; y?: unknown } | undefined;
    return {
      id: String(entry.id ?? ""),
      key: typeof entry.key === "string" ? entry.key : "monster-unknown",
      displayName:
        typeof entry.displayName === "string" ? entry.displayName : "Critter",
      pos: {
        x: Number(pos?.x ?? 0),
        y: Number(pos?.y ?? 0),
      },
      hp: Number(entry.hp ?? 0),
      maxHp: Number(entry.maxHp ?? 0),
      alive: entry.alive !== false,
    };
  });
}

/** loot_received items. */
function normalizeLoot(
  raw: unknown,
): { itemKey: string; quantity: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const entry = p as Record<string, unknown>;
    return {
      itemKey: String(entry.itemKey ?? ""),
      quantity: Number(entry.quantity ?? 1),
    };
  });
}
