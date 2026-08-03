import Phaser from "phaser";
import {
  GameSocket,
  type NetPlayerInfo,
  type NetPlayerPos,
  type NetStatus,
} from "../net/GameSocket.ts";
import { RemotePlayer } from "../entities/RemotePlayer.ts";
import {
  type BootCharacter,
  pickCharacter,
  readBootCharacters,
  readSelectedCharacterId,
} from "../net/bootTarget.ts";

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

/** ws(s):// URL for the game server, same origin (Vite proxies /ws in dev). */
function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

/**
 * Singleton network layer for the overworld. Owns the GameSocket and renders
 * other players' avatars into whichever Phaser scene is attached. The scene
 * calls `attach`, `start`, `joinZone`, `moveIntent` and `update` each frame.
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
  private myCharacterId: number | null = null;
  private statusChip: HTMLElement | null = null;

  private constructor() {
    this.ensureStatusChip();
  }

  /** Bind to the current scene (call from scene.create). */
  attach(scene: Phaser.Scene): void {
    this.scene = scene;
    // Old scene's game objects are destroyed; clear the registry.
    this.players.clear();
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

  /** Per-frame: interpolate remote players toward their snapshot targets. */
  update(): void {
    for (const player of this.players.values()) player.update();
  }

  /** Forget the scene and its remote players (scene shutdown). */
  detach(): void {
    this.scene = null;
    this.players.clear();
  }

  /** Close the socket for good (logout / page teardown). */
  shutdown(): void {
    this.socket?.close();
    this.socket = null;
    this.players.clear();
    this.statusChip?.remove();
    this.statusChip = null;
  }

  private buildSocket(): GameSocket {
    const character = pickPlayCharacter();
    this.myCharacterId = character?.id ?? null;
    const socket = new GameSocket({
      wsUrl: wsUrl(),
      getToken: readToken,
      getCharacterId: () => pickPlayCharacter()?.id ?? null,
    });
    socket.callbacks.onStatus = (status, detail) => this.setChip(status, detail);
    socket.callbacks.onZoneState = (zoneId, players) =>
      this.handleZoneState(zoneId, players);
    socket.callbacks.onPlayerJoined = (player) => this.spawnPlayer(player, false);
    socket.callbacks.onPlayerLeft = (characterId) => this.removePlayer(characterId);
    socket.callbacks.onSnapshot = (players) => this.handleSnapshot(players);
    socket.callbacks.onError = (code, message) => {
      // Collision rejections are normal gameplay feedback — stay quiet.
      if (code !== "MOVE_COLLISION" && code !== "MOVE_TELEPORT_DETECTED") {
        console.warn(`[net] ${code}: ${message}`);
      }
    };
    return socket;
  }

  private handleZoneState(zoneId: string, players: NetPlayerInfo[]): void {
    this.players.clear();
    for (const p of players) {
      if (p.characterId === this.myCharacterId) continue;
      this.spawnPlayer(p, true);
    }
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

  // --- connection status chip (DOM-over-Canvas) ---

  private ensureStatusChip(): void {
    if (this.statusChip !== null) return;
    const chip = document.createElement("div");
    chip.id = "net-status";
    chip.className = "net-status";
    chip.textContent = "…";
    document.getElementById("game-container")?.appendChild(chip);
    this.statusChip = chip;
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
