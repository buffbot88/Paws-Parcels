import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server } from "node:http";
import { consumeWsToken } from "./tokenStore.ts";
import { ZoneStore, type ZonePlayer } from "./zoneStore.ts";
import { validateMoveIntent, moveIntervalMsForSpeed } from "./movement.ts";
import { MonsterStore, type MonsterPlayer } from "./monsterStore.ts";
import { classCombatProfile, computeDamage, tileDistance, validateAttack } from "./combat.ts";
import type { MonsterDefinitionRow } from "../models/Monster.ts";
import type { ZoneData } from "./zoneData.ts";
import { logger } from "../middleware/logger.ts";

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
  /** Monster templates for a zone (DB); defaults to [] so safe zones stay empty. */
  getMonsterDefinitions?: (zoneKey: string) => Promise<MonsterDefinitionRow[]>;
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
  private monsters = new MonsterStore();
  private sessions = new Map<SocketLike, Session>();
  private tickTimer: NodeJS.Timeout | null = null;
  private graceTimers = new Map<number, NodeJS.Timeout>();
  private tickMs: number;
  private graceMs: number;
  private minMoveIntervalMs: number;
  private persistIntervalMs: number;

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
      lastMoveAt: 0,
    });
  }

  /** Public for tests: run one snapshot tick. */
  runTick(): void {
    const now = Date.now();
    for (const zoneId of this.zones.zoneIds()) {
      const players = this.zones.snapshot(zoneId);
      if (players.length === 0) continue;
      this.broadcast(zoneId, { type: "player_snapshot", players });
      this.tickMonsters(zoneId, now);
      // Best-effort periodic persistence: a moving player's position is
      // flushed at most once per interval (and immediately on leave/grace).
      for (const player of this.zones.players(zoneId)) {
        if (!player.connected || !player.dirty) continue;
        if (now - player.lastPersistAt < this.persistIntervalMs) continue;
        this.persist(player.characterId, zoneId, player.pos);
        player.dirty = false;
        player.lastPersistAt = now;
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
    await this.seedZoneMonsters(zoneId);
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
      const now = Date.now();
      const player: ZonePlayer = {
        characterId,
        accountId: session.accountId as number,
        name: character.name,
        classKey: character.classKey,
        pos: { ...character.pos },
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

  private handleAttack(session: Session, msg: Record<string, unknown>): void {
    if (!this.requireAuth(session)) return;
    const characterId = session.characterId as number;
    const zoneId = session.zoneId;
    if (zoneId === null) {
      this.sendError(session, "NOT_IN_ZONE", "join_zone before attack");
      return;
    }
    const player = this.zones.get(zoneId, characterId);
    if (player === null || !player.connected) {
      this.sendError(session, "NOT_IN_ZONE", "Character is not in this zone");
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
    // Loot roll (design/monsters.md §6) — broadcast so the killer sees it;
    // actual inventory grants land with Phase 5.
    const loot = rollLoot(monster.lootTable);
    if (loot.length > 0) {
      this.broadcast(zoneId, {
        type: "loot_received",
        sourceId: monsterId,
        items: loot,
      });
    }
    const xp = monster.experienceReward;
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
    // Respawn at the safe zone's default spawn (clover-village.json spawn).
    player.pos = { x: 15, y: 13 };
    this.zones.join(safeZone, player);
    this.persist(player.characterId, safeZone, player.pos);
    this.persistHp(player.characterId, player.hp, player.maxHp);
    const session = this.findSession(player.characterId);
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

/** Roll a loot table deterministically-ish (design/monsters.md §6). */
function rollLoot(
  lootTable: { key: string; chance: number; quantity: number }[],
): { itemKey: string; quantity: number }[] {
  const out: { itemKey: string; quantity: number }[] = [];
  for (const entry of lootTable) {
    if (Math.random() < entry.chance) {
      out.push({ itemKey: entry.key, quantity: Math.max(1, entry.quantity) });
    }
  }
  return out;
}
