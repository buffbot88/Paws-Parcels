import type { RowDataPacket } from "mysql2";
import { getPool } from "../db/connection.ts";

/** Zone row as stored in the `zones` table (seeded content). */
export interface ZoneRow {
  id: number;
  key: string;
  display_name: string;
  kind: string;
  map_data_id: string | null;
  width_tiles: number;
  height_tiles: number;
  default_spawn_x: number;
  default_spawn_y: number;
  max_players: number;
  is_safe: boolean;
}

/**
 * Look up a zone by its stable key (e.g. "zone-post-office"). The zones
 * table is the authoritative source for a zone's default spawn — character
 * creation and future zone-metadata endpoints read from here rather than
 * duplicating coordinates.
 */
export async function getZoneByKey(key: string): Promise<ZoneRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, \`key\`, display_name, kind, map_data_id,
            width_tiles, height_tiles, default_spawn_x, default_spawn_y,
            max_players, is_safe
       FROM zones
      WHERE \`key\` = ?
      LIMIT 1`,
    [key],
  );
  return rows.length === 0 ? null : rowToZone(rows[0]);
}

function rowToZone(row: RowDataPacket): ZoneRow {
  return {
    id: Number(row.id),
    key: String(row.key ?? ""),
    display_name: String(row.display_name ?? ""),
    kind: String(row.kind ?? "outdoor"),
    map_data_id: row.map_data_id === null ? null : String(row.map_data_id),
    width_tiles: Number(row.width_tiles ?? 0),
    height_tiles: Number(row.height_tiles ?? 0),
    default_spawn_x: Number(row.default_spawn_x ?? 0),
    default_spawn_y: Number(row.default_spawn_y ?? 0),
    max_players: Number(row.max_players ?? 32),
    is_safe: Number(row.is_safe) === 1,
  };
}
