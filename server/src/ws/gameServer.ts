import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server } from "node:http";
import { consumeWsToken } from "./tokenStore.ts";
import { ZoneStore, type ZonePlayer } from "./zoneStore.ts";
import { validateMoveIntent, moveIntervalMsForSpeed } from "./movement.ts";
import type { ZoneData } from "./zoneData.ts";
import { logger } from "../middleware/logger.ts";

/** Defaults from design/architecture.md §5/§7 (180 px/s over 48px tiles). */
const DEFAULT_TICK_MS = 50; // 20 Hz
const DEFAULT_GRACE_MS = 60_000;
const DEFAULT_TILES_PER_SEC = 180 / 48;

/** A character as loaded for a WS session (name/class/position). */
export interface CharacterSession {
  characterId: number;
  accountId: number;
  name: string;
  classKey: string;
  zoneId: string;
  pos: { x: number; y: number };
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
  tickMs?: number;
  graceMs?: number;
  tilesPerSecond?: number;
}

interface Session {
  socket: SocketLike;
  accountId: number | null;
  characterId: number | null;
  zoneId: string | null;
  authenticated: boolean;
  lastMoveAt: number;
}

/**
 * Server-authoritative WebSocket game server (Phase 2 — Multiplayer Village).
 * Client sends intents; the server validates and broadcasts authoritative
 * state. Message shapes follow design/network-protocol.md.
 */
export class GameServer {
  private wss: WebSocketServer | null = null;
  private zones = new ZoneStore();
  private sessions = new Map<SocketLike, Session>();
  private tickTimer: NodeJS.Timeout | null = null;
  private graceTimers = new Map<number, NodeJS.Timeout>();
  private tickMs: number;
  private graceMs: number;
  private minMoveIntervalMs: number;

  constructor(private deps: GameServerDeps) {
    this.tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
    this.graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
    this.minMoveIntervalMs = moveIntervalMsForSpeed(
      deps.tilesPerSecond ?? DEFAULT_TILES_PER_SEC,
    );
  }

  /** Attach to an HTTP server and start the snapshot tick. */
  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (socket: WebSocket) => this.wireSocket(socket));
    this.tickTimer = setInterval(() => this.runTick(), this.tickMs);
    this.tickTimer.unref?.();
    logger.info("WebSocket game server attached", { path: "/ws" });
  }

  /** Stop the tick loop and timers (graceful shutdown / tests). */
  close(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.wss?.close();
    this.wss = null;
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
    this.sessions.set(socket, {
      socket,
      accountId: null,
      characterId: null,
      zoneId: null,
      authenticated: false,
      lastMoveAt: 0,
    });
    ws.on("message", (raw: RawData) => this.onMessage(socket, raw));
    ws.on("close", () => this.onClose(socket));
  }

  /** Public for tests: run one snapshot tick. */
  runTick(): void {
    for (const zoneId of this.zones.zoneIds()) {
      const players = this.zones.snapshot(zoneId);
      if (players.length === 0) continue;
      this.broadcast(zoneId, { type: "player_snapshot", players });
    }
  }

  /** Public for tests: feed a raw message from a socket. */
  onMessage(socket: SocketLike, raw: RawData | string): void {
    const session = this.sessions.get(socket);
    if (session === undefined) return;
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
    void this.route(session, type, msg as Record<string, unknown>);
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
      this.sendError(session, "INVALID_TOKEN", "WS token is invalid, expired, or already used");
      return;
    }
    const character = await this.deps.loadCharacter(identity.characterId);
    if (character === null || character.accountId !== identity.accountId) {
      this.sendError(session, "INVALID_TOKEN", "Character no longer exists for this account");
      return;
    }
    session.accountId = character.accountId;
    session.characterId = character.characterId;
    session.zoneId = character.zoneId;
    session.authenticated = true;
    session.socket.send({
      type: "authenticated",
      accountId: character.accountId,
      characterId: character.characterId,
      zoneId: character.zoneId,
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
      this.sendError(session, "ZONE_NOT_FOUND", `Unknown zone "${zoneId}"`);
      return;
    }

    // Reconnect within the grace window: the character may still be tracked
    // in another zone — drop them there first (broadcasts player_left).
    this.dropFromAllZones(characterId, zoneId);

    const character = await this.deps.loadCharacter(characterId);
    if (character === null) {
      this.sendError(session, "INVALID_TOKEN", "Character no longer exists");
      return;
    }
    const existing = this.zones.get(zoneId, characterId);
    if (existing !== null) {
      // Grace restore: reuse the server-authoritative position.
      existing.connected = true;
      existing.name = character.name;
      existing.classKey = character.classKey;
    } else {
      const player: ZonePlayer = {
        characterId,
        accountId: session.accountId as number,
        name: character.name,
        classKey: character.classKey,
        pos: { ...character.pos },
        connected: true,
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
      monsters: [],
      npcs: [],
      objects: [],
    });
  }

  private handleMoveIntent(
    session: Session,
    msg: Record<string, unknown>,
  ): void {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId as number;
    const zoneId = session.zoneId;
    if (zoneId === null) {
      this.sendError(session, "NOT_IN_ZONE", "join_zone before move_intent");
      return;
    }
    const player = this.zones.get(zoneId, characterId);
    if (player === null || !player.connected) {
      this.sendError(session, "NOT_IN_ZONE", "Character is not in this zone");
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
      lastMoveAt: player.lastMoveAt ?? session.lastMoveAt,
      now: Date.now(),
      minMoveIntervalMs: this.minMoveIntervalMs,
    });
    if (!verdict.ok) {
      this.sendError(session, verdict.code, "Move intent rejected", "move_intent");
      return;
    }
    player.pos = verdict.to;
    player.lastMoveAt = Date.now();
    session.lastMoveAt = Date.now();
    // No direct reply — the tick broadcasts the authoritative snapshot.
  }

  private handleLeaveZone(session: Session): void {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId as number;
    const zoneId = session.zoneId;
    session.zoneId = null;
    if (zoneId === null) return;
    this.removeFromZone(zoneId, characterId);
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
        this.persist(characterId, zoneId, still.pos);
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
      this.persist(characterId, zoneId, removed.pos);
    }
  }

  private persist(
    characterId: number,
    zoneId: string,
    pos: { x: number; y: number },
  ): void {
    const persist = this.deps.persistPosition;
    if (persist === undefined) return;
    persist(characterId, zoneId, pos).catch((err: unknown) => {
      logger.warn("persistPosition failed (best-effort)", {
        characterId,
        error: String(err),
      });
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
