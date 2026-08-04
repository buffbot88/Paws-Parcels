import { getDb } from "../db/connection.ts";
import type { CharacterClassRow } from "./CharacterClass.ts";
import { getZoneByKey } from "./Zone.ts";
import { logger } from "../middleware/logger.ts";

/** A row object as returned by node:sqlite (null | number | bigint | string). */
type SqlRow = Record<string, unknown>;

/** Character row as stored in the Paws `characters` table. */
export interface CharacterRow {
  id: number;
  account_id: number;
  class_id: number;
  name: string;
  zone_id: string;
  pos_x: number;
  pos_y: number;
  level: number;
}

/** Character + class key, used to start a WebSocket session. */
export interface CharacterSessionRow {
  id: number;
  account_id: number;
  name: string;
  class_key: string;
  zone_id: string;
  pos_x: number;
  pos_y: number;
  level: number;
}

/** Combat-relevant stats joined for the WS game server (Phase 3). */
export interface CharacterCombatStats {
  max_hp: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  crit_chance: number;
  crit_multiplier: number;
}

/** Outcome of createCharacter — distinguishes a taken name from other failures. */
export type CreateCharacterResult =
  | { ok: true; character: CharacterRow }
  | { ok: false; reason: "NAME_TAKEN" };

/**
 * Create a character and its 1:1 player-state rows (character_stats derived
 * from the class template, plus a starter inventory) in one transaction.
 * Initial spawn is the Clover Village default (matches zones seed + map JSON).
 * Returns NAME_TAKEN when the account already has a character with that name
 * (the UNIQUE(account_id, name) index is the source of truth).
 */
export async function createCharacter(params: {
  accountId: number;
  name: string;
  classId: number;
  appearance: Record<string, unknown>;
  cls: CharacterClassRow;
}): Promise<CreateCharacterResult> {
  const base = params.cls.base_stats;
  const maxHp = base.hp ?? 100;
  const resourceMax = params.cls.resource_max;

  // New couriers start at the zone's authoritative default spawn (zones
  // seed), falling back to the schema defaults only if the zone row is
  // missing — never duplicate coordinates in two places.
  const startZone = "zone-clover-village";
  const startZoneRow = await getZoneByKey(startZone);
  if (startZoneRow === null) {
    logger.warn("createCharacter: start zone missing from zones table", {
      zone: startZone,
    });
  }
  const startX = startZoneRow?.default_spawn_x ?? 15;
  const startY = startZoneRow?.default_spawn_y ?? 13;

  const db = getDb();
  try {
    db.exec("BEGIN");

    const info = db
      .prepare(
        `INSERT INTO characters
           (account_id, class_id, name, appearance, zone_id, pos_x, pos_y,
            level, experience, stamps, hp, max_hp, resource_current)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?, ?)`,
      )
      .run(
        params.accountId,
        params.classId,
        params.name,
        JSON.stringify(params.appearance),
        startZone,
        startX,
        startY,
        maxHp,
        maxHp,
        resourceMax,
      );
    const characterId = Number(info.lastInsertRowid);

    // character_stats — the resource family is chosen by the class template.
    // maxCol/regenCol come from a closed whitelist (stamina/mana/focus) —
    // never from client or DB input, so string-building the column names is
    // injection-safe here.
    const res =
      params.cls.primary_resource === "mana"
        ? { maxCol: "mana_max", regenCol: "mana_regen" }
        : params.cls.primary_resource === "focus"
          ? { maxCol: "focus_max", regenCol: "focus_regen" }
          : { maxCol: "stamina_max", regenCol: "stamina_regen" };
    db.prepare(
      `INSERT INTO character_stats
         (character_id, attack, defense, speed, crit_chance, crit_multiplier,
          ${res.maxCol}, ${res.regenCol})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      characterId,
      base.attack ?? 10,
      base.defense ?? 5,
      base.speed ?? 180,
      base.crit_chance ?? 5,
      base.crit_multiplier ?? 1.5,
      resourceMax,
      params.cls.resource_regen_per_sec,
    );

    // Starter inventory (12 slots, schema default).
    db.prepare(
      "INSERT INTO inventories (character_id, slot_count) VALUES (?, 12)",
    ).run(characterId);

    db.exec("COMMIT");
    return {
      ok: true,
      character: {
        id: characterId,
        account_id: params.accountId,
        class_id: params.classId,
        name: params.name,
        zone_id: startZone,
        pos_x: startX,
        pos_y: startY,
        level: 1,
      },
    };
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackErr) {
      logger.error("createCharacter: rollback failed", {
        error: String(rollbackErr),
      });
    }
    if (isUniqueConstraintError(err)) return { ok: false, reason: "NAME_TAKEN" };
    throw err;
  }
}

/** The public character shape used by /api/auth/me and /api/characters. */
export function toPublicCharacter(c: CharacterRow): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    class_id: c.class_id,
    zone_id: c.zone_id,
    pos_x: c.pos_x,
    pos_y: c.pos_y,
    level: c.level,
  };
}

/** node:sqlite reports unique violations as "UNIQUE constraint failed: …". */
function isUniqueConstraintError(err: unknown): boolean {
  return String(err).includes("UNIQUE constraint failed");
}

/**
 * Look up all characters that belong to the given Paws account id.
 * Returns an empty array when the account has no characters yet — the
 * client prompts the player to create one (courier desk).
 */
export async function getCharactersByAccountId(
  accountId: number,
): Promise<CharacterRow[]> {
  const rows = getDb()
    .prepare(
      `SELECT id, account_id, class_id, name, zone_id, pos_x, pos_y, level
         FROM characters
        WHERE account_id = ?
        ORDER BY id ASC`,
    )
    .all(accountId) as SqlRow[];
  return rows.map(rowToCharacter);
}

/** Look up a single character by id, or null. */
export async function getCharacterById(
  characterId: number,
): Promise<CharacterRow | null> {
  const row = getDb()
    .prepare(
      `SELECT id, account_id, class_id, name, zone_id, pos_x, pos_y, level
         FROM characters
        WHERE id = ?
        LIMIT 1`,
    )
    .get(characterId) as SqlRow | undefined;
  return row === undefined ? null : rowToCharacter(row);
}

/**
 * Look up a character joined with its class key and combat stats — the
 * payload the WebSocket server needs to open a session (name, class, zone,
 * position, and the Phase 3 HP/attack/defense stats for combat).
 */
export async function getCharacterWithClass(
  characterId: number,
): Promise<CharacterSessionRow & CharacterCombatStats | null> {
  const row = getDb()
    .prepare(
      `SELECT c.id, c.account_id, c.name, cc.\`key\` AS class_key,
              c.zone_id, c.pos_x, c.pos_y, c.level,
              c.hp, c.max_hp, cs.attack, cs.defense, cs.speed,
              cs.crit_chance, cs.crit_multiplier
         FROM characters c
         JOIN character_classes cc ON cc.id = c.class_id
         LEFT JOIN character_stats cs ON cs.character_id = c.id
        WHERE c.id = ?
        LIMIT 1`,
    )
    .get(characterId) as SqlRow | undefined;
  if (row === undefined) return null;
  return {
    id: Number(row.id),
    account_id: Number(row.account_id),
    name: String(row.name ?? ""),
    class_key: String(row.class_key ?? ""),
    zone_id: String(row.zone_id ?? "zone-clover-village"),
    pos_x: Number(row.pos_x ?? 0),
    pos_y: Number(row.pos_y ?? 0),
    level: Number(row.level ?? 1),
    hp: Number(row.hp ?? row.max_hp ?? 100),
    max_hp: Number(row.max_hp ?? 100),
    attack: Number(row.attack ?? 10),
    defense: Number(row.defense ?? 5),
    speed: Number(row.speed ?? 180),
    crit_chance: Number(row.crit_chance ?? 5),
    crit_multiplier: Number(row.crit_multiplier ?? 1.5),
  };
}

/**
 * Persist a character's current HP (best-effort; called on defeat, zone
 * leave, and logout so the health bar survives across sessions).
 */
export async function updateCharacterHp(
  characterId: number,
  hp: number,
  maxHp: number,
): Promise<void> {
  getDb()
    .prepare(
      "UPDATE characters SET hp = ?, max_hp = ?, updated_at = ? WHERE id = ?",
    )
    .run(hp, maxHp, new Date().toISOString(), characterId);
}

/**
 * Grant experience to a character (best-effort on kill). Returns the new
 * experience total, or null when the character does not exist.
 */
export async function grantExperience(
  characterId: number,
  amount: number,
): Promise<number | null> {
  const row = getDb()
    .prepare("SELECT experience FROM characters WHERE id = ?")
    .get(characterId) as SqlRow | undefined;
  if (row === undefined) return null;
  const next = Number(row.experience ?? 0) + amount;
  getDb()
    .prepare("UPDATE characters SET experience = ?, updated_at = ? WHERE id = ?")
    .run(next, new Date().toISOString(), characterId);
  return next;
}

/**
 * Persist a character's zone + tile position (best-effort; called on zone
 * leave, logout, and periodically by the game server).
 */
export async function updateCharacterPosition(
  characterId: number,
  zoneId: string,
  posX: number,
  posY: number,
): Promise<void> {
  getDb()
    .prepare(
      "UPDATE characters SET zone_id = ?, pos_x = ?, pos_y = ?, updated_at = ? WHERE id = ?",
    )
    .run(zoneId, posX, posY, new Date().toISOString(), characterId);
}

function rowToCharacter(row: SqlRow): CharacterRow {
  return {
    id: Number(row.id),
    account_id: Number(row.account_id),
    class_id: Number(row.class_id),
    name: String(row.name ?? ""),
    zone_id: String(row.zone_id ?? ""),
    pos_x: Number(row.pos_x ?? 0),
    pos_y: Number(row.pos_y ?? 0),
    level: Number(row.level ?? 1),
  };
}
