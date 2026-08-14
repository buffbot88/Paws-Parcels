/**
 * In-memory zone presence store (design/architecture.md §4/§7). Tracks which
 * players are in which zone, who is connected vs. in the reconnect grace
 * window, and produces snapshot payloads. Sockets are injected so the store
 * is pure and unit-testable without a real WebSocket.
 */

export interface ZonePlayer {
  characterId: number;
  accountId: number;
  name: string;
  classKey: string;
  /** Current server-authoritative tile position. */
  pos: { x: number; y: number };
  connected: boolean;
  /** Time of the last accepted move (ms epoch) — speed-cap bookkeeping. */
  lastMoveAt: number;
  /** True after an accepted move — marks the position for DB persistence. */
  dirty: boolean;
  /** Time of the last periodic DB write (ms epoch) — persistence throttle. */
  lastPersistAt: number;
  // --- Phase 3 combat state ---
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  /** Class speed in px/sec — drives per-player movement speed cap. */
  speed: number;
  critChance: number;
  critMultiplier: number;
  /** Time of the last accepted attack (ms epoch) — cooldown bookkeeping. */
  lastAttackAt: number;
  /** Respawn invulnerability window end (ms epoch). */
  invulnUntil: number;
  /** Time of the last zone-chat message for server-side rate limiting. */
  lastChatAt?: number;
}

export interface ZoneSnapshotPlayer {
  characterId: number;
  name: string;
  classKey: string;
  pos: { x: number; y: number };
}

export class ZoneStore {
  /** zoneId → (characterId → player). */
  private zones = new Map<string, Map<number, ZonePlayer>>();

  /**
   * Add (or restore) a player to a zone. Returns true when the player was
   * newly added and false when they were already present (reconnect).
   */
  join(zoneId: string, player: ZonePlayer): boolean {
    let zone = this.zones.get(zoneId);
    if (zone === undefined) {
      zone = new Map();
      this.zones.set(zoneId, zone);
    }
    const wasPresent = zone.has(player.characterId);
    zone.set(player.characterId, player);
    return !wasPresent;
  }

  /** Remove a player from a zone. Returns the removed player, or null. */
  leave(zoneId: string, characterId: number): ZonePlayer | null {
    const zone = this.zones.get(zoneId);
    if (zone === undefined) return null;
    const player = zone.get(characterId);
    if (player === undefined) return null;
    zone.delete(characterId);
    if (zone.size === 0) this.zones.delete(zoneId);
    return player;
  }

  /** Get a player currently in a zone (connected or grace-restored). */
  get(zoneId: string, characterId: number): ZonePlayer | null {
    return this.zones.get(zoneId)?.get(characterId) ?? null;
  }

  /** All players currently in a zone (connected or not). */
  players(zoneId: string): ZonePlayer[] {
    const zone = this.zones.get(zoneId);
    return zone === undefined ? [] : [...zone.values()];
  }

  /** Snapshot payload for `player_snapshot` (connected players only). */
  snapshot(zoneId: string): ZoneSnapshotPlayer[] {
    return this.players(zoneId)
      .filter((p) => p.connected)
      .map(toSnapshotPlayer);
  }

  /** Every zone id with at least one tracked player. */
  zoneIds(): string[] {
    return [...this.zones.keys()];
  }

  /** Whether any zone currently tracks the character. */
  isTracked(characterId: number): boolean {
    for (const zone of this.zones.values()) {
      if (zone.has(characterId)) return true;
    }
    return false;
  }
}

function toSnapshotPlayer(p: ZonePlayer): ZoneSnapshotPlayer {
  return {
    characterId: p.characterId,
    name: p.name,
    classKey: p.classKey,
    pos: { ...p.pos },
  };
}
