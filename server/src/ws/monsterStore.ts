/**
 * In-memory monster store (design/monsters.md §1-§5). Each outdoor zone has
 * fixed spawn points (from the map JSON); every spawn point hosts one monster
 * instance whose template comes from the DB `monster_definitions` table.
 * AI is deliberately simple for the MVP: aggressive monsters chase the nearest
 * player within their aggro range and attack on cooldown; passive monsters
 * ignore players unless hit; dead monsters respawn on a fixed timer. All state
 * is server-memory (no persistence between restarts).
 */

import type { MonsterDefinitionRow, MonsterLootEntry } from "../models/Monster.ts";
import { tileDistance, computeDamage } from "./combat.ts";
import type { BrainMonsterDecision } from "../ai/prompts.ts";

/** A spawned monster instance (one per spawn point). */
export interface MonsterInstance {
  id: string;
  defKey: string;
  displayName: string;
  /** Home spawn tile — leashed monsters return here. */
  home: { x: number; y: number };
  pos: { x: number; y: number };
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  /** Speed in tiles/sec (derived from the definition's px/sec). */
  tilesPerSecond: number;
  aggroBehavior: "aggro" | "passive";
  attackBehavior: "melee" | "ranged";
  respawnSeconds: number;
  experienceReward: number;
  lootTable: MonsterLootEntry[];
  alive: boolean;
  /** ms epoch when a dead monster respawns. */
  respawnAt: number;
  /** Cooldown bookkeeping (per monster, not per player — design §5). */
  lastAttackAt: number;
  /** A passive monster's attacker for 10s after being hit (design §4). */
  grudgeTargetId: number | null;
  grudgeUntil: number;
}

/** A connected player in the zone, shaped for monster AI. */
export interface MonsterPlayer {
  characterId: number;
  pos: { x: number; y: number };
  hp: number;
  maxHp: number;
  defense: number;
  /** Invulnerability window after respawn (design/combat.md §3). */
  invulnUntil: number;
}

/** Result of one AI tick for a monster that landed a hit. */
export interface MonsterAttackEvent {
  monsterId: string;
  playerId: number;
  damage: number;
  crit: boolean;
}

const TILE_SIZE = 48;
const AGGRO_RANGE = 5;
const LEASH_RANGE = 10;
const MELEE_RANGE = 1;
const RANGED_RANGE = 3;

export class MonsterStore {
  /** zoneId → monster instances. */
  private zones = new Map<string, MonsterInstance[]>();
  /** zoneId → monster definition lookup (defKey → def). */
  private definitions = new Map<string, Map<string, MonsterDefinitionRow>>();

  /**
   * (Re)build the monsters for a zone from its spawn points + definitions.
   * Safe to call repeatedly — replaces any existing instance set.
   */
  seed(
    zoneId: string,
    spawns: { id: string; key: string; x: number; y: number }[],
    defs: MonsterDefinitionRow[],
  ): void {
    const byKey = new Map(defs.map((d) => [d.key, d]));
    this.definitions.set(zoneId, byKey);
    const instances: MonsterInstance[] = [];
    for (const spawn of spawns) {
      const def = byKey.get(spawn.key);
      if (def === undefined) continue; // unknown def — skip, zone still works
      instances.push(
        instanceFromSpawn(spawn.id, spawn, def),
      );
    }
    this.zones.set(zoneId, instances);
  }

  /** All monsters in a zone (for zone_state snapshots). */
  monsters(zoneId: string): MonsterInstance[] {
    return this.zones.get(zoneId) ?? [];
  }

  /** A single monster by zone + instance id, or null. */
  get(zoneId: string, monsterId: string): MonsterInstance | null {
    return this.zones.get(zoneId)?.find((m) => m.id === monsterId) ?? null;
  }

  /**
   * Advance monster AI for a zone. Returns events for every monster attack
   * that landed this tick; the caller applies damage to players.
   */
  update(
    zoneId: string,
    now: number,
    players: MonsterPlayer[],
    isWalkable: (x: number, y: number) => boolean,
    elapsedMs: number,
    brainDecisions?: ReadonlyMap<string, BrainMonsterDecision> | null,
  ): MonsterAttackEvent[] {
    const events: MonsterAttackEvent[] = [];
    for (const monster of this.monsters(zoneId)) {
      if (!monster.alive) {
        if (now >= monster.respawnAt) this.respawn(monster, now);
        continue;
      }
      this.aiStep(monster, now, players, isWalkable, elapsedMs, events, brainDecisions);
    }
    return events;
  }

  /** Apply damage to a monster; returns true when it was lethal. */
  damage(zoneId: string, monsterId: string, amount: number): boolean {
    const monster = this.get(zoneId, monsterId);
    if (monster === null || !monster.alive) return false;
    monster.hp -= amount;
    if (monster.hp <= 0) {
      monster.hp = 0;
      monster.alive = false;
      monster.respawnAt = Date.now() + monster.respawnSeconds * 1000;
      return true;
    }
    return false;
  }

  /** Mark a monster as carrying a grudge (it was hit by a player). */
  aggroOn(zoneId: string, monsterId: string, playerId: number, now: number): void {
    const monster = this.get(zoneId, monsterId);
    if (monster === null || !monster.alive) return;
    monster.grudgeTargetId = playerId;
    monster.grudgeUntil = now + 10_000;
  }

  private respawn(monster: MonsterInstance, now: number): void {
    monster.alive = true;
    monster.hp = monster.maxHp;
    monster.pos = { ...monster.home };
    monster.grudgeTargetId = null;
    monster.lastAttackAt = now;
  }

  private aiStep(
    m: MonsterInstance,
    now: number,
    players: MonsterPlayer[],
    isWalkable: (x: number, y: number) => boolean,
    elapsedMs: number,
    events: MonsterAttackEvent[],
    brainDecisions?: ReadonlyMap<string, BrainMonsterDecision> | null,
  ): void {
    const brainDecision =
      brainDecisions === undefined || brainDecisions === null
        ? undefined
        : brainDecisions.get(m.id);
    if (brainDecision !== undefined) {
      const handled = this.applyBrainDecision(
        m,
        brainDecision,
        now,
        players,
        isWalkable,
        elapsedMs,
        events,
      );
      if (handled) return;
    }
    const target = this.pickTarget(m, players, now);
    if (target === null) {
      // No target: idle at home, or return to it if leashed.
      if (tileDistance(m.pos, m.home) > 0) {
        this.moveToward(m, m.home, isWalkable, elapsedMs);
      }
      return;
    }

    const range = tileDistance(m.pos, target.pos);
    const attackRange =
      m.attackBehavior === "ranged" ? RANGED_RANGE : MELEE_RANGE;
    if (range <= attackRange && target.invulnUntil <= now) {
      if (now - m.lastAttackAt >= 2000) {
        m.lastAttackAt = now;
        const result = computeDamage(
          { attack: m.attack, critChance: 0, critMultiplier: 1 },
          { defense: target.defense },
        );
        events.push({
          monsterId: m.id,
          playerId: target.characterId,
          damage: result.damage,
          crit: false,
        });
      }
      return;
    }
    // Chase (or flee if far from home).
    if (tileDistance(m.pos, m.home) > LEASH_RANGE) {
      this.moveToward(m, m.home, isWalkable, elapsedMs);
    } else {
      this.moveToward(m, target.pos, isWalkable, elapsedMs);
    }
  }

  /**
   * Apply a world-brain decision as an override. Returns false when the
   * decision can't be honored (e.g. its target vanished) so the caller falls
   * back to the deterministic AI.
   */
  private applyBrainDecision(
    m: MonsterInstance,
    decision: BrainMonsterDecision,
    now: number,
    players: MonsterPlayer[],
    isWalkable: (x: number, y: number) => boolean,
    elapsedMs: number,
    events: MonsterAttackEvent[],
  ): boolean {
    switch (decision.action) {
      case "attack": {
        const target =
          players.find((p) => p.characterId === decision.targetPlayerId) ??
          this.pickTarget(m, players, now);
        if (target === null) return false;
        const range = tileDistance(m.pos, target.pos);
        const attackRange =
          m.attackBehavior === "ranged" ? RANGED_RANGE : MELEE_RANGE;
        if (range <= attackRange && target.invulnUntil <= now) {
          if (now - m.lastAttackAt >= 2000) {
            m.lastAttackAt = now;
            const result = computeDamage(
              { attack: m.attack, critChance: 0, critMultiplier: 1 },
              { defense: target.defense },
            );
            events.push({
              monsterId: m.id,
              playerId: target.characterId,
              damage: result.damage,
              crit: false,
            });
          }
        } else {
          this.moveToward(m, target.pos, isWalkable, elapsedMs);
        }
        return true;
      }
      case "flee": {
        const threat = decision.targetTile ?? m.home;
        this.moveAwayFrom(m, threat, isWalkable, elapsedMs);
        return true;
      }
      case "seek":
      case "patrol": {
        if (decision.targetTile === null) return false;
        if (tileDistance(m.pos, decision.targetTile) > 0) {
          this.moveToward(m, decision.targetTile, isWalkable, elapsedMs);
        }
        return true;
      }
      default:
        return false;
    }
  }

  /** Move one tile per step directly away from a threat point. */
  private moveAwayFrom(
    m: MonsterInstance,
    threat: { x: number; y: number },
    isWalkable: (x: number, y: number) => boolean,
    elapsedMs: number,
  ): void {
    const steps = Math.max(1, Math.round((elapsedMs / 1000) * m.tilesPerSecond));
    for (let i = 0; i < steps; i++) {
      let dx = m.pos.x - threat.x;
      let dy = m.pos.y - threat.y;
      if (dx === 0 && dy === 0) break; // cornered — hold ground
      const scale = Math.max(Math.abs(dx), Math.abs(dy), 1);
      const nx = m.pos.x + Math.round(dx / scale);
      const ny = m.pos.y + Math.round(dy / scale);
      if (nx === m.pos.x && ny === m.pos.y) break;
      if (isWalkable(nx, ny)) {
        m.pos = { x: nx, y: ny };
      } else {
        // Try the dominant axis alone.
        const altX = Math.abs(dx) >= Math.abs(dy) ? { x: nx, y: m.pos.y } : null;
        const altY = Math.abs(dy) > Math.abs(dx) ? { x: m.pos.x, y: ny } : null;
        const fallback = altX !== null && isWalkable(altX.x, altX.y) ? altX
          : altY !== null && isWalkable(altY.x, altY.y) ? altY
          : null;
        if (fallback === null) break;
        m.pos = { x: fallback.x, y: fallback.y };
      }
    }
  }

  private pickTarget(
    m: MonsterInstance,
    players: MonsterPlayer[],
    now: number,
  ): MonsterPlayer | null {
    if (players.length === 0) return null;
    // Passive monsters only retaliate against their grudge target.
    if (m.aggroBehavior === "passive") {
      if (m.grudgeTargetId === null || now > m.grudgeUntil) return null;
      const grudge = players.find((p) => p.characterId === m.grudgeTargetId);
      return grudge ?? null;
    }
    // Aggressive: nearest player within aggro range.
    let best: MonsterPlayer | null = null;
    let bestRange = AGGRO_RANGE;
    for (const p of players) {
      if (p.invulnUntil > now) continue; // respawn invuln — ignore
      const d = tileDistance(m.pos, p.pos);
      if (d <= bestRange) {
        best = p;
        bestRange = d;
      }
    }
    return best;
  }

  /** Move one tile (in elapsedMs steps) toward a target using 4-dir greedy. */
  private moveToward(
    m: MonsterInstance,
    target: { x: number; y: number },
    isWalkable: (x: number, y: number) => boolean,
    elapsedMs: number,
  ): void {
    // Tile steps per update, scaled by elapsed time vs a 1s baseline.
    const steps = Math.max(1, Math.round((elapsedMs / 1000) * m.tilesPerSecond));
    for (let i = 0; i < steps; i++) {
      const dx = Math.sign(target.x - m.pos.x);
      const dy = Math.sign(target.y - m.pos.y);
      // Prefer the dominant axis; fall back to the other if blocked.
      const preferX = Math.abs(target.x - m.pos.x) >= Math.abs(target.y - m.pos.y);
      const moves: { x: number; y: number }[] = preferX
        ? [{ x: dx, y: 0 }, { x: 0, y: dy }]
        : [{ x: 0, y: dy }, { x: dx, y: 0 }];
      let stepped = false;
      for (const move of moves) {
        if (move.x === 0 && move.y === 0) continue;
        const nx = m.pos.x + move.x;
        const ny = m.pos.y + move.y;
        if (isWalkable(nx, ny)) {
          m.pos = { x: nx, y: ny };
          stepped = true;
          break;
        }
      }
      if (!stepped) break;
    }
  }
}

function instanceFromSpawn(
  id: string,
  spawn: { x: number; y: number },
  def: MonsterDefinitionRow,
): MonsterInstance {
  return {
    id,
    defKey: def.key,
    displayName: def.display_name,
    home: { x: spawn.x, y: spawn.y },
    pos: { x: spawn.x, y: spawn.y },
    hp: def.max_hp,
    maxHp: def.max_hp,
    attack: def.attack,
    defense: def.defense,
    tilesPerSecond: def.speed / TILE_SIZE,
    aggroBehavior: def.aggro_behavior === "aggro" ? "aggro" : "passive",
    attackBehavior: def.attack_behavior === "ranged" ? "ranged" : "melee",
    respawnSeconds: def.respawn_seconds,
    experienceReward: def.experience_reward,
    lootTable: def.loot_table,
    alive: true,
    respawnAt: 0,
    lastAttackAt: 0,
    grudgeTargetId: null,
    grudgeUntil: 0,
  };
}
