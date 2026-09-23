import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server } from "node:http";
import { consumeWsToken } from "./tokenStore.ts";
import { ZoneStore, type ZonePlayer } from "./zoneStore.ts";
import { validateMoveIntent, moveIntervalMsForSpeed } from "./movement.ts";
import { MonsterStore, type MonsterPlayer } from "./monsterStore.ts";
import { classCombatProfile, computeDamage, tileDistance, validateAttack } from "./combat.ts";
import type { MonsterDefinitionRow } from "../models/Monster.ts";
import type { ZoneData } from "./zoneData.ts";
import type { MonsterBrain } from "../ai/MonsterBrain.ts";
import type { ZoneScene } from "../ai/prompts.ts";
import type { QuestMutationResult, QuestSnapshot, QuestInventoryItem } from "../models/Quest.ts";
import type { EquipmentMutationResult, InventoryState } from "../models/Equipment.ts";
import { logger } from "../middleware/logger.ts";
import { server as serverConfig } from "../config/index.ts";
import { getGameplayRates } from "../models/GameplayRates.ts";

/** Cap WS frames — game intents are small JSON; the ws default is 100MiB. */
const WS_MAX_PAYLOAD = 64 * 1024;

/** Per-connection message budget (design/architecture.md §4: cap messages/sec). */
const MSG_WINDOW_MS = 10_000;
const MSG_WINDOW_LIMIT = 60;
/** Consecutive failed authenticate attempts before the socket is closed. */
const MAX_AUTH_FAILURES = 5;
/** Liveness probe cadence — dead peers are terminated, not left half-open. */
const WS_HEARTBEAT_MS = 30_000;

/** Defaults from design/architecture.md §5/§7 (180 px/s over 48px tiles). */
const DEFAULT_TICK_MS = 50; // 20 Hz
const DEFAULT_GRACE_MS = 60_000;
const DEFAULT_TILES_PER_SEC = 180 / 48;
/** How often a moving player's position is flushed to the DB (design/architecture.md §9). */
const DEFAULT_PERSIST_INTERVAL_MS = 10_000;
/** Respawn invulnerability window after defeat (design/combat.md §3). */
const DEFEAT_INVULN_MS = 3000;
/** Safe zone players are sent to on defeat (design/combat.md §3). */
const DEFAULT_SAFE_ZONE = "zone-clover-village";

/** A character as loaded for a WS session (name/class/position + Phase 3 stats). */
export interface CharacterSession {
  characterId: number;
  accountId: number;
  name: string;
  classKey: string;
  zoneId: string;
  pos: { x: number; y: number };
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  critChance: number;
  critMultiplier: number;
}

/** Minimal socket abstraction so the server is testable without `ws`. */
export interface SocketLike {
  send(payload: unknown): void;
  close(): void;
}

export interface GameServerDeps {
  loadCharacter: (characterId: number) => Promise<CharacterSession | null>;
  getZoneData: (zoneId: string) => ZoneData | null;
  /** Best-effort position persistence (DB); defaults to no-op. */
  persistPosition?: (
    characterId: number,
    zoneId: string,
    pos: { x: number; y: number },
  ) => Promise<void>;
  /** Best-effort HP persistence (DB); defaults to no-op. */
  persistHp?: (characterId: number, hp: number, maxHp: number) => Promise<void>;
  /** Best-effort XP grant on monster kill (DB); defaults to no-op. */
  grantXp?: (characterId: number, amount: number) => Promise<number | null>;
  /** Best-effort inventory grant on monster loot (DB); defaults to no-op. */
  grantInventory?: (characterId: number, items: { itemKey: string; quantity: number }[]) => Promise<void>;
  /** Monster templates for a zone (DB); defaults to [] so safe zones stay empty. */
  getMonsterDefinitions?: (zoneKey: string) => Promise<MonsterDefinitionRow[]>;
  /** AI game engine: optional world-brain that overrides monster decisions. */
  monsterBrain?: MonsterBrain | null;
  /** Server-side NPC tile lookup used to validate interaction range. */
  getNpcPosition?: (npcId: string, zoneId: string) => { x: number; y: number } | null;
  /** Quest state and mutations; omitted in isolated combat tests. */
  getQuestState?: (characterId: number) => Promise<QuestSnapshot[]>;
  acceptQuest?: (characterId: number, questId: string) => Promise<QuestMutationResult>;
  completeDelivery?: (characterId: number, targetNpcId: string) => Promise<QuestMutationResult>;
  searchQuest?: (characterId: number, objectId: string) => Promise<QuestMutationResult>;
  getQuestInventory?: (characterId: number) => QuestInventoryItem[];
  getInventoryState?: (characterId: number) => InventoryState;
  moveInventoryItem?: (characterId: number, itemInstanceId: number, targetSlot: number) => EquipmentMutationResult;
  equipItem?: (characterId: number, itemInstanceId: number, requestedSlot?: string) => EquipmentMutationResult;
  unequipItem?: (characterId: number, slot: string) => EquipmentMutationResult;
  /** Server-side map-object tile lookup used to validate search interactions. */
  getObjectPosition?: (objectId: string, zoneId: string) => { x: number; y: number } | null;
  /** Reset fragile tutorial parcels when a courier is defeated. */
  resetFragileDeliveriesOnDefeat?: (characterId: number) => string[];
  tickMs?: number;
  graceMs?: number;
  tilesPerSecond?: number;
  /** Override the derived move interval (tests only). */
  minMoveIntervalMs?: number;
  /** Min ms between periodic position writes per player (tests only). */
  persistIntervalMs?: number;
}

interface Session {
  socket: SocketLike;
  accountId: number | null;
  characterId: number | null;
  zoneId: string | null;
  authenticated: boolean;
  /** True sliding-window budget: timestamps of frames still inside the window. */
  msgTimes: number[];
  /** Consecutive authenticate failures before the connection is dropped. */
  authFailures: number;
}

/**
 * Server-authoritative WebSocket game server (Phase 2 — Multiplayer Village).
 * Client sends intents; the server validates and broadcasts authoritative
 * state. Message shapes follow design/network-protocol.md.
 */
export class GameServer {
  private wss: WebSocketServer | null = null;
  private zones = new ZoneStore();
  private monsters = new MonsterStore();
  private sessions = new Map<SocketLike, Session>();
  private tickTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private tickRunning = false;
  private graceTimers = new Map<number, NodeJS.Timeout>();
  private tickMs: number;
  private graceMs: number;
  private minMoveIntervalMs: number;
  private persistIntervalMs: number;
  private snapshotSequences = new Map<string, number>();

  constructor(private deps: GameServerDeps) {
    this.tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
    this.graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
    this.minMoveIntervalMs =
      deps.minMoveIntervalMs ??
      moveIntervalMsForSpeed(deps.tilesPerSecond ?? DEFAULT_TILES_PER_SEC);
    this.persistIntervalMs = deps.persistIntervalMs ?? DEFAULT_PERSIST_INTERVAL_MS;
  }

  /** Attach to an HTTP server and start the snapshot tick. */
  attach(server: Server): void {
    this.wss = new WebSocketServer({
      server,
      path: "/ws",
      maxPayload: WS_MAX_PAYLOAD,
      // Reject browser upgrades from unlisted origins (CSRF-style hijack);
      // clients without an Origin header (non-browser) still need a ws-token.
      verifyClient: (info, done) => {
        const origin = info.origin ?? "";
        if (origin !== "" && !serverConfig.isDev && !serverConfig.corsAllowedOrigins.includes(origin)) {
          done(false, 403, "Origin not allowed");
          return;
        }
        done(true);
      },
    });
    this.wss.on("connection", (socket: WebSocket) => this.wireSocket(socket));
    this.tickTimer = setInterval(() => this.runTick(), this.tickMs);
    this.tickTimer.unref?.();
    // Liveness probe: ping every client; terminate any that never pong back.
    // A tab that suspends past the grace window otherwise leaves a half-open
    // connection in the zone until the TCP stack notices.
    this.heartbeatTimer = setInterval(
      () => this.heartbeatSweep(this.wss?.clients ?? []),
      WS_HEARTBEAT_MS,
    );
    this.heartbeatTimer.unref?.();
    logger.info("WebSocket game server attached", { path: "/ws" });
  }

  /** Total connected, authenticated players across all zones. */
  onlineCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.authenticated && session.characterId !== null) count += 1;
    }
    return count;
  }

  /** Connected player count per zone id (zones with zero players omitted). */
  zonePlayerCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const zoneId of this.zones.zoneIds()) {
      const connected = this.zones.players(zoneId).filter((p) => p.connected).length;
      if (connected > 0) counts[zoneId] = connected;
    }
    return counts;
  }

  /**
   * Admin kick: close every live session bound to the character. Returns the
   * number of sockets closed; the zone broadcast happens via the close event.
   */
  disconnectCharacter(characterId: number): number {
    let closed = 0;
    for (const [socket, session] of [...this.sessions]) {
      if (session.characterId !== characterId) continue;
      session.authenticated = false;
      this.sessions.delete(socket);
      socket.close();
      closed += 1;
    }
    // Remove from all zones immediately so snapshots stop including them.
    for (const zoneId of this.zones.zoneIds()) {
      if (this.zones.get(zoneId, characterId) !== null) {
        this.removeFromZone(zoneId, characterId);
      }
    }
    return closed;
  }

  /** Stop the tick loop and timers (graceful shutdown / tests). */
  close(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.wss?.close();
    this.wss = null;
    this.snapshotSequences.clear();
  }

  private wireSocket(ws: WebSocket): void {
    const socket: SocketLike = {
      send: (payload) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(payload));
        }
      },
      close: () => ws.close(),
    };
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on("pong", () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });
    this.registerSocket(socket);
    ws.on("message", (raw: RawData) => {
      void this.onMessage(socket, raw);
    });
    ws.on("close", () => this.onClose(socket));
  }

  /** Public for tests: register a fake socket as a new session. */
  registerSocket(socket: SocketLike): void {
    this.sessions.set(socket, {
      socket,
      accountId: null,
      characterId: null,
      zoneId: null,
      authenticated: false,
      msgTimes: [],
      authFailures: 0,
    });
  }

  /**
   * Public for tests: one liveness sweep — ping every peer and terminate any
   * that failed to pong the previous sweep (half-open connections can't linger).
   */
  heartbeatSweep(clients: Iterable<WebSocket>): void {
    for (const ws of clients) {
      const alive = (ws as WebSocket & { isAlive?: boolean }).isAlive;
      if (alive === false) {
        ws.terminate();
        continue;
      }
      (ws as WebSocket & { isAlive?: boolean }).isAlive = false;
      ws.ping();
    }
  }

  /** Public for tests: run one snapshot tick. */
  runTick(): void {
    // Re-entrancy guard: a tick that outlives its interval (slow DB write,
    // blocking AI call) must not stack a second pass over the same zones.
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      this.runTickInternal();
    } finally {
      this.tickRunning = false;
    }
  }

  private runTickInternal(): void {
    const now = Date.now();
    for (const zoneId of this.zones.zoneIds()) {
      const players = this.zones.snapshot(zoneId);
      if (players.length === 0) continue;
      const sequence = (this.snapshotSequences.get(zoneId) ?? 0) + 1;
      this.snapshotSequences.set(zoneId, sequence);
      this.broadcast(zoneId, {
        type: "player_snapshot",
        zoneId,
        sequence,
        serverTime: now,
        players,
      });
      // Fire-and-forget: ask the world-brain for this zone (never awaited).
      this.requestMonsterDecisions(zoneId, now);
      this.tickMonsters(zoneId, now);
      // Best-effort periodic persistence: a moving player's position is
      // flushed at most once per interval (and immediately on leave/grace).
      for (const player of this.zones.players(zoneId)) {
        if (!player.connected || !player.dirty) continue;
        if (now - player.lastPersistAt < this.persistIntervalMs) continue;
        // Clear only after the write settles AND the player hasn't moved
        // since this flush began — clearing before the resolve could drop a
        // move that landed mid-write; a failed write re-dirties for retry.
        const flushingPos = { ...player.pos };
        player.lastPersistAt = now;
        void this.persist(player.characterId, zoneId, flushingPos).then((ok) => {
          if (!ok) {
            player.dirty = true;
            return;
          }
          if (player.pos.x === flushingPos.x && player.pos.y === flushingPos.y) {
            player.dirty = false;
          }
        });
      }
    }
  }

  /** Advance monster AI for a zone and broadcast their state + hits. */
  private tickMonsters(zoneId: string, now: number): void {
    const monsters = this.monsters.monsters(zoneId);
    if (monsters.length === 0) return;
    const zone = this.deps.getZoneData(zoneId);
    if (zone === null) return;
    const events = this.monsters.update(
      zoneId,
      now,
      this.zonePlayers(zoneId),
      zone.isWalkable,
      this.tickMs,
      this.deps.monsterBrain?.decisionsFor(zoneId) ?? null,
    );
    for (const event of events) this.applyMonsterAttack(zoneId, event, now);
    this.broadcast(zoneId, {
      type: "monster_snapshot",
      monsters: monsters.map(monsterSnapshot),
    });
  }

  /** Public for tests: feed a raw message from a socket (awaitable). */
  async onMessage(socket: SocketLike, raw: RawData | string): Promise<void> {
    const session = this.sessions.get(socket);
    if (session === undefined) return;
    // Sliding-window message budget (design/architecture.md §4). Counts every
    // frame — even garbage — so a spamming peer is dropped, not just errored.
    // A fixed window that resets at the boundary could be gamed by bursting
    // just before the reset; keeping the in-window timestamps makes it exact.
    const now = Date.now();
    const times = session.msgTimes;
    while (times.length > 0 && now - times[0] >= MSG_WINDOW_MS) times.shift();
    if (times.length >= MSG_WINDOW_LIMIT) {
      this.sendError(session, "RATE_LIMITED", "Too many messages — connection closed");
      session.socket.close();
      return;
    }
    times.push(now);
    let msg: unknown;
    try {
      msg = JSON.parse(toText(raw)) as unknown;
    } catch {
      this.sendError(session, "INVALID_MESSAGE", "Message body is not valid JSON");
      return;
    }
    if (typeof msg !== "object" || msg === null) {
      this.sendError(session, "INVALID_MESSAGE", "Message must be a JSON object");
      return;
    }
    const { type } = msg as { type?: unknown };
    if (typeof type !== "string") {
      this.sendError(session, "INVALID_MESSAGE", "Message is missing a type");
      return;
    }
    try {
      await this.route(session, type, msg as Record<string, unknown>);
    } catch (err) {
      logger.error("WS message handling failed", { error: String(err) });
      this.sendError(session, "INTERNAL_ERROR", "Internal server error", type);
    }
  }

  /** Public for tests: simulate a socket closing. */
  onClose(socket: SocketLike): void {
    const session = this.sessions.get(socket);
    this.sessions.delete(socket);
    if (session === undefined) return;
    this.startGrace(session);
  }

  private async route(
    session: Session,
    type: string,
    msg: Record<string, unknown>,
  ): Promise<void> {
    switch (type) {
      case "authenticate":
        await this.handleAuthenticate(session, msg);
        return;
      case "join_zone":
        await this.handleJoinZone(session, msg);
        return;
      case "move_intent":
        this.handleMoveIntent(session, msg);
        return;
      case "attack":
        this.handleAttack(session, msg);
        return;
      case "interact":
        await this.handleInteract(session, msg);
        return;
      case "accept_quest":
        await this.handleAcceptQuest(session, msg);
        return;
      case "search_quest":
        await this.handleSearchQuest(session, msg);
        return;
      case "move_item":
        this.handleMoveItem(session, msg);
        return;
      case "equip_item":
        await this.handleEquipItem(session, msg);
        return;
      case "unequip_item":
        await this.handleUnequipItem(session, msg);
        return;
      case "request_inventory":
        this.handleRequestInventory(session);
        return;
      case "zone_chat":
        this.handleZoneChat(session, msg);
        return;
      case "leave_zone":
        this.handleLeaveZone(session);
        return;
      default:
        this.sendError(
          session,
          "INVALID_MESSAGE",
          `Unknown message type "${type}"`,
        );
    }
  }

  private async handleAuthenticate(
    session: Session,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const token = typeof msg.token === "string" ? msg.token : "";
    if (token === "") {
      this.sendError(session, "INVALID_TOKEN", "authenticate requires a token");
      return;
    }
    const identity = consumeWsToken(token);
    if (identity === null) {
      session.authFailures += 1;
      this.sendError(session, "INVALID_TOKEN", "WS token is invalid, expired, or already used");
      if (session.authFailures >= MAX_AUTH_FAILURES) session.socket.close();
      return;
    }
    const character = await this.deps.loadCharacter(identity.characterId);
    if (character === null || character.accountId !== identity.accountId) {
      session.authFailures += 1;
      this.sendError(session, "INVALID_TOKEN", "Character no longer exists for this account");
      if (session.authFailures >= MAX_AUTH_FAILURES) session.socket.close();
      return;
    }
    session.authFailures = 0;
    session.accountId = character.accountId;
    session.characterId = character.characterId;
    session.zoneId = character.zoneId;
    session.authenticated = true;
    // One session per character: a half-open socket that never reached the
    // server's close event (the client reconnected before the heartbeat
    // noticed) would otherwise stay in the map and yank the live player's
    // zone state when its late onClose fires.
    this.expireDuplicateSessions(character.characterId, session);
    session.socket.send({
      type: "authenticated",
      accountId: character.accountId,
      characterId: character.characterId,
      zoneId: character.zoneId,
      hp: character.hp,
      maxHp: character.maxHp,
    });
    logger.info("WS session authenticated", {
      accountId: character.accountId,
      characterId: character.characterId,
    });
  }

  private async handleJoinZone(
    session: Session,
    msg: Record<string, unknown>,
  ): Promise<void> {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId as number;
    const zoneId = typeof msg.zoneId === "string" ? msg.zoneId : "";
    const zone = this.deps.getZoneData(zoneId);
    if (zone === null) {
      this.sendError(session, "ZONE_NOT_FOUND", `Unknown zone "${zoneId}"`, "join_zone");
      return;
    }

    // Zone transitions are server-validated: a courier may only join a zone
    // their current zone is actually connected to (the map JSON's transition
    // list). The initial join (requested === the authenticated zone) always
    // passes; an unknown current zone (stale saved position) is treated as
    // lenient so a deleted zone can never strand a player.
    if (session.zoneId !== null && session.zoneId !== zoneId) {
      const current = this.deps.getZoneData(session.zoneId);
      const connected =
        current === null ||
        current.transitions.some((t) => t.toZone === zoneId) ||
        zone.transitions.some((t) => t.toZone === session.zoneId as string);
      if (!connected) {
        this.sendError(
          session,
          "ZONE_UNREACHABLE",
          `Zone "${zoneId}" is not connected to "${session.zoneId}"`,
          "join_zone",
        );
        return;
      }
    }

    // Reconnect within the grace window: the character may still be tracked
    // in another zone — drop them there first (broadcasts player_left).
    this.dropFromAllZones(characterId, zoneId);

    const character = await this.deps.loadCharacter(characterId);
    if (character === null) {
      this.sendError(session, "INVALID_TOKEN", "Character no longer exists");
      return;
    }
    // A world resize can leave stale saved positions on colliding tiles —
    // snap to the zone spawn instead of trusting the DB blindly.
    const savedPos = { x: character.pos.x, y: character.pos.y };
    const pos = zone.isWalkable(savedPos.x, savedPos.y)
      ? savedPos
      : { ...zone.spawn };
    await this.seedZoneMonsters(zoneId);
    // Warm the model so the first monster/NPC AI call isn't cold.
    this.deps.monsterBrain?.prewarm();
    const existing = this.zones.get(zoneId, characterId);
    if (existing !== null) {
      // Grace restore: reuse the server-authoritative position. The position
      // was already persisted during the disconnect window, so restart the
      // periodic-write clock from scratch.
      existing.connected = true;
      existing.name = character.name;
      existing.classKey = character.classKey;
      existing.dirty = false;
      existing.lastPersistAt = Date.now();
    } else {
      // Zone capacity: the synced max_players is now enforced. Grace restores
      // above are always allowed — a reconnecting player owns their slot.
      const capacity = zone.maxPlayers;
      const connected = this.zones
        .players(zoneId)
        .filter((p) => p.connected).length;
      if (connected >= capacity) {
        this.sendError(session, "ZONE_FULL", `Zone "${zoneId}" is at capacity`, "join_zone");
        return;
      }
      const now = Date.now();
      const player: ZonePlayer = {
        characterId,
        accountId: session.accountId as number,
        name: character.name,
        classKey: character.classKey,
        pos,
        connected: true,
        lastMoveAt: 0,
        dirty: false,
        lastPersistAt: now,
        hp: character.hp,
        maxHp: character.maxHp,
        attack: character.attack,
        defense: character.defense,
        speed: character.speed,
        critChance: character.critChance,
        critMultiplier: character.critMultiplier,
        lastAttackAt: 0,
        invulnUntil: now,
      };
      this.zones.join(zoneId, player);
      this.broadcast(zoneId, {
        type: "player_joined",
        characterId: player.characterId,
        name: player.name,
        classKey: player.classKey,
        pos: { ...player.pos },
      }, characterId);
    }

    session.zoneId = zoneId;
    this.clearGrace(characterId);
    session.socket.send({
      type: "zone_state",
      zoneId,
      players: this.zones.snapshot(zoneId),
      monsters: this.monsters.monsters(zoneId).map(monsterSnapshot),
      npcs: [],
      objects: [],
      quests: this.deps.getQuestState === undefined
        ? []
        : await this.deps.getQuestState(characterId),
      inventory: this.deps.getQuestInventory?.(characterId) ?? [],
      ...(this.deps.getInventoryState === undefined ? {} : { inventoryState: this.deps.getInventoryState(characterId) }),
    });
  }

  private async handleInteract(session: Session, msg: Record<string, unknown>): Promise<void> {
    if (!this.requireAuth(session)) return;
    const zoneId = session.zoneId;
    const characterId = session.characterId;
    const targetId = typeof msg.targetId === "string" ? msg.targetId : "";
    if (zoneId === null || characterId === null) {
      this.sendError(session, "NOT_IN_ZONE", "join_zone before interact", "interact");
      return;
    }
    const target = this.deps.getNpcPosition?.(targetId, zoneId);
    const player = this.zones.get(zoneId, characterId);
    if (target === null || target === undefined || player === null || tileDistance(player.pos, target) > 2) {
      this.sendError(session, "OUT_OF_RANGE", "NPC is out of interaction range", "interact");
      return;
    }
    const delivery = this.deps.completeDelivery === undefined
      ? null
      : await this.deps.completeDelivery(characterId, targetId);
    if (delivery !== null && delivery.ok) {
      this.sendQuestMutation(session, delivery, "delivery");
      return;
    }
    const quests = this.deps.getQuestState === undefined ? [] : await this.deps.getQuestState(characterId);
    session.socket.send({ type: "npc_interaction", npcId: targetId, quests });
  }

  private async handleSearchQuest(session: Session, msg: Record<string, unknown>): Promise<void> {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId;
    const zoneId = session.zoneId;
    const objectId = typeof msg.objectId === "string" ? msg.objectId : "";
    if (characterId === null || zoneId === null || objectId === "" || this.deps.searchQuest === undefined) {
      this.sendError(session, "QUEST_NOT_ACTIVE", "No searchable quest objective is active", "search_quest");
      return;
    }
    const player = this.zones.get(zoneId, characterId);
    const object = this.deps.getObjectPosition?.(objectId, zoneId);
    if (player === null || object === null || object === undefined || tileDistance(player.pos, object) > 2) {
      this.sendError(session, "OUT_OF_RANGE", "Search location is out of range", "search_quest");
      return;
    }
    const result = await this.deps.searchQuest(characterId, objectId);
    if (!result.ok) {
      this.sendError(session, result.reason, "Quest objective cannot be searched", "search_quest");
      return;
    }
    this.sendQuestMutation(session, result, "searched");
  }

  private handleRequestInventory(session: Session): void {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId;
    if (characterId === null || this.deps.getInventoryState === undefined) {
      this.sendError(session, "INTERNAL_ERROR", "Inventory service is unavailable", "request_inventory");
      return;
    }
    this.sendInventoryState(session, this.deps.getInventoryState(characterId));
  }

  private handleMoveItem(session: Session, msg: Record<string, unknown>): void {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId;
    if (characterId === null || this.deps.moveInventoryItem === undefined) {
      this.sendError(session, "INTERNAL_ERROR", "Inventory service is unavailable", "move_item");
      return;
    }
    // Untrusted input: coerce nothing — a garbage id must be a clean protocol
    // rejection, not a NaN bound into a prepared statement (INTERNAL_ERROR).
    const itemInstanceId = Number(msg.itemInstanceId);
    if (!Number.isInteger(itemInstanceId) || itemInstanceId < 1) {
      this.sendError(session, "INVALID_SLOT", "itemInstanceId must be a positive integer", "move_item");
      return;
    }
    const result = this.deps.moveInventoryItem(characterId, itemInstanceId, Number(msg.targetSlot));
    if (!result.ok) {
      this.sendError(session, result.reason, "Inventory move rejected", "move_item");
      return;
    }
    this.sendInventoryState(session, result.inventory, result.message);
  }

  private async handleEquipItem(session: Session, msg: Record<string, unknown>): Promise<void> {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId;
    if (characterId === null || this.deps.equipItem === undefined) {
      this.sendError(session, "INTERNAL_ERROR", "Equipment service is unavailable", "equip_item");
      return;
    }
    // Same untrusted-input guard as move_item: reject non-integer ids cleanly.
    const itemInstanceId = Number(msg.itemInstanceId);
    if (!Number.isInteger(itemInstanceId) || itemInstanceId < 1) {
      this.sendError(session, "INVALID_SLOT", "itemInstanceId must be a positive integer", "equip_item");
      return;
    }
    const requestedSlot = typeof msg.slot === "string" ? msg.slot : undefined;
    const result = this.deps.equipItem(characterId, itemInstanceId, requestedSlot);
    if (!result.ok) {
      this.sendError(session, result.reason, "Equipment change rejected", "equip_item");
      return;
    }
    await this.refreshSessionStats(session);
    this.sendInventoryState(session, result.inventory, result.message);
  }

  private async handleUnequipItem(session: Session, msg: Record<string, unknown>): Promise<void> {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId;
    if (characterId === null || this.deps.unequipItem === undefined) {
      this.sendError(session, "INTERNAL_ERROR", "Equipment service is unavailable", "unequip_item");
      return;
    }
    const result = this.deps.unequipItem(characterId, typeof msg.slot === "string" ? msg.slot : "");
    if (!result.ok) {
      this.sendError(session, result.reason, "Equipment change rejected", "unequip_item");
      return;
    }
    await this.refreshSessionStats(session);
    this.sendInventoryState(session, result.inventory, result.message);
  }

  private async refreshSessionStats(session: Session): Promise<void> {
    if (session.characterId === null || session.zoneId === null) return;
    const player = this.zones.get(session.zoneId, session.characterId);
    if (player === null || this.deps.loadCharacter === undefined) return;
    const refreshed = await this.deps.loadCharacter(session.characterId);
    if (refreshed === null) return;
    player.attack = refreshed.attack;
    player.defense = refreshed.defense;
    player.speed = refreshed.speed;
    player.critChance = refreshed.critChance;
    player.critMultiplier = refreshed.critMultiplier;
  }

  private sendInventoryState(session: Session, inventory: InventoryState, message?: string): void {
    session.socket.send({
      type: "inventory_updated",
      items: inventory.items,
      equipment: inventory.equipment,
      slotCount: inventory.slotCount,
      stats: inventory.stats,
      stamps: inventory.stamps,
      ...(message === undefined ? {} : { message }),
    });
  }

  private async handleAcceptQuest(session: Session, msg: Record<string, unknown>): Promise<void> {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId;
    const questId = typeof msg.questId === "string" ? msg.questId : "";
    const zoneId = session.zoneId;
    if (characterId === null || zoneId === null || questId === "" || this.deps.acceptQuest === undefined) {
      this.sendError(session, "QUEST_NOT_AVAILABLE", "Quest cannot be accepted", "accept_quest");
      return;
    }
    const offeredQuest = (this.deps.getQuestState === undefined ? [] : await this.deps.getQuestState(characterId))
      .find((quest) => quest.questId === questId);
    const player = this.zones.get(zoneId, characterId);
    const giver = offeredQuest === undefined ? null : this.deps.getNpcPosition?.(offeredQuest.giverId, zoneId);
    if (offeredQuest === undefined || player === null || giver === null || giver === undefined || tileDistance(player.pos, giver) > 2) {
      this.sendError(session, "OUT_OF_RANGE", "Stand near the quest giver to accept this route", "accept_quest");
      return;
    }
    const result = await this.deps.acceptQuest(characterId, questId);
    if (!result.ok) {
      this.sendError(session, result.reason, "Quest cannot be accepted", "accept_quest");
      return;
    }
    this.sendQuestMutation(session, result, "accepted");
  }

  private sendQuestMutation(session: Session, result: Extract<QuestMutationResult, { ok: true }>, action: "accepted" | "delivery" | "searched"): void {
    session.socket.send({
      type: "quest_updated",
      action,
      quest: result.quest,
      quests: result.quests,
      inventory: result.inventory,
      stamps: result.stamps,
      xp: result.xp,
      message: result.message,
      // Deliveries only: the level/rank the grant produced, so the HUD can show
      // a level-up without re-deriving the curve from total XP.
      ...(result.progression === undefined ? {} : { progression: result.progression }),
    });
    session.socket.send({
      type: "inventory_updated",
      items: result.inventory,
      stamps: result.stamps,
    });
  }

  /** Load monster templates once per zone and seed its spawn points. */
  private async seedZoneMonsters(zoneId: string): Promise<void> {
    if (this.monsters.monsters(zoneId).length > 0) return;
    const zone = this.deps.getZoneData(zoneId);
    if (zone === null || zone.monsterSpawns.length === 0) return;
    const defs =
      (await this.deps.getMonsterDefinitions?.(zoneId)) ?? [];
    this.monsters.seed(zoneId, zone.monsterSpawns, defs);
  }

  private handleMoveIntent(
    session: Session,
    msg: Record<string, unknown>,
  ): void {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId as number;
    const zoneId = session.zoneId;
    if (zoneId === null) {
      this.sendError(session, "NOT_IN_ZONE", "join_zone before move_intent", "move_intent");
      return;
    }
    const player = this.zones.get(zoneId, characterId);
    if (player === null || !player.connected) {
      this.sendError(session, "NOT_IN_ZONE", "Character is not in this zone", "move_intent");
      return;
    }
    const zone = this.deps.getZoneData(zoneId);
    if (zone === null) return; // zone vanished; next join_zone will surface it

    const verdict = validateMoveIntent({
      from: player.pos,
      dx: Number(msg.dx),
      dy: Number(msg.dy),
      width: zone.width,
      height: zone.height,
      isWalkable: zone.isWalkable,
      lastMoveAt: player.lastMoveAt,
      now: Date.now(),
      // Phase 3 — class speed drives the movement cap (bear is slower, fox
      // faster; design/classes.md starting speeds over 48px tiles).
      minMoveIntervalMs: this.moveIntervalFor(player.speed),
    });
    if (!verdict.ok) {
      this.sendError(session, verdict.code, "Move intent rejected", "move_intent");
      return;
    }
    player.pos = verdict.to;
    player.lastMoveAt = Date.now();
    player.dirty = true; // mark for the periodic DB flush
    // No direct reply — the tick broadcasts the authoritative snapshot.
  }

  private handleZoneChat(session: Session, msg: Record<string, unknown>): void {
    if (!this.requireAuth(session)) return;
    const zoneId = session.zoneId;
    if (zoneId === null) {
      this.sendError(session, "NOT_IN_ZONE", "join_zone before zone_chat", "zone_chat");
      return;
    }
    const text = typeof msg.text === "string" ? msg.text.trim().slice(0, 240) : "";
    if (text === "") {
      this.sendError(session, "INVALID_CHAT", "Chat message cannot be empty", "zone_chat");
      return;
    }
    const now = Date.now();
    const player = this.zones.get(zoneId, session.characterId as number);
    if (player === null || !player.connected) return;
    const chatAt = (player as ZonePlayer & { lastChatAt?: number }).lastChatAt ?? 0;
    if (now - chatAt < 1_000) {
      this.sendError(session, "CHAT_RATE_LIMIT", "Please wait before sending another message", "zone_chat");
      return;
    }
    (player as ZonePlayer & { lastChatAt?: number }).lastChatAt = now;
    this.broadcast(zoneId, {
      type: "zone_chat",
      characterId: player.characterId,
      name: player.name,
      text,
    });
  }

  private handleLeaveZone(session: Session): void {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId as number;
    const zoneId = session.zoneId;
    session.zoneId = null;
    if (zoneId === null) return;
    this.removeFromZone(zoneId, characterId);
  }

  private handleAttack(session: Session, msg: Record<string, unknown>): void {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId as number;
    const zoneId = session.zoneId;
    if (zoneId === null) {
      this.sendError(session, "NOT_IN_ZONE", "join_zone before attack", "attack");
      return;
    }
    const player = this.zones.get(zoneId, characterId);
    if (player === null || !player.connected) {
      this.sendError(session, "NOT_IN_ZONE", "Character is not in this zone", "attack");
      return;
    }
    const targetId = typeof msg.targetEntityId === "string" ? msg.targetEntityId : "";
    const monster = this.monsters.get(zoneId, targetId);
    if (monster === null) {
      this.sendError(session, "INVALID_TARGET", "Unknown monster in this zone", "attack");
      return;
    }

    const now = Date.now();
    const profile = classCombatProfile(player.classKey);
    const verdict = validateAttack({
      range: tileDistance(player.pos, monster.pos),
      maxRange: profile.maxRange,
      cooldownMs: profile.cooldownMs,
      lastUseAt: player.lastAttackAt,
      now,
      targetAlive: monster.alive,
      attackerAlive: player.hp > 0,
    });
    if (!verdict.ok) {
      this.sendError(session, verdict.code, "Attack rejected", "attack");
      return;
    }

    player.lastAttackAt = now;
    const result = computeDamage(
      {
        attack: player.attack,
        critChance: player.critChance,
        critMultiplier: player.critMultiplier,
      },
      { defense: monster.defense },
    );
    const lethal = this.monsters.damage(zoneId, targetId, result.damage);
    this.monsters.aggroOn(zoneId, targetId, characterId, now);

    this.broadcast(zoneId, {
      type: "combat_event",
      instigatorId: characterId,
      targetId,
      ability: "basic_attack",
      damage: result.damage,
      targetHp: lethal ? 0 : monster.hp,
      targetMaxHp: monster.maxHp,
      outcome: lethal ? "defeated" : result.crit ? "crit" : "hit",
      resourceCost: {},
    });

    if (lethal) {
      void this.onMonsterDefeated(zoneId, characterId, targetId, monster.defKey);
    }
  }

  /** Reward the killer with XP + loot after a monster dies. */
  private async onMonsterDefeated(
    zoneId: string,
    killerId: number,
    monsterId: string,
    defKey: string,
  ): Promise<void> {
    const monster = this.monsters.get(zoneId, monsterId);
    if (monster === null) return;
    // Server rates (spec §59): exp_rate scales monster XP, drop_rate scales
    // loot chances — both are read from the cached gameplay-rates snapshot.
    const { expRate, dropRate } = getGameplayRates();
    const loot = rollLoot(monster.lootTable, dropRate);
    if (loot.length > 0) {
      if (this.deps.grantInventory !== undefined) {
        try {
          await this.deps.grantInventory(killerId, loot);
        } catch (err) {
          logger.warn("grantInventory failed (best-effort)", { killerId, error: String(err) });
        }
      }
      this.broadcast(zoneId, {
        type: "loot_received",
        sourceId: monsterId,
        items: loot,
      });
    }
    const xp = Math.round(monster.experienceReward * expRate);
    if (xp > 0 && this.deps.grantXp !== undefined) {
      try {
        await this.deps.grantXp(killerId, xp);
      } catch (err) {
        logger.warn("grantXp failed (best-effort)", {
          killerId,
          error: String(err),
        });
      }
    }
  }

  /** Apply a monster's hit to a player; handle defeat + respawn. */
  private applyMonsterAttack(
    zoneId: string,
    event: { monsterId: string; playerId: number; damage: number; crit: boolean },
    now: number,
  ): void {
    const player = this.zones.get(zoneId, event.playerId);
    if (player === null || !player.connected) return;
    if (player.invulnUntil > now) return;
    player.hp = Math.max(0, player.hp - event.damage);
    this.broadcast(zoneId, {
      type: "combat_event",
      instigatorId: event.monsterId,
      targetId: event.playerId,
      ability: "monster_attack",
      damage: event.damage,
      targetHp: player.hp,
      targetMaxHp: player.maxHp,
      outcome: player.hp <= 0 ? "defeated" : "hit",
      resourceCost: {},
    });
    if (player.hp <= 0) {
      this.defeatPlayer(zoneId, player, now);
    }
  }

  /**
   * Defeat = respawn at the safe hub with full HP + a short invuln window
   * (design/combat.md §3 — no item/XP loss). Persist HP best-effort.
   */
  private defeatPlayer(zoneId: string, player: ZonePlayer, now: number): void {
    const resetFragile = this.deps.resetFragileDeliveriesOnDefeat?.(player.characterId) ?? [];
    if (resetFragile.length > 0) {
      this.findSession(player.characterId)?.socket.send({
        type: "quest_notice",
        message: "The fragile parcel was damaged when you were defeated. Return to its sender to accept the route again.",
      });
    }
    const safeZone = DEFAULT_SAFE_ZONE;
    const zone = this.deps.getZoneData(safeZone);
    if (zone === null) {
      // No safe zone configured — revive in place with full HP + invuln.
      player.hp = player.maxHp;
      player.invulnUntil = now + DEFEAT_INVULN_MS;
      this.persistHp(player.characterId, player.hp, player.maxHp);
      return;
    }
    this.zones.leave(zoneId, player.characterId);
    player.hp = player.maxHp;
    player.invulnUntil = now + DEFEAT_INVULN_MS;
    // Respawn at the safe zone's default spawn (the map JSON's spawn tile).
    player.pos = { ...zone.spawn };
    this.zones.join(safeZone, player);
    // Keep the session's zone in sync so grace reconnect and chat target the
    // safe zone, not the zone the player was defeated in.
    const session = this.findSession(player.characterId);
    if (session !== null) session.zoneId = safeZone;
    void this.persist(player.characterId, safeZone, player.pos);
    this.persistHp(player.characterId, player.hp, player.maxHp);
    session?.socket.send({
      type: "player_respawned",
      zoneId: safeZone,
      pos: { ...player.pos },
      hp: player.hp,
      maxHp: player.maxHp,
    });
    this.broadcast(zoneId, { type: "player_left", characterId: player.characterId });
  }

  /** Move-interval (ms) that yields the given px/sec class speed. */
  private moveIntervalFor(speedPx: number): number {
    if (speedPx <= 0) return this.minMoveIntervalMs;
    return moveIntervalMsForSpeed(speedPx / 48);
  }

  /** Ask the world-brain for this zone's next monster moves (non-blocking). */
  private requestMonsterDecisions(zoneId: string, now: number): void {
    const brain = this.deps.monsterBrain;
    if (brain === undefined || brain === null) return;
    const monsters = this.monsters.monsters(zoneId);
    const zone = this.deps.getZoneData(zoneId);
    if (zone === null || monsters.length === 0) return;
    const scene: ZoneScene = {
      zoneId,
      width: zone.width,
      height: zone.height,
      monsters: monsters
        .filter((m) => m.alive)
        .map((m) => ({
          id: m.id,
          name: m.displayName,
          pos: { ...m.pos },
          hp: m.hp,
          maxHp: m.maxHp,
          aggro: m.aggroBehavior === "aggro",
        })),
      players: this.zones
        .players(zoneId)
        .filter((p) => p.connected)
        .map((p) => ({
          id: p.characterId,
          name: p.name,
          pos: { ...p.pos },
          hp: p.hp,
          maxHp: p.maxHp,
        })),
      isWalkable: zone.isWalkable,
    };
    brain.requestDecision(scene, now);
  }

  /** Players in a zone shaped for monster AI (connected + combat state). */
  private zonePlayers(zoneId: string): MonsterPlayer[] {
    const now = Date.now();
    return this.zones
      .players(zoneId)
      .filter((p) => p.connected)
      .map((p) => ({
        characterId: p.characterId,
        pos: { ...p.pos },
        hp: p.hp,
        maxHp: p.maxHp,
        defense: p.defense,
        invulnUntil: p.invulnUntil,
      }));
  }

  private persistHp(characterId: number, hp: number, maxHp: number): void {
    const persist = this.deps.persistHp;
    if (persist === undefined) return;
    persist(characterId, hp, maxHp).catch((err: unknown) => {
      logger.warn("persistHp failed (best-effort)", {
        characterId,
        error: String(err),
      });
    });
  }

  private requireAuth(session: Session): boolean {
    if (session.authenticated && session.characterId !== null) return true;
    this.sendError(session, "NOT_AUTHENTICATED", "authenticate before other messages");
    return false;
  }

  private startGrace(session: Session): void {
    const characterId = session.characterId;
    const zoneId = session.zoneId;
    if (characterId === null || zoneId === null) return;
    const player = this.zones.get(zoneId, characterId);
    if (player === null) return;
    player.connected = false;
    const timer = setTimeout(() => {
      this.graceTimers.delete(characterId);
      // Still disconnected? Remove and tell the zone.
      const still = this.zones.get(zoneId, characterId);
      if (still !== null && !still.connected) {
        this.zones.leave(zoneId, characterId);
        this.broadcast(zoneId, { type: "player_left", characterId });
        void this.persist(characterId, zoneId, still.pos);
      }
    }, this.graceMs);
    timer.unref?.();
    this.graceTimers.set(characterId, timer);
  }

  private clearGrace(characterId: number): void {
    const timer = this.graceTimers.get(characterId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.graceTimers.delete(characterId);
    }
  }

  private dropFromAllZones(characterId: number, keepZone: string): void {
    for (const zoneId of this.zones.zoneIds()) {
      if (zoneId === keepZone) continue;
      if (this.zones.get(zoneId, characterId) !== null) {
        this.removeFromZone(zoneId, characterId);
      }
    }
  }

  private removeFromZone(zoneId: string, characterId: number): void {
    const removed = this.zones.leave(zoneId, characterId);
    this.clearGrace(characterId);
    if (removed !== null) {
      this.broadcast(zoneId, { type: "player_left", characterId });
      void this.persist(characterId, zoneId, removed.pos);
    }
  }

  /** Best-effort position write; resolves false when the DB write failed. */
  private persist(
    characterId: number,
    zoneId: string,
    pos: { x: number; y: number },
  ): Promise<boolean> {
    const persist = this.deps.persistPosition;
    if (persist === undefined) return Promise.resolve(true);
    return persist(characterId, zoneId, pos)
      .then(() => true)
      .catch((err: unknown) => {
        logger.warn("persistPosition failed (best-effort)", {
          characterId,
          error: String(err),
        });
        return false;
      });
  }

  private broadcast(
    zoneId: string,
    payload: unknown,
    excludeCharacterId?: number,
  ): void {
    for (const player of this.zones.players(zoneId)) {
      if (!player.connected) continue;
      if (player.characterId === excludeCharacterId) continue;
      const session = this.findSession(player.characterId);
      session?.socket.send(payload);
    }
  }

  private findSession(characterId: number): Session | null {
    for (const session of this.sessions.values()) {
      if (session.characterId === characterId) return session;
    }
    return null;
  }

  /**
   * Expire any other live session bound to the same character so a stale
   * socket can never yank the reconnected player's zone state. The stale
   * session's grace window starts first (the player it held is marked
   * disconnected and will be restored or cleaned up by the fresh join), then
   * its identity is cleared so its late onClose becomes a no-op.
   */
  private expireDuplicateSessions(characterId: number, keep: Session): void {
    for (const [socket, session] of [...this.sessions]) {
      if (session === keep || session.characterId !== characterId) continue;
      this.startGrace(session);
      session.characterId = null;
      session.zoneId = null;
      session.authenticated = false;
      this.sessions.delete(socket);
      socket.close();
    }
  }

  private sendError(
    session: Session,
    code: string,
    message: string,
    requestType?: string,
  ): void {
    session.socket.send({ type: "error", code, message, requestType });
  }
}

function toText(raw: RawData | string): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw as ArrayBuffer).toString("utf8");
}

/** zone_state / monster_snapshot payload for a monster instance. */
function monsterSnapshot(m: {
  id: string;
  defKey: string;
  displayName: string;
  pos: { x: number; y: number };
  hp: number;
  maxHp: number;
  alive: boolean;
}): Record<string, unknown> {
  return {
    id: m.id,
    key: m.defKey,
    displayName: m.displayName,
    pos: { ...m.pos },
    hp: m.hp,
    maxHp: m.maxHp,
    alive: m.alive,
  };
}

/**
 * Roll a loot table deterministically-ish (design/monsters.md §6).
 * `dropRate` (server setting) scales each entry's chance, capped at 1 so a
 * 3× event weekend guarantees rather than multi-drops an entry.
 */
function rollLoot(
  lootTable: { key: string; chance: number; quantity: number }[],
  dropRate = 1,
): { itemKey: string; quantity: number }[] {
  return rollLootForTest(lootTable, dropRate);
}

/** Exported for tests: the deterministic loot-roll math. */
export function rollLootForTest(
  lootTable: { key: string; chance: number; quantity: number }[],
  dropRate = 1,
): { itemKey: string; quantity: number }[] {
  const out: { itemKey: string; quantity: number }[] = [];
  for (const entry of lootTable) {
    if (Math.random() < Math.min(1, Math.max(0, entry.chance) * dropRate)) {
      out.push({ itemKey: entry.key, quantity: Math.max(1, entry.quantity) });
    }
  }
  return out;
}
