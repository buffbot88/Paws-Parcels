import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "../db/connection.ts";

/** Account row as stored in the Paws `accounts` table. */
export interface AccountRow {
  id: number;
  username: string;
  email: string | null;
  display_name: string;
  role: string;
  ashat_user_id: string | null;
}

/**
 * Payload that comes back from Ashat Hub's verify endpoint and is used
 * to upsert both an account and (eventually) a default character.
 */
export interface AshatLinkPayload {
  ashatUserId: string;
  username: string;
  displayName: string;
  role: string;
}

/**
 * Look up an account by its linked ashat_user_id. Returns null if no
 * link has been established yet.
 */
export async function getAccountByAshatId(
  ashatUserId: string,
): Promise<AccountRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, username, email, display_name, role, ashat_user_id FROM accounts WHERE ashat_user_id = ? LIMIT 1",
    [ashatUserId],
  );
  if (rows.length === 0) return null;
  return rowToAccount(rows[0]);
}

/**
 * Find an existing account by ashat_user_id, or create one if it is the
 * player's first login through Ashat. Existing rows are kept in sync so
 * a display_name or role change on Ashat propagates the next time they
 * log in.
 */
export async function findOrCreateAccountByAshatId(
  payload: AshatLinkPayload,
): Promise<AccountRow> {
  const existing = await getAccountByAshatId(payload.ashatUserId);
  if (existing !== null) {
    // Keep the local cache in step with the canonical Ashat identity.
    if (
      existing.display_name !== payload.displayName ||
      existing.username !== payload.username ||
      existing.role !== payload.role
    ) {
      const pool = getPool();
      await pool.query<ResultSetHeader>(
        "UPDATE accounts SET username = ?, display_name = ?, role = ? WHERE id = ?",
        [payload.username, payload.displayName, payload.role, existing.id],
      );
      existing.username = payload.username;
      existing.display_name = payload.displayName;
      existing.role = payload.role;
    }
    return existing;
  }

  const pool = getPool();
  const email = `${payload.username}@ashat.local`;
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO accounts (username, email, display_name, role, ashat_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      payload.username,
      email,
      payload.displayName,
      payload.role,
      payload.ashatUserId,
    ],
  );

  return {
    id: result.insertId,
    username: payload.username,
    email,
    display_name: payload.displayName,
    role: payload.role,
    ashat_user_id: payload.ashatUserId,
  };
}

function rowToAccount(row: RowDataPacket): AccountRow {
  return {
    id: Number(row.id),
    username: String(row.username ?? ""),
    email: row.email === null || row.email === undefined ? null : String(row.email),
    display_name: String(row.display_name ?? row.username ?? ""),
    role: String(row.role ?? "Member"),
    ashat_user_id:
      row.ashat_user_id === null || row.ashat_user_id === undefined
        ? null
        : String(row.ashat_user_id),
  };
}

/** The public account shape returned by /api/auth/me and auth flows. */
export function toPublicAccount(a: AccountRow): Record<string, unknown> {
  return {
    id: a.id,
    username: a.username,
    display_name: a.display_name,
    role: a.role,
    ashat_user_id: a.ashat_user_id,
  };
}
