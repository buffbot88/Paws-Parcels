import { apiPath } from "../config.ts";

/**
 * Transport/protocol boundary for the Phase 2 game server (design/network-protocol.md).
 * This class owns WebSocket lifecycle, framing, normalization, and intent dispatch;
 * Phaser entities and game-facing state belong to NetworkSystem.
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
  /** Saved look as sent by the server (`{ species, colors }`); resolve with `resolveLook`. */
  appearance?: unknown;
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
  parcelCondition: "normal" | "fragile" | "urgent";
  deadlineAt: number | null;
  sideQuest: boolean;
  findAt: string | null;
  searchObjectId: string | null;
  rewardItemId: string | null;
  friendshipGate: { npcId: string; level: number } | null;
  /** Kill-count objective; `progress`/`requiredQuantity` carry the tally. */
  defeat: { monsterKey: string; monsterName: string; count: number } | null;
  additionalStops: string[];
  visitedStops: string[];
}

/**
 * Post-grant courier progression attached to a delivery or to kill XP (`xp_gained`).
 *
 * Mirrors `QuestProgression` in `server/src/models/Quest.ts`: level and rank are
 * server-computed, so the HUD never derives a level-up itself.
 */
export interface NetQuestProgression {
  level: number;
  previousLevel: number;
  levelsGained: number;
  experience: number;
  skillPoints: number;
  courierRank: string;
  rankPromotion: string | null;
}

export interface NetQuestInventoryItem {
  itemInstanceId: number;
  itemKey: string;
  slot: number | null;
  quantity: number;
  locked: boolean;
  name?: string;
  category?: string;
  rarity?: string;
  icon?: string | null;
  equippedSlot?: string | null;
}

export interface NetEquipmentItem {
  slot: string;
  itemInstanceId: number;
  itemKey: string;
  name: string;
  rarity: string;
  icon: string | null;
  itemStats: Record<string, number>;
  courierEffects: Record<string, number>;
}

export interface NetInventoryState {
  items: NetQuestInventoryItem[];
  equipment: NetEquipmentItem[];
  slotCount: number;
  stats: Record<string, number>;
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
  /** A courier in the zone changed their look; also the ack for this client's own set_appearance. */
  onPlayerAppearance?: (characterId: number, appearance: unknown) => void;
  onSnapshot?: (players: NetPlayerPos[], zoneId?: string, meta?: NetSnapshotMeta) => void;
  onMonsterSnapshot?: (monsters: NetMonsterInfo[]) => void;
  onChatMessage?: (message: NetChatMessage) => void;
  onCombatEvent?: (event: NetCombatEvent) => void;
  onRespawn?: (info: NetRespawnInfo) => void;
  onLoot?: (sourceId: string, items: { itemKey: string; quantity: number }[]) => void;
  onNpcInteraction?: (npcId: string, quests: NetQuestSnapshot[]) => void;
  onQuestState?: (quests: NetQuestSnapshot[]) => void;
  onQuestUpdated?: (payload: {
    action: string;
    quest: NetQuestSnapshot;
    quests: NetQuestSnapshot[];
    inventory: NetQuestInventoryItem[];
    stamps: number;
    /** The character's new total XP (not the granted amount). */
    xp: number;
    /** Present on deliveries: the level/rank the server just wrote. */
    progression?: NetQuestProgression;
    message: string;
  }) => void;
  onQuestNotice?: (message: string) => void;
  /** Kill XP granted to this courier; `xp` is the amount gained, not the total. */
  onXpGained?: (xp: number, progression?: NetQuestProgression) => void;
  onInventoryUpdated?: (items: NetQuestInventoryItem[], stamps: number, state?: NetInventoryState) => void;
  /** requestType is set for intent rejections (gameplay), absent for connection errors. */
  onError?: (code: string, message: string, requestType?: string) => void;
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
/** Backoff after the fast reconnect attempts are exhausted — never strand the
 * player until reload; keep retrying slowly while the tab is open. */
const SLOW_RECONNECT_DELAY_MS = 8_000;

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
  /** Move-intent throttle; starts at the class base and is raised when the
   * server's gear-adjusted speed arrives (speed gear is not dead weight). */
  private moveIntervalMs: number;
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
    this.moveIntervalMs = this.opts.moveIntervalMs;
  }

  /** Adjust the move-intent throttle (server's gear-adjusted speed on join/equip). */
  setMoveIntervalMs(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.moveIntervalMs = Math.max(50, ms);
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
      this.scheduleRecovery();
      return;
    }
    if (this.wsToken === null) {
      // fetchWsToken already fired onError for HTTP failures.
      this.setStatus("closed", "Could not obtain a ws-token");
      this.scheduleRecovery();
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
      this.scheduleRecovery();
      return;
    }
    this.ws = ws;
    // A replaced socket's late events must never touch the current connection.
    ws.onopen = () => {
      if (this.ws !== ws) return;
      if (this.wsToken !== null) {
        this.setStatus("authenticating");
        ws.send(encodeMessage({ type: "authenticate", token: this.wsToken }));
      }
    };
    ws.onmessage = (event: MessageEvent) => {
      if (this.ws !== ws) return;
      const msg = decodeMessage(event.data);
      if (msg === null) return;
      this.dispatch(msg);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.handleClose();
    };
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

  /**
   * Join (or switch to) a zone. Safe to call before authentication completes;
   * the zone only counts as joined once the server answers with zone_state.
   */
  joinZone(zoneId: string): void {
    this.pendingZoneId = zoneId;
    if (this.ws !== null && this.authenticated && this.ws.readyState === WS_READY_OPEN) {
      this.ws.send(encodeMessage({ type: "join_zone", zoneId }));
    }
  }

  /** Send a move intent if we're joined and enough time has passed. */
  moveIntent(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null) return;
    if (this.ws.readyState !== WS_READY_OPEN) return;
    const now = this.opts.now();
    if (now - this.lastIntentAt < this.moveIntervalMs) return;
    this.lastIntentAt = now;
    this.ws.send(encodeMessage({ type: "move_intent", dx, dy }));
  }

  /** Ask the server to interact with an NPC; range and quest completion are server-validated. */
  interact(targetId: string): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null) return;
    if (this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "interact", targetId, kind: "npc" }));
  }

  /** Search a server-authored quest objective at a map object. */
  searchQuest(objectId: string): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null) return;
    if (this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "search_quest", objectId }));
  }

  /** Accept a server-offered quest; prerequisites and parcel creation are authoritative. */
  acceptQuest(questId: string): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null) return;
    if (this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "accept_quest", questId }));
  }

  /** Move an owned inventory item to an empty slot; the server validates ownership. */
  moveInventoryItem(itemInstanceId: number, targetSlot: number): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null || this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "move_item", itemInstanceId, targetSlot }));
  }

  /** Equip an owned JSON-defined gear item. */
  equipItem(itemInstanceId: number, slot?: string): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null || this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "equip_item", itemInstanceId, ...(slot === undefined ? {} : { slot }) }));
  }

  /** Unequip a slot into the first available authoritative inventory slot. */
  unequipItem(slot: string): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null || this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "unequip_item", slot }));
  }

  /** Request the complete server inventory snapshot. */
  requestInventory(): void {
    if (this.ws === null || !this.authenticated || this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "request_inventory" }));
  }

  /** Send a same-zone chat message; the server validates length and rate. */
  chat(text: string): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null) return;
    if (this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "zone_chat", text }));
  }

  /** Change this courier's look; the server normalizes it and echoes player_appearance to the zone. */
  sendSetAppearance(appearance: unknown): void {
    if (this.ws === null || !this.authenticated || this.joinedZoneId === null) return;
    if (this.ws.readyState !== WS_READY_OPEN) return;
    this.ws.send(encodeMessage({ type: "set_appearance", appearance }));
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
    const ws = this.ws;
    this.ws = null;
    if (ws !== null) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }
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
        if (msg.inventoryState !== undefined) {
          const state = normalizeInventoryState(msg.inventoryState);
          // zone_state carries the balance inside inventoryState, not at the top level.
          const stamps = (msg.inventoryState as Record<string, unknown> | null)?.stamps ?? msg.stamps ?? 0;
          this.callbacks.onInventoryUpdated?.(state.items, Number(stamps), state);
        }
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
            progression: normalizeQuestProgression(msg.progression),
            message: typeof msg.message === "string" ? msg.message : "Quest updated",
          });
        }
        break;
      }
      case "quest_notice":
        if (typeof msg.message === "string" && msg.message !== "") this.callbacks.onQuestNotice?.(msg.message);
        break;
      case "xp_gained": {
        const xp = Number(msg.xp);
        if (Number.isFinite(xp) && xp > 0) this.callbacks.onXpGained?.(xp, normalizeQuestProgression(msg.progression));
        break;
      }
      case "inventory_updated": {
        const state = normalizeInventoryState(msg);
        this.callbacks.onInventoryUpdated?.(state.items, Number(msg.stamps ?? 0), state);
        break;
      }
      case "player_joined":
        this.callbacks.onPlayerJoined?.(normalizePlayer(msg));
        break;
      case "player_left":
        this.callbacks.onPlayerLeft?.(Number(msg.characterId));
        break;
      case "player_appearance": {
        const characterId = Number(msg.characterId);
        if (Number.isInteger(characterId) && isRecord(msg.appearance)) {
          this.callbacks.onPlayerAppearance?.(characterId, msg.appearance);
        }
        break;
      }
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
        const requestType = typeof msg.requestType === "string" ? msg.requestType : undefined;
        // A rejected switch leaves the server in the last confirmed zone —
        // don't resurrect the refused zone on the next reconnect.
        if (requestType === "join_zone" && this.joinedZoneId !== null) this.pendingZoneId = this.joinedZoneId;
        this.callbacks.onError?.(code, message, requestType);
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
    if (!wasAuthenticated) {
      // Never authenticated (dropped during the handshake) — the recovery
      // path still retries when this is part of a reconnect cycle.
      this.setStatus("closed", "Connection lost");
      this.scheduleRecovery();
      return;
    }
    this.reconnectAttempts += 1;
    const maxed = this.reconnectAttempts > this.opts.maxReconnectAttempts;
    this.setStatus(
      "reconnecting",
      maxed ? "Connection lost — retrying" : `Attempt ${this.reconnectAttempts}`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, maxed ? SLOW_RECONNECT_DELAY_MS : this.opts.reconnectDelayMs * this.reconnectAttempts);
  }

  /**
   * Keep the reconnect cycle alive after a mid-cycle failure (token fetch or
   * constructor throw) so a flapping network never strands the player at
   * "closed". Initial boot failures and intentional close() are untouched.
   */
  private scheduleRecovery(): void {
    if (this.closedByUser || this.reconnectAttempts === 0) return;
    const maxed = this.reconnectAttempts > this.opts.maxReconnectAttempts;
    this.setStatus(
      "reconnecting",
      maxed ? "Connection lost — retrying" : `Attempt ${this.reconnectAttempts}`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, maxed ? SLOW_RECONNECT_DELAY_MS : this.opts.reconnectDelayMs * this.reconnectAttempts);
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
    ...(isRecord(msg.appearance) ? { appearance: msg.appearance } : {}),
  };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
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
      ...(isRecord(entry.appearance) ? { appearance: entry.appearance } : {}),
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
    const parcelCondition: NetQuestSnapshot["parcelCondition"] =
      q.parcelCondition === "fragile" || q.parcelCondition === "urgent" ? q.parcelCondition : "normal";
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
      parcelCondition,
      deadlineAt: q.deadlineAt === null || q.deadlineAt === undefined ? null : Number(q.deadlineAt),
      sideQuest: q.sideQuest === true,
      findAt: q.findAt === null ? null : String(q.findAt ?? ""),
      searchObjectId: q.searchObjectId === null ? null : String(q.searchObjectId ?? ""),
      rewardItemId: q.rewardItemId === null ? null : String(q.rewardItemId ?? ""),
      friendshipGate: q.friendshipGate && typeof q.friendshipGate === "object"
        ? {
            npcId: String((q.friendshipGate as Record<string, unknown>).npcId ?? ""),
            level: Number((q.friendshipGate as Record<string, unknown>).level ?? 0),
          }
        : null,
      defeat: q.defeat && typeof q.defeat === "object"
        ? {
            monsterKey: String((q.defeat as Record<string, unknown>).monsterKey ?? ""),
            monsterName: String((q.defeat as Record<string, unknown>).monsterName ?? ""),
            count: Number((q.defeat as Record<string, unknown>).count ?? 1),
          }
        : null,
      additionalStops: normalizeStringList(q.additionalStops),
      visitedStops: normalizeStringList(q.visitedStops),
    };
  }).filter((q) => q.questId !== "");
}

function normalizeStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Deliveries carry progression; accepts and searches do not. Returning
 * `undefined` (rather than zeros) keeps "no level information" distinct from
 * "level 0", so the HUD only ever reacts to a real server value.
 */
function normalizeQuestProgression(raw: unknown): NetQuestProgression | undefined {
  if (raw === null || raw === undefined) return undefined;
  const row = raw as Record<string, unknown>;
  const level = Number(row.level ?? 0);
  if (!Number.isFinite(level) || level <= 0) return undefined;
  return {
    level,
    previousLevel: Math.max(1, Number(row.previousLevel ?? level)),
    levelsGained: Math.max(0, Number(row.levelsGained ?? 0)),
    experience: Math.max(0, Number(row.experience ?? 0)),
    skillPoints: Math.max(0, Number(row.skillPoints ?? 0)),
    courierRank: typeof row.courierRank === "string" ? row.courierRank : "",
    rankPromotion: typeof row.rankPromotion === "string" && row.rankPromotion !== "" ? row.rankPromotion : null,
  };
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
      ...(typeof item.name === "string" ? { name: item.name } : {}),
      ...(typeof item.category === "string" ? { category: item.category } : {}),
      ...(typeof item.rarity === "string" ? { rarity: item.rarity } : {}),
      ...(item.icon === null || typeof item.icon === "string" ? { icon: item.icon as string | null } : {}),
      ...(item.equippedSlot === null || typeof item.equippedSlot === "string" ? { equippedSlot: item.equippedSlot as string | null } : {}),
    };
  });
}

function normalizeInventoryState(raw: unknown): NetInventoryState {
  const payload = raw as Record<string, unknown>;
  const equipment = Array.isArray(payload.equipment) ? payload.equipment.map((entry) => {
    const item = entry as Record<string, unknown>;
    return {
      slot: String(item.slot ?? ""),
      itemInstanceId: Number(item.itemInstanceId ?? 0),
      itemKey: String(item.itemKey ?? ""),
      name: String(item.name ?? "Unknown item"),
      rarity: String(item.rarity ?? "common"),
      icon: item.icon === null ? null : String(item.icon ?? ""),
      itemStats: normalizeNumericRecord(item.itemStats),
      courierEffects: normalizeNumericRecord(item.courierEffects),
    };
  }) : [];
  return {
    items: normalizeQuestInventory(payload.items),
    equipment,
    slotCount: Number(payload.slotCount ?? 12),
    stats: normalizeNumericRecord(payload.stats),
  };
}

function normalizeNumericRecord(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, value]) => typeof value === "number" && Number.isFinite(value))) as Record<string, number>;
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
