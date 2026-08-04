import Phaser from "phaser";
import {
  GameSocket,
  type NetCombatEvent,
  type NetMonsterInfo,
  type NetPlayerInfo,
  type NetPlayerPos,
  type NetRespawnInfo,
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

/** Read the stored JWT (written by LoginOverlay / oidc-callback.html). */
function readToken(): string | null {
  try {
    return window.localStorage.getItem("paws.auth.token");
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
  private statusChip: HTMLElement | null = null;
  private hpChip: HTMLElement | null = null;
  private myHp = 0;
  private myMaxHp = 0;
  /** Callback for player defeat — the scene restarts at the safe hub. */
  onDefeat: ((info: NetRespawnInfo) => void) | null = null;
  /** Callback for loot toasts (client may render them). */
  onLoot: ((sourceId: string, items: { itemKey: string; quantity: number }[]) => void) | null = null;

  private constructor() {
    this.ensureStatusChip();
    this.ensureHpChip();
  }

  /** Bind to the current scene (call from scene.create). */
  attach(scene: Phaser.Scene): void {
    this.scene = scene;
    // Old scene's game objects are destroyed; clear the registry.
    this.players.clear();
    this.monsters.clear();
  }

  /**
   * Begin the session: fetch a ws-token, connect, and join the given zone.
   * Safe to call again after a scene restart — only re-joins the zone.
   */
  start(zoneId: string): void {
    if (this.socket === null) {
      this.socket = this.buildSocket();
      void this.socket.connect();
    }
    this.socket.joinZone(zoneId);
  }

  /** Switch zones (scene transition). */
  joinZone(zoneId: string): void {
    this.socket?.joinZone(zoneId);
  }

  /** Send a move intent for the current input vector (throttled by socket). */
  moveIntent(dx: number, dy: number): void {
    this.socket?.moveIntent(dx, dy);
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

  /** Forget the scene and its remote entities (scene shutdown). */
  detach(): void {
    this.scene = null;
    this.players.clear();
    this.monsters.clear();
  }

  /** Close the socket for good (logout / page teardown). */
  shutdown(): void {
    this.socket?.close();
    this.socket = null;
    this.players.clear();
    this.monsters.clear();
    this.statusChip?.remove();
    this.statusChip = null;
    this.hpChip?.remove();
    this.hpChip = null;
  }

  private buildSocket(): GameSocket {
    const character = pickPlayCharacter();
    this.myCharacterId = character?.id ?? null;
    const socket = new GameSocket({
      wsUrl: wsUrl(),
      tokenUrl: apiPath("/api/ws-token"),
      getToken: readToken,
      getCharacterId: () => pickPlayCharacter()?.id ?? null,
    });
    socket.callbacks.onStatus = (status, detail) => this.setChip(status, detail);
    socket.callbacks.onAuthenticated = (info) => {
      if (info.hp !== undefined && info.maxHp !== undefined) {
        this.setPlayerHp(info.hp, info.maxHp);
      }
    };
    socket.callbacks.onZoneState = (zoneId, players, monsters) =>
      this.handleZoneState(zoneId, players, monsters);
    socket.callbacks.onPlayerJoined = (player) => this.spawnPlayer(player, false);
    socket.callbacks.onPlayerLeft = (characterId) => this.removePlayer(characterId);
    socket.callbacks.onSnapshot = (players) => this.handleSnapshot(players);
    socket.callbacks.onMonsterSnapshot = (monsters) =>
      this.handleMonsterSnapshot(monsters);
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
      }
    };
    return socket;
  }

  private handleZoneState(
    zoneId: string,
    players: NetPlayerInfo[],
    monsters: NetMonsterInfo[],
  ): void {
    this.players.clear();
    for (const p of players) {
      if (p.characterId === this.myCharacterId) continue;
      this.spawnPlayer(p, true);
    }
    this.monsters.clear();
    for (const m of monsters) this.spawnMonster(m, true);
    this.setChip("joined", `${this.players.size} courier${this.players.size === 1 ? "" : "s"} nearby`);
  }

  private handleSnapshot(players: NetPlayerPos[]): void {
    for (const p of players) {
      if (p.characterId === this.myCharacterId) continue;
      const remote = this.players.get(p.characterId);
      if (remote === undefined) continue; // not yet in zone_state — ignore
      remote.setTarget(p.pos);
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
      monster.setHp(event.targetHp);
      this.showDamageNumber(monster.x, monster.y - 24, event.damage, event.outcome);
      if (event.outcome === "defeated") monster.setVisible(false);
      return;
    }
    // Player was hit — update the HUD HP chip.
    if (Number(event.targetId) === this.myCharacterId) {
      this.myHp = event.targetHp;
      this.renderHp();
      if (event.outcome === "defeated") this.myHp = 0;
    }
  }

  private handleRespawn(info: NetRespawnInfo): void {
    this.myHp = info.hp;
    this.myMaxHp = info.maxHp;
    this.renderHp();
    this.onDefeat?.(info);
  }

  private spawnPlayer(info: NetPlayerInfo, snap: boolean): void {
    if (this.scene === null) return;
    if (this.players.has(info.characterId)) return;
    const remote = new RemotePlayer(this.scene, info);
    if (snap) remote.snapTo(info.pos);
    this.players.set(info.characterId, remote);
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

  private ensureStatusChip(): void {
    if (this.statusChip !== null) return;
    const chip = document.createElement("div");
    chip.id = "net-status";
    chip.className = "net-status";
    chip.textContent = "…";
    document.getElementById("game-container")?.appendChild(chip);
    this.statusChip = chip;
  }

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

  private setChip(status: NetStatus, detail?: string): void {
    if (this.statusChip === null) return;
    this.statusChip.dataset.status = status;
    const labels: Record<NetStatus, string> = {
      idle: "Courier network idle",
      "fetching-token": "Fetching courier badge…",
      connecting: "Connecting to the forest…",
      authenticating: "Checking courier badge…",
      joined: "On the courier network",
      reconnecting: `Reconnecting${detail ? ` (${detail})` : "…"}`,
      closed: "Courier network offline",
    };
    this.statusChip.textContent =
      status === "joined" && detail ? detail : labels[status];
  }
}
