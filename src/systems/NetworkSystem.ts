import Phaser from "phaser";
import {
  GameSocket,
  type NetCombatEvent,
  type NetMonsterInfo,
  type NetPlayerInfo,
  type NetPlayerPos,
  type NetRespawnInfo,
  type NetSnapshotMeta,
  type NetQuestSnapshot,
  type NetQuestInventoryItem,
  type NetInventoryState,
  type NetStatus,
} from "../net/GameSocket.ts";
import { RemotePlayer } from "../entities/RemotePlayer.ts";
import { Monster } from "../entities/Monster.ts";
import {
  type BootCharacter,
  pickCharacter,
  readBootCharacters,
  readSelectedCharacterId,
} from "../net/bootTarget.ts";
import { TILE_SIZE } from "../game/GameConfig.ts";
import type { MapPoint } from "../game/Maps.ts";
import { apiPath, getWsUrl } from "../config.ts";
import { classKeyFromId, classSpeedFromId, playAttackEffect } from "../game/classAssets.ts";
import {
  isNewerSnapshotSequence,
  isSnapshotForZone,
} from "../net/snapshotOrdering.ts";

/** Read the stored JWT (written by LoginOverlay / oidc-callback.html). */
function readToken(): string | null {
  try {
    return window.sessionStorage.getItem("paws.auth.token");
  } catch {
    return null;
  }
}

/** Pick the character to play — the player's stored choice, else the first. */
function pickPlayCharacter(): BootCharacter | null {
  return pickCharacter(readBootCharacters(), readSelectedCharacterId());
}

/** ws(s):// URL for the game server — configurable via VITE_GAME_SERVER_URL. */
function wsUrl(): string {
  return getWsUrl();
}

/**
 * Singleton network layer for the overworld. Owns the GameSocket and renders
 * other players' avatars and monsters into whichever Phaser scene is attached.
 * The scene calls `attach`, `start`, `joinZone`, `moveIntent`, `attack` and
 * `update` each frame.
 */
export class NetworkSystem {
  private static instance: NetworkSystem | null = null;

  static get(): NetworkSystem {
    if (NetworkSystem.instance === null) {
      NetworkSystem.instance = new NetworkSystem();
    }
    return NetworkSystem.instance;
  }

  /** Reset the singleton (tests only). */
  static resetForTests(): void {
    NetworkSystem.instance?.socket?.close();
    NetworkSystem.instance = null;
  }

  private socket: GameSocket | null = null;
  private scene: Phaser.Scene | null = null;
  private players = new Map<number, RemotePlayer>();
  private monsters = new Map<string, Monster>();
  private myCharacterId: number | null = null;
  private hpChip: HTMLElement | null = null;
  private myHp = 0;
  private myMaxHp = 0;
  /** Callback when the server confirms this courier has been defeated. */
  onPlayerDefeated: (() => void) | null = null;
  /** Callback for player defeat — the scene restarts at the safe hub. */
  onDefeat: ((info: NetRespawnInfo) => void) | null = null;
  /** Callback for loot toasts (client may render them). */
  onLoot: ((sourceId: string, items: { itemKey: string; quantity: number }[]) => void) | null = null;
  /** Scene-owned minimap receives the same authoritative connection status. */
  onStatus: ((status: NetStatus, detail?: string) => void) | null = null;
  /** Surface non-gameplay connection failures to the scene-owned HUD. */
  onError: ((code: string, message: string) => void) | null = null;
  onChatMessage: ((message: { characterId: number; name: string; text: string }) => void) | null = null;
  onNpcInteraction: ((npcId: string, quests: NetQuestSnapshot[]) => void) | null = null;
  onQuestState: ((quests: NetQuestSnapshot[]) => void) | null = null;
  onQuestUpdated: ((payload: { action: string; quest: NetQuestSnapshot; quests: NetQuestSnapshot[]; inventory: NetQuestInventoryItem[]; stamps: number; xp: number; message: string }) => void) | null = null;
  onQuestNotice: ((message: string) => void) | null = null;
  onInventoryUpdated: ((items: NetQuestInventoryItem[], stamps: number, state?: NetInventoryState) => void) | null = null;
  /** Called only after the server confirms this courier's attack hit a monster. */
  onAttackConfirmed: (() => void) | null = null;
  /** Server-authoritative tile for this courier (from zone_state) — scene snaps to it. */
  onSelfPosition: ((tile: { x: number; y: number }) => void) | null = null;
  private currentStatus: NetStatus = "idle";
  private currentStatusDetail: string | undefined;
  private currentZoneId: string | null = null;
  private expectedZoneId: string | null = null;
  private latestZoneState: {
    zoneId: string;
    players: NetPlayerInfo[];
    monsters: NetMonsterInfo[];
  } | null = null;
  /** Latest authoritative player list, retained across brief scene gaps. */
  private latestPlayers: { zoneId: string; players: NetPlayerInfo[] } | null = null;
  private latestSnapshotSequence = new Map<string, number>();
  /** Authoritative tile for this courier from the latest zone_state. */
  private selfPosition: { x: number; y: number } | null = null;

  private constructor() {
    this.ensureHpChip();
  }

  /** Bind to the current scene (call from scene.create). */
  attach(scene: Phaser.Scene, zoneId?: string): void {
    if (zoneId !== undefined) this.expectedZoneId = zoneId;
    this.destroyEntities();
    this.scene = scene;
    // The socket can now be started before Phaser finishes loading art. If the
    // server answered during the preloader, replay that authoritative snapshot
    // into the newly attached scene instead of losing the initial world state.
    if (
      this.latestZoneState !== null &&
      (zoneId === undefined || this.latestZoneState.zoneId === zoneId)
    ) {
      this.handleZoneState(
        this.latestZoneState.zoneId,
        this.latestZoneState.players,
        this.latestZoneState.monsters,
      );
    } else if (
      this.latestPlayers !== null &&
      (zoneId === undefined || this.latestPlayers.zoneId === zoneId)
    ) {
      this.currentZoneId = this.latestPlayers.zoneId;
      this.reconcilePlayers(this.latestPlayers.zoneId, this.latestPlayers.players, Date.now());
    }
  }

  /**
   * Begin the session: fetch a ws-token, connect, and join the given zone.
   * Safe to call again after a scene restart — only re-joins the zone.
   */
  start(zoneId: string, characterId: number): void {
    this.expectedZoneId = zoneId;
    if (this.socket === null) {
      this.socket = this.buildSocket(characterId);
      void this.socket.connect();
    }
    this.socket.joinZone(zoneId);
  }

  /** Switch zones (scene transition). */
  joinZone(zoneId: string): void {
    this.expectedZoneId = zoneId;
    this.latestZoneState = null;
    this.latestPlayers = null;
    this.selfPosition = null;
    this.latestSnapshotSequence.clear();
    this.currentZoneId = null;
    this.socket?.joinZone(zoneId);
  }

  /** Send a move intent for the current input vector (throttled by socket). */
  moveIntent(dx: number, dy: number): void {
    this.socket?.moveIntent(dx, dy);
  }

  /** Send an NPC interaction intent through the authenticated socket. */
  interact(targetId: string): void {
    this.socket?.interact(targetId);
  }

  /** Accept a quest offered by an NPC. */
  acceptQuest(questId: string): void {
    this.socket?.acceptQuest(questId);
  }

  /** Search an authored quest objective at a map object. */
  searchQuest(objectId: string): void {
    this.socket?.searchQuest(objectId);
  }

  /** Move an owned inventory item through the authoritative server. */
  moveInventoryItem(itemInstanceId: number, targetSlot: number): void {
    this.socket?.moveInventoryItem(itemInstanceId, targetSlot);
  }

  /** Equip an owned JSON-defined gear item. */
  equipItem(itemInstanceId: number, slot?: string): void {
    this.socket?.equipItem(itemInstanceId, slot);
  }

  /** Unequip a gear slot. */
  unequipItem(slot: string): void {
    this.socket?.unequipItem(slot);
  }

  /** Request the complete server inventory snapshot. */
  requestInventory(): void {
    this.socket?.requestInventory();
  }

  /** Send a same-zone chat message through the authenticated socket. */
  chat(text: string): void {
    this.socket?.chat(text);
  }

  getCharacterId(): number | null {
    return this.myCharacterId;
  }

  /** Server-confirmed identity and zone for production multiplayer diagnostics. */
  getSessionInfo(): { characterId: number | null; zoneId: string | null } {
    return { characterId: this.myCharacterId, zoneId: this.currentZoneId };
  }

  /** Authoritative tile for this courier from the latest zone_state (join restore). */
  getSelfPosition(): { x: number; y: number } | null {
    return this.selfPosition;
  }

  /** Attack the monster with the given instance id (server validates all). */
  attack(monsterId: string): void {
    this.socket?.attack(monsterId);
  }

  /**
   * Attack the closest alive monster within `range` tiles of a tile position.
   * Returns the targeted monster id, or null when none is in range.
   */
  attackNearest(fromTile: MapPoint, rangeTiles: number): string | null {
    let best: { id: string; dist: number } | null = null;
    for (const monster of this.monsters.values()) {
      if (!monster.visible) continue;
      const mx = Math.floor(monster.x / TILE_SIZE);
      const my = Math.floor(monster.y / TILE_SIZE);
      const dist = Math.max(Math.abs(fromTile.x - mx), Math.abs(fromTile.y - my));
      if (dist > rangeTiles) continue;
      if (best === null || dist < best.dist) best = { id: monster.id, dist };
    }
    if (best !== null) this.attack(best.id);
    return best?.id ?? null;
  }

  /** Per-frame: interpolate remote players and monsters toward targets. */
  update(): void {
    for (const player of this.players.values()) player.update();
    for (const monster of this.monsters.values()) monster.update();
  }

  /** Return the latest connection state so newly-created HUD can catch up. */
  getStatus(): { status: NetStatus; detail?: string } {
    return { status: this.currentStatus, detail: this.currentStatusDetail };
  }

  /** Render metadata for remote couriers and monsters (visual review only). */
  getVisualEntities(): {
    id: string;
    kind: "player" | "monster";
    x: number;
    y: number;
    scale: number;
    depth: number;
    asset: string;
  }[] {
    const out: {
      id: string;
      kind: "player" | "monster";
      x: number;
      y: number;
      scale: number;
      depth: number;
      asset: string;
    }[] = [];
    for (const player of this.players.values()) {
      if (!player.visible) continue;
      out.push({
        id: `remote-player-${player.characterId}`,
        kind: "player",
        x: player.x / TILE_SIZE,
        y: player.y / TILE_SIZE,
        scale: player.scale,
        depth: player.depth,
        asset: player.classKey,
      });
    }
    for (const monster of this.monsters.values()) {
      if (!monster.visible) continue;
      out.push({
        id: monster.id,
        kind: "monster",
        x: monster.x / TILE_SIZE,
        y: monster.y / TILE_SIZE,
        scale: monster.scale,
        depth: monster.depth,
        asset: monster.defKey,
      });
    }
    return out;
  }

  /** Tile-space positions of other couriers (for the minimap overlay). */
  getRemotePositions(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const player of this.players.values()) {
      out.push({ x: player.x / TILE_SIZE, y: player.y / TILE_SIZE });
    }
    return out;
  }

  /** Tile-space positions of alive monsters (for the minimap overlay). */
  getMonsterPositions(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const monster of this.monsters.values()) {
      if (!monster.visible) continue;
      out.push({ x: monster.x / TILE_SIZE, y: monster.y / TILE_SIZE });
    }
    return out;
  }

  /** Forget the scene and its remote entities (scene shutdown). */
  detach(): void {
    this.destroyEntities();
    this.scene = null;
    this.currentZoneId = null;
    this.latestZoneState = null;
    // Keep the requested zone so late snapshots from the previous scene are rejected.
    // Keep latestPlayers across a scene restart: the socket can receive a
    // snapshot while Phaser is between scenes, and attach() will replay it.
    this.onPlayerDefeated = null;
    this.onDefeat = null;
    this.onStatus = null;
    // Keep the app-level diagnostic handler alive across scene restarts. The
    // socket singleton survives zone transitions, so clearing this callback
    // would make later token/reconnect failures invisible again.
    this.onAttackConfirmed = null;
    this.onChatMessage = null;
    this.onNpcInteraction = null;
    this.onQuestState = null;
    this.onQuestUpdated = null;
    this.onQuestNotice = null;
    this.onInventoryUpdated = null;
    this.onSelfPosition = null;
    this.selfPosition = null;
  }

  /** Close the socket for good (logout / page teardown). */
  shutdown(): void {
    this.socket?.close();
    this.socket = null;
    this.currentZoneId = null;
    this.latestZoneState = null;
    this.latestPlayers = null;
    this.selfPosition = null;
    this.latestSnapshotSequence.clear();
    this.expectedZoneId = null;
    this.destroyEntities();
    this.hpChip?.remove();
    this.hpChip = null;
  }

  /**
   * Move-intent throttle (ms) matching the server's per-class speed cap.
   * The server accepts one move per `1000/(speed/48)` ms; emitting intents
   * any faster just gets them rejected and lets the server position drift
   * behind the rendered courier (breaking NPC interact/quest range checks).
   */
  private moveIntervalMsFor(characterId: number): number {
    const characters = readBootCharacters() ?? [];
    const character = characters.find((c) => c.id === characterId);
    const speed = classSpeedFromId(character?.class_id ?? 1);
    return Math.max(50, Math.round(48000 / speed));
  }

  private buildSocket(characterId: number): GameSocket {
    // Prefer the authenticated boot selection over any stale tab selection.
    // This prevents account A from accidentally requesting a token for
    // account B's character after two tabs have been used.
    this.myCharacterId = characterId;
    const socket = new GameSocket({
      wsUrl: wsUrl(),
      tokenUrl: apiPath("/api/ws-token"),
      getToken: readToken,
      getCharacterId: () => this.myCharacterId,
      moveIntervalMs: this.moveIntervalMsFor(characterId),
    });
    socket.callbacks.onStatus = (status, detail) => {
      this.currentStatus = status;
      this.currentStatusDetail = detail;
      this.onStatus?.(status, detail);
    };
    socket.callbacks.onAuthenticated = (info) => {
      // Never rely only on localStorage/sessionStorage character selection:
      // the server's authenticated payload is authoritative.
      this.myCharacterId = info.characterId;
      if (info.hp !== undefined && info.maxHp !== undefined) {
        this.setPlayerHp(info.hp, info.maxHp);
      }
    };
    socket.callbacks.onZoneState = (zoneId, players, monsters) =>
      this.handleZoneState(zoneId, players, monsters);
    socket.callbacks.onPlayerJoined = (player) => this.spawnPlayer(player, false);
    socket.callbacks.onPlayerLeft = (characterId) => this.removePlayer(characterId);
    socket.callbacks.onSnapshot = (players, zoneId, meta) =>
      this.handleSnapshot(players, zoneId, meta);
    socket.callbacks.onMonsterSnapshot = (monsters) =>
      this.handleMonsterSnapshot(monsters);
    socket.callbacks.onChatMessage = (message) => this.onChatMessage?.(message);
    socket.callbacks.onNpcInteraction = (npcId, quests) => this.onNpcInteraction?.(npcId, quests);
    socket.callbacks.onQuestState = (quests) => this.onQuestState?.(quests);
    socket.callbacks.onQuestUpdated = (payload) => this.onQuestUpdated?.(payload);
    socket.callbacks.onQuestNotice = (message) => this.onQuestNotice?.(message);
    socket.callbacks.onInventoryUpdated = (items, stamps, state) => this.onInventoryUpdated?.(items, stamps, state);
    socket.callbacks.onCombatEvent = (event) => this.handleCombatEvent(event);
    socket.callbacks.onRespawn = (info) => this.handleRespawn(info);
    socket.callbacks.onLoot = (sourceId, items) => this.onLoot?.(sourceId, items);
    socket.callbacks.onError = (code, message) => {
      // Collision/range rejections are normal gameplay feedback — stay quiet.
      if (
        code !== "MOVE_COLLISION" &&
        code !== "MOVE_TELEPORT_DETECTED" &&
        code !== "OUT_OF_RANGE" &&
        code !== "COOLDOWN_ACTIVE"
      ) {
        console.warn(`[net] ${code}: ${message}`);
        this.onError?.(code, message);
      }
    };
    return socket;
  }

  private handleZoneState(
    zoneId: string,
    players: NetPlayerInfo[],
    monsters: NetMonsterInfo[],
  ): void {
    if (!isSnapshotForZone(zoneId, this.expectedZoneId)) return;
    this.latestZoneState = {
      zoneId,
      players: players.map((player) => ({ ...player, pos: { ...player.pos } })),
      monsters: monsters.map((monster) => ({ ...monster, pos: { ...monster.pos } })),
    };
    this.latestPlayers = {
      zoneId,
      players: players.map((player) => ({ ...player, pos: { ...player.pos } })),
    };
    this.latestSnapshotSequence.delete(zoneId);
    this.destroyEntities();
    for (const p of players) {
      if (p.characterId === this.myCharacterId) {
        this.selfPosition = { ...p.pos };
        this.onSelfPosition?.({ ...p.pos });
        continue;
      }
      this.spawnPlayer(p, true);
    }
    this.monsters.clear();
    for (const m of monsters) this.spawnMonster(m, true);
    this.currentZoneId = zoneId;
    this.publishStatus(
      "joined",
      `${this.players.size} courier${this.players.size === 1 ? "" : "s"} nearby`,
    );
  }

  private publishStatus(status: NetStatus, detail?: string): void {
    this.currentStatus = status;
    this.currentStatusDetail = detail;
    this.onStatus?.(status, detail);
  }

  private handleSnapshot(
    players: NetPlayerPos[],
    zoneId?: string,
    meta?: NetSnapshotMeta,
  ): void {
    const activeZone = zoneId ?? this.currentZoneId;
    if (!isSnapshotForZone(zoneId, this.expectedZoneId)) return;
    if (zoneId !== undefined && this.currentZoneId !== null && zoneId !== this.currentZoneId) return;
    if (activeZone !== null) {
      const sequence = meta?.sequence ?? 0;
      const previousSequence = this.latestSnapshotSequence.get(activeZone) ?? 0;
      if (!isNewerSnapshotSequence(sequence, previousSequence)) return;
      if (sequence > 0) this.latestSnapshotSequence.set(activeZone, sequence);
      const sampleAt = meta?.receivedAt ?? Date.now();
      this.latestPlayers = {
        zoneId: activeZone,
        players: players.map((player) => ({
          characterId: player.characterId,
          name: player.name ?? "Courier",
          classKey: player.classKey ?? "bear-warrior",
          pos: { ...player.pos },
        })),
      };
      if (this.scene === null) return;
      this.reconcilePlayers(activeZone, players, sampleAt);
    }
  }

  /** Reconcile the live player set from an authoritative snapshot. */
  private reconcilePlayers(
    zoneId: string | null,
    players: NetPlayerPos[],
    sampleAt = Date.now(),
  ): void {
    if (this.scene === null || (zoneId !== null && zoneId !== this.currentZoneId && this.currentZoneId !== null)) return;
    const present = new Set<number>();
    for (const p of players) {
      if (p.characterId === this.myCharacterId) continue;
      present.add(p.characterId);
      let remote = this.players.get(p.characterId);
      if (remote === undefined) {
        // Snapshots include identity metadata, so they can heal a missed
        // player_joined frame without requiring a refresh.
        remote = this.spawnPlayer(
          {
            characterId: p.characterId,
            name: p.name ?? "Courier",
            classKey: p.classKey ?? "bear-warrior",
            pos: p.pos,
          },
          true,
        );
      }
      remote?.setTarget(p.pos, sampleAt);
    }
    // Also heal a missed player_left frame: the authoritative set is exact.
    for (const characterId of this.players.keys()) {
      if (!present.has(characterId)) this.removePlayer(characterId);
    }
  }

  private handleMonsterSnapshot(monsters: NetMonsterInfo[]): void {
    for (const m of monsters) {
      const monster = this.monsters.get(m.id);
      if (monster === undefined) continue; // not yet in zone_state — ignore
      if (!m.alive) {
        monster.setVisible(false);
        continue;
      }
      monster.setVisible(true);
      monster.setTarget(m.pos);
      monster.setHp(m.hp);
    }
  }

  private handleCombatEvent(event: NetCombatEvent): void {
    // Monster was hit (instigator is a player id, target is a monster id).
    const monster = this.monsters.get(event.targetId);
    if (monster !== undefined) {
      const instigator = Number(event.instigatorId);
      if (instigator === this.myCharacterId) this.onAttackConfirmed?.();
      const classKey =
        instigator === this.myCharacterId
          ? classKeyFromId(pickPlayCharacter()?.class_id ?? 1)
          : this.players.get(instigator)?.classKey;
      if (classKey !== undefined && this.scene !== null) {
        playAttackEffect(this.scene, classKey, monster.x, monster.y);
      }
      monster.setHp(event.targetHp);
      this.showDamageNumber(monster.x, monster.y - 24, event.damage, event.outcome);
      if (event.outcome === "defeated") monster.setVisible(false);
      return;
    }
    // Player was hit — update the HUD HP chip.
    if (Number(event.targetId) === this.myCharacterId) {
      this.myHp = event.targetHp;
      this.renderHp();
      if (event.outcome === "defeated") {
        this.myHp = 0;
        this.onPlayerDefeated?.();
      }
    }
  }

  private handleRespawn(info: NetRespawnInfo): void {
    this.myHp = info.hp;
    this.myMaxHp = info.maxHp;
    this.renderHp();
    this.onDefeat?.(info);
  }

  private spawnPlayer(info: NetPlayerInfo, snap: boolean): RemotePlayer | undefined {
    if (this.scene === null) return undefined;
    const existing = this.players.get(info.characterId);
    if (existing !== undefined) return existing;
    const remote = new RemotePlayer(this.scene, info);
    if (snap) remote.snapTo(info.pos);
    this.players.set(info.characterId, remote);
    return remote;
  }

  private removePlayer(characterId: number): void {
    const remote = this.players.get(characterId);
    if (remote === undefined) return;
    remote.destroy();
    this.players.delete(characterId);
  }

  private spawnMonster(info: NetMonsterInfo, snap: boolean): void {
    if (this.scene === null) return;
    if (this.monsters.has(info.id)) return;
    const monster = new Monster(this.scene, info);
    if (snap) monster.snapTo(info.pos);
    if (!info.alive) monster.setVisible(false);
    this.monsters.set(info.id, monster);
  }

  private destroyEntities(): void {
    for (const player of this.players.values()) player.destroy();
    for (const monster of this.monsters.values()) monster.destroy();
    this.players.clear();
    this.monsters.clear();
  }

  /** Floating damage number over a monster (tiny tween, then removed). */
  private showDamageNumber(
    x: number,
    y: number,
    damage: number,
    outcome: NetCombatEvent["outcome"],
  ): void {
    if (this.scene === null) return;
    const color =
      outcome === "crit" ? "#e0c040" : outcome === "defeated" ? "#d05050" : "#ffffff";
    const label = outcome === "crit" ? `${damage}!` : String(damage);
    const text = this.scene.add
      .text(x, y, label, {
        fontFamily: "Georgia, serif",
        fontSize: outcome === "crit" ? "18px" : "15px",
        color,
        stroke: "#2b2b2b",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.scene.tweens.add({
      targets: text,
      y: y - 26,
      alpha: 0,
      duration: 700,
      ease: "Quad.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  // --- DOM HUD (status chip + player HP bar) ---

  private ensureHpChip(): void {
    if (this.hpChip !== null) return;
    const chip = document.createElement("div");
    chip.id = "player-hp";
    chip.className = "player-hp";
    const label = document.createElement("span");
    label.className = "player-hp-label";
    label.textContent = "HP";
    const fill = document.createElement("div");
    fill.className = "player-hp-fill";
    const text = document.createElement("span");
    text.className = "player-hp-text";
    text.textContent = "–";
    chip.append(label, fill, text);
    document.getElementById("game-container")?.appendChild(chip);
    this.hpChip = chip;
  }

  /** Set the player's HP (from the server on join / defeat). */
  setPlayerHp(hp: number, maxHp: number): void {
    this.myHp = hp;
    this.myMaxHp = maxHp;
    this.renderHp();
  }

  private renderHp(): void {
    if (this.hpChip === null) return;
    const fill = this.hpChip.querySelector(".player-hp-fill");
    const text = this.hpChip.querySelector(".player-hp-text");
    const ratio = this.myMaxHp > 0 ? this.myHp / this.myMaxHp : 0;
    if (fill instanceof HTMLElement) {
      fill.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
    }
    if (text) text.textContent = `${this.myHp} / ${this.myMaxHp}`;
  }

}
