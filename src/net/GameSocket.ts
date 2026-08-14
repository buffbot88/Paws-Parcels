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
  /** Snapshot metadata lets the client recover if a player_joined frame is missed. */
  name?: string;
  classKey?: string;
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

export interface NetChatMessage {
  characterId: number;
  name: string;
  text: string;
}

export type NetQuestState = "locked" | "available" | "active" | "completed";

export interface NetQuestSnapshot {
  questId: string;
  title: string;
  description: string;
  type: string;
  giverId: string;
  targetId: string | null;
  requiredItemId: string | null;
  requiredQuantity: number;
  state: NetQuestState;
  progress: number;
  stampReward: number;
  xpReward: number;
  reputationNpcId: string | null;
  reputationPoints: number;
  chainPosition: number;
}

export interface NetQuestInventoryItem {
  itemInstanceId: number;
  itemKey: string;
  slot: number | null;
  quantity: number;
  locked: boolean;
}

export interface NetSnapshotMeta {
  sequence: number;
  serverTime: number;
  /** Local receipt time used for interpolation; avoids cross-device clock skew. */
  receivedAt: number;
}

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
  onSnapshot?: (players: NetPlayerPos[], zoneId?: string, meta?: NetSnapshotMeta) => void;
  onMonsterSnapshot?: (monsters: NetMonsterInfo[]) => void;
  onChatMessage?: (message: NetChatMessage) => void;
  onCombatEvent?: (event: NetCombatEvent) => void;
  onRespawn?: (info: NetRespawnInfo) => void;
  onLoot?: (sourceId: string, items: { itemKey: string; quantity: number }[]) => void;
  onNpcInteraction?: (npcId: string, quests: NetQuestSnapshot[]) => void;
  onQuestState?: (quests: NetQuestSnapshot[]) => void;
  onQuestUpdated?: (payload: { action: string; quest: NetQuestSnapshot; quests: NetQuestSnapshot[]; inventory: NetQuestInventoryItem[]; stamps: number; xp: number; message: string }) => void;
  onInventoryUpdated?: (items: NetQuestInventoryItem[], stamps: number) => void;
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
  private connectPromise: Promise<void> | null = null;

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
    // The scene and main boot path can both request the same connection while
    // the first ws-token fetch is still pending. Share that promise so one
    // character never opens two sockets or burns two single-use tokens.
    if (this.connectPromise !== null) return this.connectPromise;
    this.connectPromise = this.connectInternal();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connectInternal(): Promise<void> {
    // Re-entrancy guard — never stack a second socket while the existing
    // browser connection is either opening or already open.
    if (this.ws !== null && (this.ws.readyState === 0 || this.ws.readyState === WS_READY_OPEN)) return;
    this.closedByUser = false;
    const token = this.opts.getToken();
    if (token === null) {
      this.setStatus("closed", "Not signed in");
      this.callbacks.onError?.("NOT_SIGNED_IN", "No active sign-in session");
      return;
    }
    this.setStatus("fetching-token");

    try {
      this.wsToken = await this.fetchWsToken(token);
    } catch (err) {
      this.wsToken = null;
      this.setStatus("closed", "Could not reach the server for a ws-token");
      const detail = err instanceof Error ? err.message : String(err);
      this.callbacks.onError?.(
        "WS_TOKEN_NETWORK_FAILED",
        `Network error fetching ws-token: ${detail}`,
      );
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
    let ws: WebSocket;
    try {
      ws = new WS(this.opts.wsUrl);
    } catch (err) {
      this.setStatus("closed", "Could not open the WebSocket");
      this.callbacks.onError?.("WS_CONSTRUCTOR_FAILED", String(err));
      return;
    }
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
    if (characterId === null) {
      this.callbacks.onError?.("CHARACTER_NOT_SELECTED", "No playable courier is selected");
      return null;
    }
    const url = `${this.opts.tokenUrl}?characterId=${encodeURIComponent(String(characterId))}`;
    // Native browser fetch can require its global receiver. Calling the
    // injected function detached (`this.opts.fetchImpl(...)`) throws
    // "Illegal invocation" in Chromium; bind it explicitly for both the
    // browser implementation and test doubles.
    const res = await this.opts.fetchImpl.call(globalThis, url, {
      headers: { Authorization: `Bearer ${jwt}` },
      credentials: "omit",
      cache: "no-store",
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { error?: unknown; message?: unknown };
        const code = typeof body.error === "string" ? body.error : "";
        const message = typeof body.message === "string" ? body.message : "";
        detail = [code, message].filter(Boolean).join(": ");
      } catch {
        // Keep the HTTP status when the proxy returns a non-JSON error page.
      }
      this.callbacks.onError?.(
        "WS_TOKEN_FAILED",
        `Server returned ${res.status}${detail === "" ? "" : ` — ${detail}`}`,
      );
      return null;
    }
    const body = (await res.json()) as { wsToken?: unknown };
    if (typeof body.wsToken !== "string") {
      this.callbacks.onError?.("WS_TOKEN_INVALID", "The server returned no WebSocket token");
      return null;
    }
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

  /** Ask the server to interact with an NPC; range and quest completion are server-validated. */
  interact(targetId: string): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null) return;
    if (this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "interact", targetId, kind: "npc" }));
  }

  /** Accept a server-offered quest; prerequisites and parcel creation are authoritative. */
  acceptQuest(questId: string): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null) return;
    if (this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "accept_quest", questId }));
  }

  /** Send a same-zone chat message; the server validates length and rate. */
  chat(text: string): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null) return;
    if (this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "zone_chat", text }));
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
        if (Array.isArray(msg.quests)) this.callbacks.onQuestState?.(normalizeQuests(msg.quests));
        break;
      }
      case "npc_interaction":
        this.callbacks.onNpcInteraction?.(String(msg.npcId ?? ""), normalizeQuests(msg.quests));
        break;
      case "quest_updated": {
        const quests = normalizeQuests(msg.quests);
        const quest = normalizeQuests([msg.quest])[0];
        if (quest !== undefined) {
          this.callbacks.onQuestState?.(quests);
          this.callbacks.onQuestUpdated?.({
            action: typeof msg.action === "string" ? msg.action : "updated",
            quest,
            quests,
            inventory: normalizeQuestInventory(msg.inventory),
            stamps: Number(msg.stamps ?? 0),
            xp: Number(msg.xp ?? 0),
            message: typeof msg.message === "string" ? msg.message : "Quest updated",
          });
        }
        break;
      }
      case "inventory_updated":
        this.callbacks.onInventoryUpdated?.(normalizeQuestInventory(msg.items), Number(msg.stamps ?? 0));
        break;
      case "player_joined":
        this.callbacks.onPlayerJoined?.(normalizePlayer(msg));
        break;
      case "player_left":
        this.callbacks.onPlayerLeft?.(Number(msg.characterId));
        break;
      case "player_snapshot": {
        const sequence = Number(msg.sequence);
        const serverTime = Number(msg.serverTime);
        const receivedAt = this.opts.now();
        const players = normalizePositions(msg.players);
        const zoneId = typeof msg.zoneId === "string" ? msg.zoneId : undefined;
        if (Number.isFinite(sequence) && sequence > 0 && Number.isFinite(serverTime) && serverTime > 0) {
          this.callbacks.onSnapshot?.(players, zoneId, { sequence, serverTime, receivedAt });
        } else {
          this.callbacks.onSnapshot?.(players, zoneId);
        }
        break;
      }
      case "monster_snapshot":
        this.callbacks.onMonsterSnapshot?.(normalizeMonsters(msg.monsters));
        break;
      case "zone_chat": {
        const characterId = Number(msg.characterId);
        const name = typeof msg.name === "string" ? msg.name : "Courier";
        const text = typeof msg.text === "string" ? msg.text : "";
        if (Number.isInteger(characterId) && text !== "") {
          this.callbacks.onChatMessage?.({ characterId, name, text });
        }
        break;
      }
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
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(typeof entry.classKey === "string" ? { classKey: entry.classKey } : {}),
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
function normalizeQuests(raw: unknown): NetQuestSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const q = entry as Record<string, unknown>;
    const state: NetQuestState = q.state === "available" || q.state === "active" || q.state === "completed" ? q.state : "locked";
    return {
      questId: String(q.questId ?? ""),
      title: String(q.title ?? ""),
      description: String(q.description ?? ""),
      type: String(q.type ?? "delivery"),
      giverId: String(q.giverId ?? ""),
      targetId: q.targetId === null ? null : String(q.targetId ?? ""),
      requiredItemId: q.requiredItemId === null ? null : String(q.requiredItemId ?? ""),
      requiredQuantity: Number(q.requiredQuantity ?? 1),
      state,
      progress: Number(q.progress ?? 0),
      stampReward: Number(q.stampReward ?? 0),
      xpReward: Number(q.xpReward ?? 0),
      reputationNpcId: q.reputationNpcId === null ? null : String(q.reputationNpcId ?? ""),
      reputationPoints: Number(q.reputationPoints ?? 0),
      chainPosition: Number(q.chainPosition ?? 0),
    };
  }).filter((q) => q.questId !== "");
}

function normalizeQuestInventory(raw: unknown): NetQuestInventoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const item = entry as Record<string, unknown>;
    return {
      itemInstanceId: Number(item.itemInstanceId ?? 0),
      itemKey: String(item.itemKey ?? ""),
      slot: item.slot === null ? null : Number(item.slot ?? 0),
      quantity: Number(item.quantity ?? 1),
      locked: item.locked === true,
    };
  });
}

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
