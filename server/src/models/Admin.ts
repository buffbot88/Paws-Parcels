import { getDb } from "../db/connection.ts";
import { admin as adminConfig, server as serverConfig } from "../config/index.ts";
import { refreshGameplayRates } from "./GameplayRates.ts";

type SqlRow = Record<string, unknown>;

/** Admin tiers derived from ASHAT Hub account roles. */
export type AdminTier = "none" | "support" | "moderator" | "admin" | "developer";

/** Ordered tiers — each includes every capability of the lower ones. */
const TIER_ORDER: AdminTier[] = ["none", "support", "moderator", "admin", "developer"];

/**
 * Maps Hub account roles to admin tiers. Role names on the Hub evolve, so the
 * map is overridable via server_config.json -> admin.roleTiers.
 */
const DEFAULT_ROLE_TIERS: Record<string, AdminTier> = {
  Developer: "developer",
  Admin: "admin",
  "Game Master": "moderator",
  GM: "moderator",
  Moderator: "moderator",
  Support: "support",
  LiveOps: "support",
};

let roleTiers: Record<string, AdminTier> | null = null;

/** Resolve the config override once (lazy so tests can import cleanly). */
function tierMap(): Record<string, AdminTier> {
  if (roleTiers === null) {
    const raw = adminConfig.roleTiers;
    roleTiers =
      raw !== undefined && typeof raw === "object"
        ? { ...DEFAULT_ROLE_TIERS, ...(raw as Record<string, AdminTier>) }
        : { ...DEFAULT_ROLE_TIERS };
  }
  return roleTiers;
}

/** Map an ASHAT Hub account role to its admin tier. */
export function adminTierForRole(role: string): AdminTier {
  return tierMap()[role] ?? "none";
}

/** True when `tier` includes at least `required`. */
export function tierSatisfies(tier: AdminTier, required: AdminTier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(required);
}

/** An account with its resolved admin tier. */
export interface AdminActor {
  accountId: number;
  username: string;
  displayName: string;
  role: string;
  tier: AdminTier;
}

/** One append-only admin_audit_log write. */
export interface AuditEntry {
  action: string;
  category: string;
  targetType: string;
  targetId: string;
  targetLabel?: string;
  reason?: string;
  beforeState?: unknown;
  afterState?: unknown;
  requestId?: string;
  ip?: string;
}

/** Write one audit row (append-only; never throws into the request path). */
export function writeAuditLog(actor: AdminActor, entry: AuditEntry): number {
  const info = getDb()
    .prepare(
      `INSERT INTO admin_audit_log
        (admin_account_id, admin_username, action, category, target_type, target_id,
         target_label, environment, reason, before_state, after_state, request_id, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      actor.accountId,
      actor.username,
      entry.action,
      entry.category,
      entry.targetType,
      entry.targetId,
      entry.targetLabel ?? "",
      serverEnvLabel(),
      entry.reason ?? "",
      entry.beforeState === undefined ? null : JSON.stringify(entry.beforeState),
      entry.afterState === undefined ? null : JSON.stringify(entry.afterState),
      entry.requestId ?? "",
      entry.ip ?? "",
    );
  return Number(info.lastInsertRowid);
}

/** Admin audit log row (parsed JSON states). */
export interface AdminAuditRow {
  id: number;
  adminAccountId: number | null;
  adminUsername: string;
  action: string;
  category: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  environment: string;
  reason: string;
  beforeState: unknown;
  afterState: unknown;
  requestId: string;
  ip: string;
  createdAt: string;
}

export interface AuditQuery {
  category?: string;
  adminAccountId?: number;
  targetType?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
}

function rowToAudit(row: SqlRow): AdminAuditRow {
  const parseState = (raw: unknown): unknown => {
    if (typeof raw !== "string" || raw === "") return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  };
  return {
    id: Number(row.id),
    adminAccountId: row.admin_account_id === null ? null : Number(row.admin_account_id),
    adminUsername: String(row.admin_username ?? ""),
    action: String(row.action ?? ""),
    category: String(row.category ?? ""),
    targetType: String(row.target_type ?? ""),
    targetId: String(row.target_id ?? ""),
    targetLabel: String(row.target_label ?? ""),
    environment: String(row.environment ?? ""),
    reason: String(row.reason ?? ""),
    beforeState: parseState(row.before_state),
    afterState: parseState(row.after_state),
    requestId: String(row.request_id ?? ""),
    ip: String(row.ip ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

/** List audit entries, newest first. */
export function listAuditEntries(query: AuditQuery): { entries: AdminAuditRow[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (query.category !== undefined && query.category !== "") {
    conditions.push("category = ?");
    params.push(query.category);
  }
  if (query.adminAccountId !== undefined) {
    conditions.push("admin_account_id = ?");
    params.push(query.adminAccountId);
  }
  if (query.targetType !== undefined && query.targetType !== "") {
    conditions.push("target_type = ?");
    params.push(query.targetType);
  }
  if (query.targetId !== undefined && query.targetId !== "") {
    conditions.push("target_id = ?");
    params.push(query.targetId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM admin_audit_log ${where}`).get(...params) as SqlRow).n ?? 0,
  );
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const offset = Math.max(0, query.offset ?? 0);
  const rows = db
    .prepare(`SELECT * FROM admin_audit_log ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as SqlRow[];
  return { entries: rows.map(rowToAudit), total };
}

/** Fetch one audit entry by id (detail drawer). */
export function getAuditEntry(id: number): AdminAuditRow | null {
  const row = getDb().prepare("SELECT * FROM admin_audit_log WHERE id = ? LIMIT 1").get(id) as SqlRow | undefined;
  return row === undefined ? null : rowToAudit(row);
}

// ---- server_settings key-value helpers ----

export interface ServerSettings {
  expRate: number;
  dropRate: number;
  honorRate: number;
  maxConcurrentPlayers: number;
  levelCap: number;
  /** Raw rows with updater metadata, for the settings screen. */
  meta: { key: string; value: string; updatedBy: string; updatedAt: string }[];
}

const SETTING_KEYS = ["exp_rate", "drop_rate", "honor_rate", "max_concurrent_players", "level_cap"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

// ---- Roles & permissions (spec §70–71) ----

/** Panel capability keys checked by admin handlers. */
export type AdminPermission =
  | "view_players"
  | "ban_player"
  | "edit_inventory"
  | "edit_items"
  | "edit_quests"
  | "publish_quests"
  | "publish_quests_limited"
  | "server_settings"
  | "server_settings_limited"
  | "edit_market"
  | "manage_roles";

export const ALL_PERMISSIONS: AdminPermission[] = [
  "view_players",
  "ban_player",
  "edit_inventory",
  "edit_items",
  "edit_quests",
  "publish_quests",
  "publish_quests_limited",
  "server_settings",
  "server_settings_limited",
  "edit_market",
  "manage_roles",
];

export interface AdminRoleRow {
  roleKey: string;
  displayName: string;
  description: string;
  minTier: AdminTier;
  isSystem: boolean;
  permissions: AdminPermission[];
  assignedCount: number;
}

function rowToRole(row: SqlRow, permissions: AdminPermission[], assignedCount: number): AdminRoleRow {
  return {
    roleKey: String(row.role_key ?? ""),
    displayName: String(row.display_name ?? ""),
    description: String(row.description ?? ""),
    minTier: String(row.min_tier ?? "support") as AdminTier,
    isSystem: Number(row.is_system ?? 0) === 1,
    permissions,
    assignedCount,
  };
}

/** All roles with their permission sets (spec §70–71). */
export function listAdminRoles(): AdminRoleRow[] {
  const db = getDb();
  const roleRows = db.prepare("SELECT * FROM admin_roles ORDER BY id ASC").all() as SqlRow[];
  const permStmt = db.prepare("SELECT permission FROM admin_role_permissions WHERE role_key = ? ORDER BY permission ASC");
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM admin_role_assignments WHERE role_key = ?");
  return roleRows.map((row) => {
    const key = String(row.role_key ?? "");
    const permissions = (permStmt.all(key) as SqlRow[]).map((p) => String(p.permission) as AdminPermission);
    const assignedCount = Number((countStmt.get(key) as SqlRow).n ?? 0);
    return rowToRole(row, permissions, assignedCount);
  });
}

/** Permissions held by one role. */
export function getRolePermissions(roleKey: string): AdminPermission[] {
  return (getDb()
    .prepare("SELECT permission FROM admin_role_permissions WHERE role_key = ? ORDER BY permission ASC")
    .all(roleKey) as SqlRow[]).map((p) => String(p.permission) as AdminPermission);
}

/** Roles explicitly assigned to an account (beyond the Hub-tier baseline). */
export function getAssignedRoles(accountId: number): string[] {
  return (getDb()
    .prepare("SELECT role_key FROM admin_role_assignments WHERE account_id = ? ORDER BY role_key ASC")
    .all(accountId) as SqlRow[]).map((r) => String(r.role_key));
}

/** Assign or remove one role for an account. Caller audits. */
export function setRoleAssignment(accountId: number, roleKey: string, assigned: boolean, assignedBy: string): void {
  if (assigned) {
    getDb()
      .prepare(
        `INSERT INTO admin_role_assignments (account_id, role_key, assigned_by) VALUES (?, ?, ?)
         ON CONFLICT(account_id, role_key) DO UPDATE SET assigned_by = excluded.assigned_by, assigned_at = CURRENT_TIMESTAMP`,
      )
      .run(accountId, roleKey, assignedBy);
  } else {
    getDb().prepare("DELETE FROM admin_role_assignments WHERE account_id = ? AND role_key = ?").run(accountId, roleKey);
  }
}

/**
 * Effective permission check: the Hub-derived tier grants baseline wildcard
 * access (developer = everything), and explicit role assignments add on top —
 * a developer-assigned role can extend, never restrict, Hub-tier access.
 */
export function actorHasPermission(actor: AdminActor, permission: AdminPermission): boolean {
  // Developer tier keeps its spec "full access" baseline even without roles.
  if (actor.tier === "developer") return true;
  const roleKeys = getAssignedRoles(actor.accountId);
  if (roleKeys.length === 0) {
    // No explicit assignments: fall back to tier-based defaults so the panel
    // keeps working for Hub-role admins before anyone curates the matrix.
    return tierHasPermission(actor.tier, permission);
  }
  const permStmt = getDb().prepare(
    "SELECT 1 FROM admin_role_permissions p JOIN admin_role_assignments a ON a.role_key = p.role_key WHERE a.account_id = ? AND p.permission = ? LIMIT 1",
  );
  return permStmt.get(actor.accountId, permission) !== undefined;
}

/** Tier-based default permissions (used when an account has no role rows). */
export function tierHasPermission(tier: AdminTier, permission: AdminPermission): boolean {
  const order = TIER_ORDER.indexOf(tier);
  switch (permission) {
    case "view_players":
    case "edit_inventory":
      return order >= TIER_ORDER.indexOf("support");
    case "ban_player":
      return order >= TIER_ORDER.indexOf("moderator");
    case "server_settings":
    case "manage_roles":
      return order >= TIER_ORDER.indexOf("admin");
    case "server_settings_limited":
    case "publish_quests_limited":
    case "edit_market":
      return order >= TIER_ORDER.indexOf("support");
    case "edit_quests":
    case "publish_quests":
    case "edit_items":
      return order >= TIER_ORDER.indexOf("admin");
  }
}

/** Replace one role's permission set. Caller validates keys and audits. */
export function setRolePermissions(roleKey: string, permissions: AdminPermission[]): void {
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM admin_role_permissions WHERE role_key = ?").run(roleKey);
    const insert = db.prepare("INSERT INTO admin_role_permissions (role_key, permission) VALUES (?, ?)");
    for (const permission of new Set(permissions)) insert.run(roleKey, permission);
    db.prepare("UPDATE admin_roles SET updated_at = ? WHERE role_key = ?").run(new Date().toISOString(), roleKey);
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original failure */ }
    throw err;
  }
}

/** Admin-role model error reasons. */
export type RoleMutationResult =
  | { ok: true }
  | { ok: false; reason: "ROLE_NOT_FOUND" | "SYSTEM_ROLE_LOCKED" | "INVALID_PERMISSION" | "LAST_MANAGE_ROLES" };

/** Update a role's permission set with guardrails (spec §70: defaults exist). */
export function updateRolePermissions(roleKey: string, permissions: AdminPermission[]): RoleMutationResult {
  const db = getDb();
  const role = db.prepare("SELECT is_system FROM admin_roles WHERE role_key = ? LIMIT 1").get(roleKey) as SqlRow | undefined;
  if (role === undefined) return { ok: false, reason: "ROLE_NOT_FOUND" };
  // Guardrail: the last role holding manage_roles can never lose it, so the
  // panel can never lock out role administration.
  if (!permissions.includes("manage_roles")) {
    const holders = db.prepare(
      "SELECT COUNT(DISTINCT p.role_key) AS n FROM admin_role_permissions p WHERE p.permission = 'manage_roles'",
    ).get() as SqlRow;
    if (Number(holders.n ?? 0) <= 1) return { ok: false, reason: "LAST_MANAGE_ROLES" };
  }
  setRolePermissions(roleKey, permissions);
  return { ok: true };
}

/** Environment label stamped into every audit row. */
function serverEnvLabel(): string {
  return serverConfig.nodeEnv;
}

/** Read all server settings (numeric + raw metadata). */
export function getServerSettings(): ServerSettings {
  const rows = getDb()
    .prepare("SELECT `key`, `value`, updated_by, updated_at FROM server_settings")
    .all() as SqlRow[];
  const values = new Map(rows.map((r) => [String(r.key), String(r.value)]));
  const num = (key: SettingKey, fallback: number): number => {
    const parsed = Number(values.get(key));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    expRate: num("exp_rate", 1),
    dropRate: num("drop_rate", 1),
    honorRate: num("honor_rate", 1),
    maxConcurrentPlayers: num("max_concurrent_players", 500),
    levelCap: num("level_cap", 30),
    meta: rows.map((r) => ({
      key: String(r.key),
      value: String(r.value),
      updatedBy: String(r.updated_by ?? "system"),
      updatedAt: String(r.updated_at ?? ""),
    })),
  };
}

/** Validate + normalize one setting value. Returns null when invalid. */
export function validateSettingValue(key: SettingKey, value: string): string | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  switch (key) {
    case "exp_rate":
    case "drop_rate":
    case "honor_rate":
      return parsed >= 0 && parsed <= 100 ? String(parsed) : null;
    case "max_concurrent_players":
      return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100_000 ? String(parsed) : null;
    case "level_cap":
      return Number.isInteger(parsed) && parsed >= 1 && parsed <= 999 ? String(parsed) : null;
  }
}

/** Upsert one setting. Caller validates and audits. */
export function setServerSetting(key: SettingKey, value: string, updatedBy: string): void {
  getDb()
    .prepare(
      `INSERT INTO server_settings (\`key\`, \`value\`, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(\`key\`) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(key, value, updatedBy, new Date().toISOString());
  // Gameplay reads rates through a TTL cache — refresh it immediately so a
  // panel change takes effect on the very next kill/loot/quest reward.
  refreshGameplayRates();
}
