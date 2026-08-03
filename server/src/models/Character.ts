import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "../db/connection.ts";
import type { CharacterClassRow } from "./CharacterClass.ts";
import { getZoneByKey } from "./Zone.ts";
import { logger } from "../middleware/logger.ts";

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

/** Outcome of createCharacter — distinguishes a taken name from other failures. */
export type CreateCharacterResult =
  | { ok: true; character: CharacterRow }
  | { ok: false; reason: "NAME_TAKEN" };

/**
 * Create a character and its 1:1 player-state rows (character_stats derived
 * from the class template, plus a starter inventory) in one transaction.
 * Initial spawn is the Post Office default (matches zones seed + map JSON).
 * Returns NAME_TAKEN when the account already has a character with that name
 * (the (account_id, name) unique index is the source of truth).
 */
export async function createCharacter(params: {
  accountId: number;
  name: string;
  classId: number;
  appearance: Record<string, unknown>;
  cls: CharacterClassRow;
}): Promise<CreateCharacterResult> {
  const pool = getPool();
  const conn = await pool.getConnection();
  const base = params.cls.base_stats;
  const maxHp = base.hp ?? 100;
  const resourceMax = params.cls.resource_max;

  // New couriers start at the zone's authoritative default spawn (zones
  // seed), falling back to the schema defaults only if the zone row is
  // missing — never duplicate coordinates in two places.
  const startZone = "zone-post-office";
  const startZoneRow = await getZoneByKey(startZone);
  if (startZoneRow === null) {
    logger.warn("createCharacter: start zone missing from zones table", {
      zone: startZone,
    });
  }
  const startX = startZoneRow?.default_spawn_x ?? 15;
  const startY = startZoneRow?.default_spawn_y ?? 14;

  try {
    await conn.beginTransaction();

    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO characters
         (account_id, class_id, name, appearance, zone_id, pos_x, pos_y,
          level, experience, stamps, hp, max_hp, resource_current)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?, ?)`,
      [
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
      ],
    );
    const characterId = Number(result.insertId);

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
    await conn.execute(
      `INSERT INTO character_stats
         (character_id, attack, defense, speed, crit_chance, crit_multiplier,
          ${res.maxCol}, ${res.regenCol})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        characterId,
        base.attack ?? 10,
        base.defense ?? 5,
        base.speed ?? 180,
        base.crit_chance ?? 5,
        base.crit_multiplier ?? 1.5,
        resourceMax,
        params.cls.resource_regen_per_sec,
      ],
    );

    // Starter inventory (12 slots, schema default).
    await conn.execute(
      "INSERT INTO inventories (character_id, slot_count) VALUES (?, 12)",
      [characterId],
    );

    await conn.commit();
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
      await conn.rollback();
    } catch (rollbackErr) {
      logger.error("createCharacter: rollback failed", {
        error: String(rollbackErr),
      });
    }
    if (isDuplicateEntry(err)) return { ok: false, reason: "NAME_TAKEN" };
    throw err;
  } finally {
    conn.release();
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

function isDuplicateEntry(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === "ER_DUP_ENTRY";
}

/**
 * Look up all characters that belong to the given Paws account id.
 * Returns an empty array when the account has no characters yet — the
 * client prompts the player to create one (Phase 2.5 UI).
 */
export async function getCharactersByAccountId(
  accountId: number,
): Promise<CharacterRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, account_id, class_id, name, zone_id, pos_x, pos_y, level
       FROM characters
       WHERE account_id = ?
       ORDER BY id ASC`,
    [accountId],
  );
  return rows.map(rowToCharacter);
}

/** Look up a single character by id, or null. */
export async function getCharacterById(
  characterId: number,
): Promise<CharacterRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, account_id, class_id, name, zone_id, pos_x, pos_y, level
       FROM characters
       WHERE id = ?
       LIMIT 1`,
    [characterId],
  );
  return rows.length === 0 ? null : rowToCharacter(rows[0]);
}

/**
 * Look up a character joined with its class key — the payload the WebSocket
 * server needs to open a session (name, class, current zone + position).
 */
export async function getCharacterWithClass(
  characterId: number,
): Promise<CharacterSessionRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.account_id, c.name, cc.\`key\` AS class_key,
            c.zone_id, c.pos_x, c.pos_y, c.level
       FROM characters c
       JOIN character_classes cc ON cc.id = c.class_id
      WHERE c.id = ?
      LIMIT 1`,
    [characterId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    account_id: Number(row.account_id),
    name: String(row.name ?? ""),
    class_key: String(row.class_key ?? ""),
    zone_id: String(row.zone_id ?? "zone-post-office"),
    pos_x: Number(row.pos_x ?? 0),
    pos_y: Number(row.pos_y ?? 0),
    level: Number(row.level ?? 1),
  };
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
  const pool = getPool();
  await pool.execute(
    "UPDATE characters SET zone_id = ?, pos_x = ?, pos_y = ?, updated_at = NOW() WHERE id = ?",
    [zoneId, posX, posY, characterId],
  );
}

function rowToCharacter(row: RowDataPacket): CharacterRow {
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
