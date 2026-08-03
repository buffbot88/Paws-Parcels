import type { RowDataPacket } from "mysql2";
import { getPool } from "../db/connection.ts";

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
