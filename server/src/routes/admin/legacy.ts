import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { server as serverConfig } from "../../config/index.ts";
import { requireAccount } from "../../middleware/auth.ts";
import { errorResponse, jsonResponse } from "../../middleware/index.ts";
import { logger } from "../../middleware/logger.ts";
import {
  adminTierForRole,
  getAuditEntry,
  getRolePermissions,
  getServerSettings,
  listAdminRoles,
  getAssignedRoles,
  setRoleAssignment,
  updateRolePermissions,
  actorHasPermission,
  tierHasPermission,
  ALL_PERMISSIONS,
  listAuditEntries,
  setServerSetting,
  tierSatisfies,
  validateSettingValue,
  writeAuditLog,
  type AdminActor,
  type AdminPermission,
  type AdminTier,
  type RoleMutationFailureReason,
  type SettingKey,
} from "../../models/Admin.ts";
import {
  getCharactersByAccountId,
  getCharacterWithClass,
  getCharacterProfile,
  grantExperience,
  grantInventoryItems,
  updateCharacterPosition,
  getCharacterById,
} from "../../models/Character.ts";
import { auditInventoryEvent, getInventoryState } from "../../models/Equipment.ts";
import {
  COURIER_EFFECT_KEYS,
  EQUIPMENT_SLOTS,
  EQUIPMENT_STAT_KEYS,
  ITEM_CATEGORIES,
  ITEM_RARITIES,
  archiveItem,
  classKeys,
  createItem,
  getItemById,
  getItemReferences,
  listItems,
  restoreItem,
  updateItem,
  validateItemFields,
} from "../../models/ItemCatalog.ts";
import { getDb, pingDb } from "../../db/connection.ts";
import {
  mintStepUpToken,
  verifyStepUpToken,
  type StepUpVerifyResult,
} from "../../auth/adminHardening.ts";

type SqlRow = Record<string, unknown>;

// ---- Accounts model additions live here until Account.ts grows them ----
// (kept local to the admin domain so the player-facing auth path is untouched)

function getAccountById(accountId: number): SqlRow | null {
  return (
    (getDb().prepare(
      "SELECT id, username, email, display_name, role, ashat_user_id, status, created_at, updated_at, last_login_at FROM accounts WHERE id = ? LIMIT 1",
    ).get(accountId) as SqlRow | undefined) ?? null
  );
}

interface AccountStatusRow extends SqlRow {
  id: number;
  username: string;
  status: string;
}

function setAccountStatus(accountId: number, status: "active" | "suspended" | "banned"): void {
  getDb()
    .prepare("UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), accountId);
}

/** Player list row for the admin players table. */
interface AdminPlayerRow {
  accountId: number;
  username: string;
  displayName: string;
  role: string;
  status: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  characters: {
    id: number;
    name: string;
    level: number;
    zoneId: string;
    classKey: string;
    stamps: number;
    experience: number;
  }[];
}

interface PlayerQuery {
  search?: string;
  status?: string;
  zoneId?: string;
  levelMin?: number;
  levelMax?: number;
  limit?: number;
  offset?: number;
}

/** Search accounts + characters with filters (spec §17). */
function searchPlayers(query: PlayerQuery): { players: AdminPlayerRow[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (query.search !== undefined && query.search !== "") {
    conditions.push("(a.username LIKE ? OR a.display_name LIKE ? OR c.name LIKE ?)");
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }
  if (query.status !== undefined && query.status !== "") {
    conditions.push("a.status = ?");
    params.push(query.status);
  }
  if (query.zoneId !== undefined && query.zoneId !== "") {
    conditions.push("c.zone_id = ?");
    params.push(query.zoneId);
  }
  if (query.levelMin !== undefined) {
    conditions.push("c.level >= ?");
    params.push(query.levelMin);
  }
  if (query.levelMax !== undefined) {
    conditions.push("c.level <= ?");
    params.push(query.levelMax);
  }
  // Group by account because filters span account (status) + character
  // (zone/level/search) columns; a character match keeps the whole account.
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  // Group-by filters span account (status) + character (zone/level) columns;
  // count distinct accounts so pagination stays stable.
  const totalRows = Number(
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT a.id) AS n FROM accounts a
           LEFT JOIN characters c ON c.account_id = a.id ${where}`,
        )
        .get(...params) as SqlRow
    ).n ?? 0,
  );
  const limit = Math.min(Math.max(1, query.limit ?? 25), 100);
  const offset = Math.max(0, query.offset ?? 0);
  const accountRows = db
    .prepare(
      `SELECT a.id, a.username, a.display_name, a.role, a.status, a.created_at, a.last_login_at
       FROM accounts a
       LEFT JOIN characters c ON c.account_id = a.id
       ${where}
       GROUP BY a.id
       ORDER BY a.username ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as SqlRow[];
  const charStmt = db.prepare(
    `SELECT c.id, c.name, c.level, c.zone_id, c.experience, c.stamps, cc.\`key\` AS class_key
     FROM characters c JOIN character_classes cc ON cc.id = c.class_id WHERE c.account_id = ? ORDER BY c.id ASC`,
  );
  const players = accountRows.map((row) => {
    const accountId = Number(row.id);
    const chars = charStmt.all(accountId) as SqlRow[];
    return {
      accountId,
      username: String(row.username ?? ""),
      displayName: String(row.display_name ?? ""),
      role: String(row.role ?? ""),
      status: String(row.status ?? "active"),
      createdAt: row.created_at === null || row.created_at === undefined ? null : String(row.created_at),
      lastLoginAt: row.last_login_at === null || row.last_login_at === undefined ? null : String(row.last_login_at),
      characters: chars.map((c) => ({
        id: Number(c.id),
        name: String(c.name ?? ""),
        level: Number(c.level ?? 1),
        zoneId: String(c.zone_id ?? ""),
        classKey: String(c.class_key ?? ""),
        stamps: Number(c.stamps ?? 0),
        experience: Number(c.experience ?? 0),
      })),
    };
  });
  return { players, total: totalRows };
}

/** Build the actor context for the request, or write the error and return null. */
async function resolveActor(
  req: IncomingMessage,
  res: ServerResponse,
  requiredTier: AdminTier,
): Promise<AdminActor | null> {
  const account = await requireAccount(req, res);
  if (account === null) return null;
  const tier = adminTierForRole(account.role);
  if (!tierSatisfies(tier, requiredTier)) {
    errorResponse(res, 403, "ADMIN_REQUIRED", `Admin tier "${requiredTier}" required`);
    return null;
  }
  return {
    accountId: account.id,
    username: account.username,
    displayName: account.display_name,
    role: account.role,
    tier,
  };
}

/**
 * Level 3 step-up gate (spec §72): dangerous operations must present a valid,
 * single-use step-up token minted within the last few minutes. The token is
 * consumed on use — one Level 3 action per re-confirmation.
 */
function requireStepUp(req: IncomingMessage, actor: AdminActor, res: ServerResponse): boolean {
  const header = req.headers["x-admin-step-up"];
  const token = typeof header === "string" ? header.trim() : "";
  if (token === "") {
    errorResponse(res, 401, "STEP_UP_REQUIRED", "Re-confirmation required — POST /api/admin/step-up first, then send X-Admin-Step-Up");
    return false;
  }
  const verdict: StepUpVerifyResult = verifyStepUpToken(token, actor.accountId);
  if (!verdict.ok) {
    const status = verdict.reason === "EXPIRED" ? 401 : 403;
    errorResponse(res, status, `STEP_UP_${verdict.reason}`, `Step-up token rejected (${verdict.reason})`);
    return false;
  }
  return true;
}

// ---- POST /api/admin/step-up — mint a short-TTL action token ----

export async function adminStepUpHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const actor = await resolveActor(req, res, "support");
  if (actor === null) return;
  const body = bodyOf(req);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3) {
    errorResponse(res, 400, "REASON_REQUIRED", "State the operation you are about to perform (min 3 characters)");
    return;
  }
  const { token, expiresAt } = mintStepUpToken(actor.accountId);
  writeAuditLog(actor, {
    action: "step_up_issued",
    category: "security",
    targetType: "session",
    targetId: actor.username,
    reason: `Step-up for: ${reason}`,
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  logger.info("Admin step-up token issued", { admin: actor.username, expiresAt });
  jsonResponse(res, 200, { token, expiresAt, ttlSeconds: Math.round((expiresAt - Date.now()) / 1000) });
}

/**
 * Resolve the actor then check a fine-grained permission (spec §71 matrix).
 * Tier gates remain the coarse baseline; this adds the per-role layer.
 */
async function resolveActorWithPermission(
  req: IncomingMessage,
  res: ServerResponse,
  requiredTier: AdminTier,
  permission: AdminPermission,
): Promise<AdminActor | null> {
  const actor = await resolveActor(req, res, requiredTier);
  if (actor === null) return null;
  if (!actorHasPermission(actor, permission)) {
    errorResponse(res, 403, "PERMISSION_DENIED", `Permission "${permission}" required`);
    return null;
  }
  return actor;
}

function requestIdOf(req: IncomingMessage): string {
  return String(req.headers["x-request-id"] ?? randomUUID().slice(0, 8)).slice(0, 16);
}

function ipOf(req: IncomingMessage): string {
  return String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "").split(",")[0].trim().slice(0, 64);
}

/** Parse a positive-int body/query field. */
function intField(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Coerce a query param to an integer or undefined. */
function intParam(params: Record<string, string> | undefined, name: string): number | undefined {
  return params === undefined ? undefined : intField(params[name]);
}

function bodyOf(req: IncomingMessage): Record<string, unknown> {
  const body = (req as unknown as { body?: unknown }).body;
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

// ---- GET /api/admin/overview ----

export async function adminOverviewHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const actor = await resolveActor(req, res, "support");
  if (actor === null) return;
  const db = getDb();
  const registered = Number((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as SqlRow).n ?? 0);
  const characters = Number((db.prepare("SELECT COUNT(*) AS n FROM characters").get() as SqlRow).n ?? 0);
  const settings = getServerSettings();
  const dbUp = await pingDb();
  jsonResponse(res, 200, {
    playersOnline: serverRuntime.onlineCount(),
    maxConcurrentPlayers: settings.maxConcurrentPlayers,
    registeredPlayers: registered,
    characters,
    expRate: settings.expRate,
    dropRate: settings.dropRate,
    honorRate: settings.honorRate,
    levelCap: settings.levelCap,
    environment: { nodeEnv: serverConfig.nodeEnv, runningInProduction: !serverConfig.isDev },
    serverStatus: dbUp ? "ONLINE" : "DEGRADED",
  });
}

// ---- Runtime bridge: set by index.ts so the panel can query the GameServer ----
// (functions below read live WS state without a circular import)

export interface AdminRuntime {
  onlineCount(): number;
  zonePlayerCounts(): Record<string, number>;
  disconnectCharacter(characterId: number): number;
  aiEnabled: boolean;
  staticDirPresent: boolean;
}

let serverRuntime: AdminRuntime = {
  onlineCount: () => 0,
  zonePlayerCounts: () => ({}),
  disconnectCharacter: () => 0,
  aiEnabled: false,
  staticDirPresent: false,
};

/** Called from index.ts at boot so handlers can read live WS state. */
export function setAdminRuntime(runtime: AdminRuntime): void {
  serverRuntime = runtime;
}

function serverEnv(): string {
  return serverConfig.isDev ? "development" : serverConfig.nodeEnv;
}

// ---- GET /api/admin/health ----

export async function adminHealthHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const actor = await resolveActor(req, res, "support");
  if (actor === null) return;
  const dbUp = await pingDb();
  const services = [
    { name: "Database", status: dbUp ? "Healthy" : "Offline" },
    { name: "Game Server", status: serverRuntime.onlineCount() >= 0 ? "Healthy" : "Degraded" },
    { name: "Authentication", status: dbUp ? "Healthy" : "Degraded" },
    { name: "Market Service", status: "Offline", note: "not built yet (Phase 5)" },
    { name: "LiveOps Service", status: "Offline", note: "not built yet (Phase 6)" },
    {
      name: "AI Game Engine",
      status: serverRuntime.aiEnabled ? "Healthy" : "Offline",
      note: serverRuntime.aiEnabled ? undefined : "disabled in server_config.json",
    },
  ];
  jsonResponse(res, 200, { services, environment: serverEnv() });
}

// ---- GET /api/admin/zones/status ----

export async function adminZoneStatusHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const actor = await resolveActor(req, res, "support");
  if (actor === null) return;
  const db = getDb();
  const zones = db
    .prepare("SELECT `key`, display_name, kind, max_players, is_safe FROM zones ORDER BY `key` ASC")
    .all() as SqlRow[];
  const counts = serverRuntime.zonePlayerCounts();
  jsonResponse(res, 200, {
    zones: zones.map((z) => ({
      key: String(z.key),
      name: String(z.display_name),
      kind: String(z.kind),
      maxPlayers: Number(z.max_players ?? 0),
      isSafe: Number(z.is_safe ?? 0) === 1,
      playersOnline: counts[String(z.key)] ?? 0,
    })),
  });
}

// ---- GET /api/admin/players ----

export async function adminPlayersHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  void params;
  const actor = await resolveActorWithPermission(req, res, "support", "view_players");
  if (actor === null) return;
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const levelMinRaw = url.searchParams.get("levelMin");
  const levelMaxRaw = url.searchParams.get("levelMax");
  const result = searchPlayers({
    search: url.searchParams.get("search") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    zoneId: url.searchParams.get("zone") ?? undefined,
    levelMin: levelMinRaw !== null && levelMinRaw !== "" ? Number(levelMinRaw) : undefined,
    levelMax: levelMaxRaw !== null && levelMaxRaw !== "" ? Number(levelMaxRaw) : undefined,
    limit: intField(url.searchParams.get("limit")),
    offset: intField(url.searchParams.get("offset")),
  });
  jsonResponse(res, 200, result);
}

// ---- GET /api/admin/players/:accountId ----

interface CharacterSummary {
  id: number;
  name: string;
  level: number;
  zoneId: string;
  classKey: string;
}

/** Load one admin player: account + characters + recent admin history. */
async function loadAdminPlayer(accountId: number): Promise<AdminPlayerRow & { email: string | null; adminHistory: { id: number; action: string; reason: string; createdAt: string }[] } | null> {
  const account = getAccountById(accountId);
  if (account === null) return null;
  const chars = await getCharactersByAccountId(accountId);
  const summaries: (AdminPlayerRow["characters"][number])[] = chars.map((c) => ({
    id: c.id,
    name: c.name,
    level: c.level,
    zoneId: c.zone_id,
    classKey: "",
    stamps: 0,
    experience: 0,
  }));
  const history = (
    getDb()
      .prepare(
        "SELECT id, action, reason, created_at FROM admin_audit_log WHERE target_type = 'account' AND target_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
      )
      .all(String(accountId)) as SqlRow[]
  ).map((r) => ({
    id: Number(r.id),
    action: String(r.action ?? ""),
    reason: String(r.reason ?? ""),
    createdAt: String(r.created_at ?? ""),
  }));
  return {
    accountId,
    username: String(account.username ?? ""),
    displayName: String(account.display_name ?? ""),
    role: String(account.role ?? ""),
    status: String(account.status ?? "active"),
    email: account.email === null || account.email === undefined ? null : String(account.email),
    createdAt: account.created_at === null || account.created_at === undefined ? null : String(account.created_at),
    lastLoginAt: account.last_login_at === null || account.last_login_at === undefined ? null : String(account.last_login_at),
    characters: summaries,
    adminHistory: history,
  };
}

export async function adminPlayerDetailHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActorWithPermission(req, res, "support", "view_players");
  if (actor === null) return;
  const accountId = intParam(params, "accountId");
  if (accountId === undefined) {
    errorResponse(res, 400, "INVALID_ACCOUNT_ID", "accountId must be a positive integer");
    return;
  }
  const player = await loadAdminPlayer(accountId);
  if (player === null) {
    errorResponse(res, 404, "PLAYER_NOT_FOUND", "No account with that id");
    return;
  }
  // Enrich characters with class keys (loadAdminPlayer leaves them blank).
  const db = getDb();
  const classStmt = db.prepare(
    "SELECT cc.`key` AS class_key FROM characters c JOIN character_classes cc ON cc.id = c.class_id WHERE c.id = ?",
  );
  for (const ch of player.characters) {
    const row = classStmt.get(ch.id) as SqlRow | undefined;
    if (row !== undefined) ch.classKey = String(row.class_key ?? "");
  }
  jsonResponse(res, 200, { player });
}

// ---- POST /api/admin/players/:accountId/status (suspend/ban/reactivate) ----

export async function adminPlayerStatusHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActorWithPermission(req, res, "moderator", "ban_player");
  if (actor === null) return;
  const accountId = intParam(params, "accountId");
  if (accountId === undefined) {
    errorResponse(res, 400, "INVALID_ACCOUNT_ID", "accountId must be a positive integer");
    return;
  }
  const body = bodyOf(req);
  const status = body.status;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const confirm = typeof body.confirm === "string" ? body.confirm.trim() : "";
  if (status !== "active" && status !== "suspended" && status !== "banned") {
    errorResponse(res, 400, "INVALID_STATUS", "status must be active, suspended, or banned");
    return;
  }
  // Level 3 (spec §72): suspend/ban always demand a fresh step-up token.
  if (status !== "active" && !requireStepUp(req, actor, res)) return;
  if (reason.length < 3) {
    errorResponse(res, 400, "REASON_REQUIRED", "A reason of at least 3 characters is required");
    return;
  }
  const account = getAccountById(accountId) as AccountStatusRow | null;
  if (account === null) {
    errorResponse(res, 404, "PLAYER_NOT_FOUND", "No account with that id");
    return;
  }
  if (status === "banned" && confirm !== `BAN ${account.username}`) {
    errorResponse(res, 400, "CONFIRMATION_REQUIRED", `Type "BAN ${account.username}" to confirm`);
    return;
  }
  if (status === "suspended" && confirm !== `SUSPEND ${account.username}`) {
    errorResponse(res, 400, "CONFIRMATION_REQUIRED", `Type "SUSPEND ${account.username}" to confirm`);
    return;
  }
  const before = { status: String(account.status ?? "active") };
  setAccountStatus(accountId, status);
  // Disconnect + lock out live sessions immediately.
  const chars = (await getCharactersByAccountId(accountId)) ?? [];
  for (const ch of chars) serverRuntime.disconnectCharacter(ch.id);
  writeAuditLog(actor, {
    action: status === "active" ? "account_reactivated" : status === "suspended" ? "account_suspended" : "account_banned",
    category: "moderation",
    targetType: "account",
    targetId: String(accountId),
    targetLabel: account.username,
    reason,
    beforeState: before,
    afterState: { status },
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  jsonResponse(res, 200, { ok: true, status });
}

// ---- POST /api/admin/players/:accountId/grant-item ----

export async function adminGrantItemHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActorWithPermission(req, res, "support", "edit_inventory");
  if (actor === null) return;
  const accountId = intParam(params, "accountId");
  if (accountId === undefined) {
    errorResponse(res, 400, "INVALID_ACCOUNT_ID", "accountId must be a positive integer");
    return;
  }
  const body = bodyOf(req);
  const characterId = intField(body.characterId);
  const itemKey = typeof body.itemKey === "string" ? body.itemKey.trim() : "";
  const quantity = intField(body.quantity);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (characterId === undefined || itemKey === "" || quantity === undefined || reason.length < 3) {
    errorResponse(res, 400, "INVALID_REQUEST", "characterId, itemKey, quantity (>0), and reason (3+ chars) are required");
    return;
  }
  const character = await getCharacterById(characterId);
  if (character === null || character.account_id !== accountId) {
    errorResponse(res, 404, "CHARACTER_NOT_FOUND", "No such character on this account");
    return;
  }
  const def = getDb()
    .prepare("SELECT id, name, max_stack, is_deleted FROM item_definitions WHERE key = ? LIMIT 1")
    .get(itemKey) as SqlRow | undefined;
  if (def === undefined) {
    errorResponse(res, 404, "ITEM_NOT_FOUND", `No item with key "${itemKey}"`);
    return;
  }
  if (Number(def.is_deleted ?? 0) === 1) {
    errorResponse(res, 409, "ITEM_ARCHIVED", `"${String(def.name ?? itemKey)}" is archived — restore it in the Item Editor first`);
    return;
  }
  await grantInventoryItems(characterId, [{ itemKey, quantity }]);
  writeAuditLog(actor, {
    action: "item_granted",
    category: "economy",
    targetType: "character",
    targetId: String(characterId),
    targetLabel: character.name,
    reason,
    afterState: { itemKey, itemName: String(def.name ?? ""), quantity },
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  jsonResponse(res, 200, { ok: true, itemKey, quantity });
}

// ---- POST /api/admin/players/:accountId/adjust ----

export async function adminAdjustHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActorWithPermission(req, res, "support", "edit_inventory");
  if (actor === null) return;
  const accountId = intParam(params, "accountId");
  if (accountId === undefined) {
    errorResponse(res, 400, "INVALID_ACCOUNT_ID", "accountId must be a positive integer");
    return;
  }
  const body = bodyOf(req);
  const characterId = intField(body.characterId);
  const kind = body.kind;
  const deltaRaw = Number(body.delta);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (characterId === undefined || reason.length < 3) {
    errorResponse(res, 400, "INVALID_REQUEST", "characterId and reason (3+ chars) are required");
    return;
  }
  if (kind !== "experience" && kind !== "stamps") {
    errorResponse(res, 400, "INVALID_KIND", "kind must be experience or stamps");
    return;
  }
  if (!Number.isFinite(deltaRaw) || deltaRaw === 0 || Math.abs(deltaRaw) > 1_000_000) {
    errorResponse(res, 400, "INVALID_DELTA", "delta must be a non-zero finite number within ±1,000,000");
    return;
  }
  const character = await getCharacterById(characterId);
  if (character === null || character.account_id !== accountId) {
    errorResponse(res, 404, "CHARACTER_NOT_FOUND", "No such character on this account");
    return;
  }
  if (kind === "experience") {
    const expRow = () => getDb().prepare("SELECT experience, level FROM characters WHERE id = ?").get(characterId) as SqlRow | undefined;
    const beforeRow = expRow();
    await grantExperience(characterId, Math.round(deltaRaw));
    const afterRow = expRow();
    writeAuditLog(actor, {
      action: "experience_adjusted",
      category: "economy",
      targetType: "character",
      targetId: String(characterId),
      targetLabel: character.name,
      reason,
      beforeState: beforeRow === undefined ? null : { experience: Number(beforeRow.experience ?? 0), level: Number(beforeRow.level ?? 1) },
      afterState: afterRow === undefined ? null : { experience: Number(afterRow.experience ?? 0), level: Number(afterRow.level ?? 1) },
      requestId: requestIdOf(req),
      ip: ipOf(req),
    });
    const profile = await getCharacterProfile(characterId);
    jsonResponse(res, 200, { ok: true, level: profile?.character.level ?? null, experience: profile?.character.experience ?? null });
    return;
  }
  // Stamps: clamp at zero, audit the exact delta.
  const db = getDb();
  const row = db.prepare("SELECT stamps FROM characters WHERE id = ?").get(characterId) as SqlRow | undefined;
  if (row === undefined) {
    errorResponse(res, 404, "CHARACTER_NOT_FOUND", "No such character on this account");
    return;
  }
  const beforeStamps = Number(row.stamps ?? 0);
  const afterStamps = Math.max(0, beforeStamps + Math.round(deltaRaw));
  db.prepare("UPDATE characters SET stamps = ?, updated_at = ? WHERE id = ?").run(afterStamps, new Date().toISOString(), characterId);
  writeAuditLog(actor, {
    action: "stamps_adjusted",
    category: "economy",
    targetType: "character",
    targetId: String(characterId),
    targetLabel: character.name,
    reason,
    beforeState: { stamps: beforeStamps },
    afterState: { stamps: afterStamps, delta: Math.round(deltaRaw) },
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  jsonResponse(res, 200, { ok: true, stamps: afterStamps });
}

// ---- POST /api/admin/players/:accountId/teleport ----

export async function adminTeleportHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActor(req, res, "moderator");
  if (actor === null) return;
  const accountId = intParam(params, "accountId");
  if (accountId === undefined) {
    errorResponse(res, 400, "INVALID_ACCOUNT_ID", "accountId must be a positive integer");
    return;
  }
  const body = bodyOf(req);
  const characterId = intField(body.characterId);
  const zoneKey = typeof body.zoneId === "string" ? body.zoneId.trim() : "";
  const x = Number(body.x);
  const y = Number(body.y);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (characterId === undefined || zoneKey === "" || !Number.isFinite(x) || !Number.isFinite(y) || reason.length < 3) {
    errorResponse(res, 400, "INVALID_REQUEST", "characterId, zoneId, numeric x/y, and reason (3+ chars) are required");
    return;
  }
  const zone = getDb().prepare("SELECT `key`, display_name FROM zones WHERE `key` = ? LIMIT 1").get(zoneKey) as SqlRow | undefined;
  if (zone === undefined) {
    errorResponse(res, 404, "ZONE_NOT_FOUND", `No zone with key "${zoneKey}"`);
    return;
  }
  const character = await getCharacterById(characterId);
  if (character === null || character.account_id !== accountId) {
    errorResponse(res, 404, "CHARACTER_NOT_FOUND", "No such character on this account");
    return;
  }
  const before = { zoneId: character.zone_id, x: character.pos_x, y: character.pos_y };
  // Disconnect first so the WS session reloads the new position on next join.
  serverRuntime.disconnectCharacter(characterId);
  await updateCharacterPosition(characterId, zoneKey, Math.round(x), Math.round(y));
  writeAuditLog(actor, {
    action: "player_teleported",
    category: "moderation",
    targetType: "character",
    targetId: String(characterId),
    targetLabel: character.name,
    reason,
    beforeState: before,
    afterState: { zoneId: zoneKey, x: Math.round(x), y: Math.round(y) },
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  jsonResponse(res, 200, { ok: true });
}

// ---- POST /api/admin/players/:accountId/kick ----

export async function adminKickHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActor(req, res, "moderator");
  if (actor === null) return;
  const accountId = intParam(params, "accountId");
  if (accountId === undefined) {
    errorResponse(res, 400, "INVALID_ACCOUNT_ID", "accountId must be a positive integer");
    return;
  }
  const body = bodyOf(req);
  const characterId = intField(body.characterId);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (characterId === undefined || reason.length < 3) {
    errorResponse(res, 400, "INVALID_REQUEST", "characterId and reason (3+ chars) are required");
    return;
  }
  const character = await getCharacterById(characterId);
  if (character === null || character.account_id !== accountId) {
    errorResponse(res, 404, "CHARACTER_NOT_FOUND", "No such character on this account");
    return;
  }
  const sessions = serverRuntime.disconnectCharacter(characterId);
  writeAuditLog(actor, {
    action: "player_kicked",
    category: "moderation",
    targetType: "character",
    targetId: String(characterId),
    targetLabel: character.name,
    reason,
    afterState: { sessionsDisconnected: sessions },
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  jsonResponse(res, 200, { ok: true, sessionsDisconnected: sessions });
}

// ---- Inventory mutation: POST /api/admin/inventory/:instanceId ----

export async function adminInventoryHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActorWithPermission(req, res, "support", "edit_inventory");
  if (actor === null) return;
  const instanceId = intParam(params, "instanceId");
  if (instanceId === undefined) {
    errorResponse(res, 400, "INVALID_INSTANCE_ID", "instanceId must be a positive integer");
    return;
  }
  const body = bodyOf(req);
  const op = body.op;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3) {
    errorResponse(res, 400, "REASON_REQUIRED", "A reason of at least 3 characters is required");
    return;
  }
  const row = getDb()
    .prepare(
      `SELECT ii.id, ii.character_id, ii.quantity, ii.item_definition_id, c.account_id, c.name AS character_name,
              idef.name AS item_name, idef.\`key\` AS item_key
       FROM inventory_items ii
       JOIN characters c ON c.id = ii.character_id
       JOIN item_definitions idef ON idef.id = ii.item_definition_id
       WHERE ii.id = ? LIMIT 1`,
    )
    .get(instanceId) as SqlRow | undefined;
  if (row === undefined) {
    errorResponse(res, 404, "ITEM_NOT_FOUND", "No inventory item with that instance id");
    return;
  }
  const before = { quantity: Number(row.quantity ?? 0) };
  if (op === "set-quantity") {
    const quantity = intField(body.quantity);
    if (quantity === undefined || quantity < 1) {
      errorResponse(res, 400, "INVALID_QUANTITY", "quantity must be a positive integer");
      return;
    }
    getDb().prepare("UPDATE inventory_items SET quantity = ? WHERE id = ?").run(quantity, instanceId);
    auditInventoryEvent(Number(row.character_id), "admin_quantity_change", instanceId, quantity - before.quantity, reason);
    writeAuditLog(actor, {
      action: "inventory_quantity_changed",
      category: "economy",
      targetType: "character",
      targetId: String(row.character_id),
      targetLabel: String(row.character_name ?? ""),
      reason,
      beforeState: before,
      afterState: { quantity, itemKey: row.item_key },
      requestId: requestIdOf(req),
      ip: ipOf(req),
    });
    const inventory = getInventoryState(Number(row.character_id));
    jsonResponse(res, 200, { ok: true, inventory });
    return;
  }
  if (op === "remove") {
    getDb().prepare("DELETE FROM inventory_items WHERE id = ?").run(instanceId);
    auditInventoryEvent(Number(row.character_id), "admin_item_remove", instanceId, -before.quantity, reason);
    writeAuditLog(actor, {
      action: "inventory_item_removed",
      category: "economy",
      targetType: "character",
      targetId: String(row.character_id),
      targetLabel: String(row.character_name ?? ""),
      reason,
      beforeState: { ...before, itemKey: row.item_key, itemName: row.item_name },
      afterState: { removed: true },
      requestId: requestIdOf(req),
      ip: ipOf(req),
    });
    const inventory = getInventoryState(Number(row.character_id));
    jsonResponse(res, 200, { ok: true, inventory });
    return;
  }
  errorResponse(res, 400, "INVALID_OP", "op must be set-quantity or remove");
}

// ---- GET /api/admin/audit + /api/admin/audit/:id ----

export async function adminAuditHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActor(req, res, "support");
  if (actor === null) return;
  if (params?.auditId !== undefined) {
    const id = intField(params.auditId);
    if (id === undefined) {
      errorResponse(res, 400, "INVALID_AUDIT_ID", "auditId must be a positive integer");
      return;
    }
    const entry = getAuditEntry(id);
    if (entry === null) {
      errorResponse(res, 404, "AUDIT_NOT_FOUND", "No audit entry with that id");
      return;
    }
    jsonResponse(res, 200, { entry });
    return;
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const result = listAuditEntries({
    category: url.searchParams.get("category") ?? undefined,
    adminAccountId: intField(url.searchParams.get("admin")),
    targetType: url.searchParams.get("targetType") ?? undefined,
    targetId: url.searchParams.get("targetId") ?? undefined,
    limit: intField(url.searchParams.get("limit")),
    offset: intField(url.searchParams.get("offset")),
  });
  jsonResponse(res, 200, result);
}

// ---- GET/PUT /api/admin/settings ----

const SETTING_KEYS = new Set<SettingKey>(["exp_rate", "drop_rate", "honor_rate", "max_concurrent_players", "level_cap"]);

export async function adminSettingsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET") {
    const actor = await resolveActor(req, res, "support");
    if (actor === null) return;
    jsonResponse(res, 200, { settings: getServerSettings() });
    return;
  }
  if (req.method === "PUT") {
    const actor = await resolveActor(req, res, "admin");
    if (actor === null) return;
    const body = bodyOf(req);
    const updates = body.updates;
    if (typeof updates !== "object" || updates === null || Array.isArray(updates)) {
      errorResponse(res, 400, "INVALID_UPDATES", "updates must be an object of { setting: value }");
      return;
    }
    const entries = Object.entries(updates as Record<string, unknown>);
    if (entries.length === 0) {
      errorResponse(res, 400, "EMPTY_UPDATES", "Provide at least one setting to update");
      return;
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3) {
      errorResponse(res, 400, "REASON_REQUIRED", "A reason of at least 3 characters is required");
      return;
    }
    const before = getServerSettings();
    const applied: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (!SETTING_KEYS.has(key as SettingKey)) {
        errorResponse(res, 400, "UNKNOWN_SETTING", `Unknown setting "${key}"`);
        return;
      }
      const validated = validateSettingValue(key as SettingKey, String(value));
      if (validated === null) {
        errorResponse(res, 400, "INVALID_VALUE", `Invalid value for "${key}"`);
        return;
      }
      applied[key] = validated;
    }
    for (const [key, value] of Object.entries(applied)) {
      setServerSetting(key as SettingKey, value, actor.username);
    }
    writeAuditLog(actor, {
      action: "server_settings_updated",
      category: "settings",
      targetType: "settings",
      targetId: Object.keys(applied).join(","),
      reason,
      beforeState: { expRate: before.expRate, dropRate: before.dropRate, honorRate: before.honorRate, maxConcurrentPlayers: before.maxConcurrentPlayers, levelCap: before.levelCap },
      afterState: applied,
      requestId: requestIdOf(req),
      ip: ipOf(req),
    });
    logger.info("Admin settings updated", { admin: actor.username, applied });
    jsonResponse(res, 200, { ok: true, settings: getServerSettings() });
    return;
  }
  errorResponse(res, 405, "METHOD_NOT_ALLOWED", "Use GET or PUT");
}

// ---- GET /api/admin/tier (who am I as an admin) ----

export async function adminTierHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const account = await requireAccount(req, res);
  if (account === null) return;
  const tier = adminTierForRole(account.role);
  jsonResponse(res, 200, {
    tier,
    role: account.role,
    username: account.username,
    displayName: account.display_name,
  });
}

// ---- GET /api/admin/roles — role catalog + permission matrix (spec §70–71) ----

export async function adminRolesHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const actor = await resolveActor(req, res, "support");
  if (actor === null) return;
  jsonResponse(res, 200, {
    roles: listAdminRoles(),
    allPermissions: ALL_PERMISSIONS,
    caller: {
      accountId: actor.accountId,
      username: actor.username,
      tier: actor.tier,
      assignedRoles: getAssignedRoles(actor.accountId),
      canManageRoles: actorHasPermission(actor, "manage_roles"),
    },
  });
}

// ---- PUT /api/admin/roles/:roleKey — replace a role's permission set ----

export async function adminRolePermissionsHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActorWithPermission(req, res, "admin", "manage_roles");
  if (actor === null) return;
  const roleKey = params?.roleKey ?? "";
  const body = bodyOf(req);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3) {
    errorResponse(res, 400, "REASON_REQUIRED", "A reason of at least 3 characters is required");
    return;
  }
  const rawPermissions = body.permissions;
  if (!Array.isArray(rawPermissions)) {
    errorResponse(res, 400, "INVALID_PERMISSIONS", "permissions must be an array of permission keys");
    return;
  }
  const permissions: AdminPermission[] = [];
  for (const raw of rawPermissions) {
    const key = String(raw);
    if (!(ALL_PERMISSIONS as string[]).includes(key)) {
      errorResponse(res, 400, "INVALID_PERMISSION", `Unknown permission "${key}"`);
      return;
    }
    permissions.push(key as AdminPermission);
  }
  const before = getRolePermissions(roleKey);
  const result = updateRolePermissions(roleKey, permissions);
  if (!result.ok) {
    // ROLE_NOT_FOUND → 404, a bad key → 400 (the route pre-validates, so the
    // model only catches callers that bypass HTTP), guardrail refusals → 409.
    const status = result.reason === "ROLE_NOT_FOUND" ? 404 : result.reason === "INVALID_PERMISSION" ? 400 : 409;
    errorResponse(res, status, result.reason, roleMutationMessage(result.reason));
    return;
  }
  writeAuditLog(actor, {
    action: "role_permissions_updated",
    category: "roles",
    targetType: "role",
    targetId: roleKey,
    reason,
    beforeState: { permissions: before },
    afterState: { permissions },
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  logger.info("Admin role permissions updated", { admin: actor.username, roleKey, permissions });
  jsonResponse(res, 200, { ok: true, roleKey, permissions });
}

function roleMutationMessage(reason: RoleMutationFailureReason): string {
  switch (reason) {
    case "ROLE_NOT_FOUND": return "No role with that key";
    case "INVALID_PERMISSION": return "That permission is not recognised";
    case "LAST_MANAGE_ROLES": return "Cannot remove manage_roles from the last role that holds it — the panel would lock itself out";
    default: {
      // Exhaustiveness guard: a new failure reason will not compile until it is
      // handled above and this branch narrows back to `never`.
      const unhandled: never = reason;
      return `Role update rejected (${String(unhandled)})`;
    }
  }
}

// ---- GET/PUT /api/admin/roles/assignments/:accountId — per-account roles ----

function requireManageableTarget(actor: AdminActor, accountId: number, res: ServerResponse): SqlRow | null {
  const account = getAccountById(accountId);
  if (account === null) {
    errorResponse(res, 404, "PLAYER_NOT_FOUND", "No account with that id");
    return null;
  }
  // Guardrail: nobody edits their own roles (self-escalation lockout risk).
  if (Number(account.id) === actor.accountId) {
    errorResponse(res, 403, "SELF_EDIT_FORBIDDEN", "You cannot change your own admin roles");
    return null;
  }
  return account;
}

export async function adminRoleAssignmentsHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  if (req.method === "GET") {
    const actor = await resolveActor(req, res, "admin");
    if (actor === null) return;
    const accountId = intParam(params, "accountId");
    if (accountId === undefined) {
      errorResponse(res, 400, "INVALID_ACCOUNT_ID", "accountId must be a positive integer");
      return;
    }
    const account = getAccountById(accountId);
    if (account === null) {
      errorResponse(res, 404, "PLAYER_NOT_FOUND", "No account with that id");
      return;
    }
    jsonResponse(res, 200, {
      accountId,
      username: String(account.username ?? ""),
      hubRole: String(account.role ?? ""),
      hubTier: adminTierForRole(String(account.role ?? "")),
      assignedRoles: getAssignedRoles(accountId),
    });
    return;
  }
  if (req.method === "PUT") {
    const actor = await resolveActorWithPermission(req, res, "admin", "manage_roles");
    if (actor === null) return;
    const accountId = intParam(params, "accountId");
    if (accountId === undefined) {
      errorResponse(res, 400, "INVALID_ACCOUNT_ID", "accountId must be a positive integer");
      return;
    }
    const account = requireManageableTarget(actor, accountId, res);
    if (account === null) return;
    const body = bodyOf(req);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3) {
      errorResponse(res, 400, "REASON_REQUIRED", "A reason of at least 3 characters is required");
      return;
    }
    const add = typeof body.add === "string" ? body.add.trim() : "";
    const remove = typeof body.remove === "string" ? body.remove.trim() : "";
    if ((add !== "") === (remove !== "")) {
      errorResponse(res, 400, "INVALID_REQUEST", "Provide exactly one of add or remove (role key)");
      return;
    }
    const roleKey = add !== "" ? add : remove;
    const roleRow = getDb().prepare("SELECT display_name FROM admin_roles WHERE role_key = ? LIMIT 1").get(roleKey) as SqlRow | undefined;
    if (roleRow === undefined) {
      errorResponse(res, 404, "ROLE_NOT_FOUND", `No role with key "${roleKey}"`);
      return;
    }
    const before = getAssignedRoles(accountId);
    setRoleAssignment(accountId, roleKey, add !== "", actor.username);
    const after = getAssignedRoles(accountId);
    writeAuditLog(actor, {
      action: add !== "" ? "role_assigned" : "role_unassigned",
      category: "roles",
      targetType: "account",
      targetId: String(accountId),
      targetLabel: String(account.username ?? ""),
      reason,
      beforeState: { assignedRoles: before },
      afterState: { assignedRoles: after, changed: roleKey },
      requestId: requestIdOf(req),
      ip: ipOf(req),
    });
    logger.info("Admin role assignment changed", { admin: actor.username, accountId, roleKey, assigned: add !== "" });
    jsonResponse(res, 200, { ok: true, accountId, assignedRoles: after });
    return;
  }
  errorResponse(res, 405, "METHOD_NOT_ALLOWED", "Use GET or PUT");
}

// ---- GET /api/admin/admin-users — admin directory (spec §70) ----

export async function adminUsersHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const actor = await resolveActor(req, res, "support");
  if (actor === null) return;
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.username, a.display_name, a.role, a.status, a.last_login_at,
              GROUP_CONCAT(ra.role_key) AS assigned_roles
       FROM accounts a
       LEFT JOIN admin_role_assignments ra ON ra.account_id = a.id
       WHERE a.role IN ('Developer', 'Admin', 'Game Master', 'GM', 'Moderator', 'Support', 'LiveOps', 'Content Designer', 'Administrator')
          OR ra.role_key IS NOT NULL
       GROUP BY a.id
       ORDER BY a.username ASC`,
    )
    .all() as SqlRow[];
  jsonResponse(res, 200, {
    admins: rows.map((row) => {
      const role = String(row.role ?? "");
      return {
        accountId: Number(row.id),
        username: String(row.username ?? ""),
        displayName: String(row.display_name ?? ""),
        hubRole: role,
        tier: adminTierForRole(role),
        status: String(row.status ?? "active"),
        lastLoginAt: row.last_login_at === null || row.last_login_at === undefined ? null : String(row.last_login_at),
        assignedRoles: row.assigned_roles === null || row.assigned_roles === undefined ? [] : String(row.assigned_roles).split(","),
      };
    }),
    callerAccountId: actor.accountId,
  });
}

// ---- Item Database & Item Editor (spec §25–26) ----

const ITEM_SORTS = new Set(["key", "name", "category", "rarity", "value", "stack", "updated"]);

/** Authoring vocabulary the editor form renders (mirrors ContentValidator). */
function itemEditorMeta(): Record<string, unknown> {
  return {
    categories: ITEM_CATEGORIES,
    equipmentSlots: EQUIPMENT_SLOTS,
    rarities: ITEM_RARITIES,
    statKeys: EQUIPMENT_STAT_KEYS,
    courierEffectKeys: COURIER_EFFECT_KEYS,
    classes: classKeys(),
  };
}

/** Read the editor payload from a request body (flat or nested under `item`). */
function itemFieldsOf(body: Record<string, unknown>): Record<string, unknown> {
  const nested = body.item;
  return typeof nested === "object" && nested !== null && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : body;
}

/** GET /api/admin/items — catalog list; GET /api/admin/items/:itemId — detail. */
export async function adminItemsHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActor(req, res, "support");
  if (actor === null) return;

  if (params?.itemId !== undefined) {
    const itemId = intField(params.itemId);
    if (itemId === undefined) {
      errorResponse(res, 400, "INVALID_ITEM_ID", "itemId must be a positive integer");
      return;
    }
    const item = getItemById(itemId);
    if (item === null) {
      errorResponse(res, 404, "ITEM_NOT_FOUND", "No item with that id");
      return;
    }
    jsonResponse(res, 200, {
      item,
      references: getItemReferences(item.key),
      meta: itemEditorMeta(),
      canEdit: actorHasPermission(actor, "edit_items"),
    });
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const sort = url.searchParams.get("sort") ?? "key";
  const dir = url.searchParams.get("dir") ?? "asc";
  const result = listItems({
    search: url.searchParams.get("search") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    rarity: url.searchParams.get("rarity") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    includeArchived: url.searchParams.get("archived") === "1",
    sort: ITEM_SORTS.has(sort) ? sort : "key",
    dir,
    limit: intField(url.searchParams.get("limit")),
    offset: intField(url.searchParams.get("offset")),
  });
  jsonResponse(res, 200, { ...result, canEdit: actorHasPermission(actor, "edit_items") });
}

/** GET /api/admin/items/meta — authoring vocabulary for the editor form. */
export async function adminItemsMetaHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const actor = await resolveActor(req, res, "support");
  if (actor === null) return;
  jsonResponse(res, 200, { meta: itemEditorMeta(), canEdit: actorHasPermission(actor, "edit_items") });
}

/** POST /api/admin/items — author a new item (spec §26). */
export async function adminItemCreateHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const actor = await resolveActorWithPermission(req, res, "support", "edit_items");
  if (actor === null) return;
  const body = bodyOf(req);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3) {
    errorResponse(res, 400, "REASON_REQUIRED", "A reason of at least 3 characters is required");
    return;
  }
  const validation = validateItemFields(itemFieldsOf(body), { keyEditable: true });
  if (!validation.ok) {
    errorResponse(res, 400, "VALIDATION_FAILED", validation.issues.map((i) => i.message).join("; "));
    return;
  }
  const result = createItem(validation.value, actor.username);
  if (!result.ok) {
    const message = result.reason === "KEY_TAKEN" ? `An item with key "${validation.value.key}" already exists` : "Item key is required";
    errorResponse(res, result.reason === "KEY_TAKEN" ? 409 : 400, result.reason, message);
    return;
  }
  writeAuditLog(actor, {
    action: "item_created",
    category: "content",
    targetType: "item",
    targetId: result.item.key,
    targetLabel: result.item.name,
    reason,
    afterState: result.item,
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  logger.info("Admin item created", { admin: actor.username, key: result.item.key });
  jsonResponse(res, 201, { ok: true, item: result.item });
}

/** PUT /api/admin/items/:itemId — edit an item (spec §26). */
export async function adminItemUpdateHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActorWithPermission(req, res, "support", "edit_items");
  if (actor === null) return;
  const itemId = intParam(params, "itemId");
  if (itemId === undefined) {
    errorResponse(res, 400, "INVALID_ITEM_ID", "itemId must be a positive integer");
    return;
  }
  const body = bodyOf(req);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3) {
    errorResponse(res, 400, "REASON_REQUIRED", "A reason of at least 3 characters is required");
    return;
  }
  const before = getItemById(itemId);
  if (before === null) {
    errorResponse(res, 404, "ITEM_NOT_FOUND", "No item with that id");
    return;
  }
  const fields = itemFieldsOf(body);
  const submittedKey = typeof fields.key === "string" ? fields.key.trim() : "";
  if (submittedKey !== "" && submittedKey !== before.key) {
    errorResponse(res, 400, "KEY_IMMUTABLE", "An item key cannot change after creation — duplicate the item instead");
    return;
  }
  const validation = validateItemFields({ ...fields, key: before.key }, { keyEditable: false });
  if (!validation.ok) {
    errorResponse(res, 400, "VALIDATION_FAILED", validation.issues.map((i) => i.message).join("; "));
    return;
  }
  const result = updateItem(itemId, validation.value, actor.username);
  if (!result.ok) {
    errorResponse(res, 409, result.reason, "Another item already uses that key");
    return;
  }
  writeAuditLog(actor, {
    action: "item_updated",
    category: "content",
    targetType: "item",
    targetId: result.item.key,
    targetLabel: result.item.name,
    reason,
    beforeState: before,
    afterState: result.item,
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  jsonResponse(res, 200, { ok: true, item: result.item });
}

/** POST /api/admin/items/:itemId/duplicate — clone with a new key. */
export async function adminItemDuplicateHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActorWithPermission(req, res, "support", "edit_items");
  if (actor === null) return;
  const itemId = intParam(params, "itemId");
  if (itemId === undefined) {
    errorResponse(res, 400, "INVALID_ITEM_ID", "itemId must be a positive integer");
    return;
  }
  const source = getItemById(itemId);
  if (source === null) {
    errorResponse(res, 404, "ITEM_NOT_FOUND", "No item with that id");
    return;
  }
  const body = bodyOf(req);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3) {
    errorResponse(res, 400, "REASON_REQUIRED", "A reason of at least 3 characters is required");
    return;
  }
  const newKey = typeof body.newKey === "string" ? body.newKey.trim() : "";
  if (newKey === "") {
    errorResponse(res, 400, "KEY_REQUIRED", "newKey is required");
    return;
  }
  const newName = typeof body.newName === "string" && body.newName.trim() !== ""
    ? body.newName.trim()
    : `${source.name} (Copy)`;
  const validation = validateItemFields({ ...source, key: newKey, name: newName }, { keyEditable: true });
  if (!validation.ok) {
    errorResponse(res, 400, "VALIDATION_FAILED", validation.issues.map((i) => i.message).join("; "));
    return;
  }
  const result = createItem(validation.value, actor.username);
  if (!result.ok) {
    errorResponse(res, 409, result.reason, `An item with key "${newKey}" already exists`);
    return;
  }
  writeAuditLog(actor, {
    action: "item_duplicated",
    category: "content",
    targetType: "item",
    targetId: result.item.key,
    targetLabel: result.item.name,
    reason,
    beforeState: { duplicatedFrom: source.key },
    afterState: result.item,
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  jsonResponse(res, 201, { ok: true, item: result.item });
}

/**
 * DELETE /api/admin/items/:itemId — archive an item.
 * Level 3 (spec §72): archiving pulls an item out of the live game, so it
 * needs a fresh step-up token on top of the reason and edit_items permission.
 */
export async function adminItemArchiveHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActorWithPermission(req, res, "support", "edit_items");
  if (actor === null) return;
  const itemId = intParam(params, "itemId");
  if (itemId === undefined) {
    errorResponse(res, 400, "INVALID_ITEM_ID", "itemId must be a positive integer");
    return;
  }
  const body = bodyOf(req);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3) {
    errorResponse(res, 400, "REASON_REQUIRED", "A reason of at least 3 characters is required");
    return;
  }
  if (!requireStepUp(req, actor, res)) return;
  const before = getItemById(itemId);
  if (before === null) {
    errorResponse(res, 404, "ITEM_NOT_FOUND", "No item with that id");
    return;
  }
  if (before.isDeleted) {
    errorResponse(res, 409, "ALREADY_ARCHIVED", `"${before.name}" is already archived`);
    return;
  }
  const references = getItemReferences(before.key);
  const after = archiveItem(itemId, actor.username);
  writeAuditLog(actor, {
    action: "item_archived",
    category: "content",
    targetType: "item",
    targetId: before.key,
    targetLabel: before.name,
    reason,
    beforeState: { ...before, references },
    afterState: { isDeleted: true },
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  logger.info("Admin item archived", { admin: actor.username, key: before.key, references: references.inventoryCount });
  jsonResponse(res, 200, { ok: true, item: after });
}

/** POST /api/admin/items/:itemId/restore — un-archive an item. */
export async function adminItemRestoreHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const actor = await resolveActorWithPermission(req, res, "support", "edit_items");
  if (actor === null) return;
  const itemId = intParam(params, "itemId");
  if (itemId === undefined) {
    errorResponse(res, 400, "INVALID_ITEM_ID", "itemId must be a positive integer");
    return;
  }
  const body = bodyOf(req);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3) {
    errorResponse(res, 400, "REASON_REQUIRED", "A reason of at least 3 characters is required");
    return;
  }
  const before = getItemById(itemId);
  if (before === null) {
    errorResponse(res, 404, "ITEM_NOT_FOUND", "No item with that id");
    return;
  }
  const after = restoreItem(itemId, actor.username);
  writeAuditLog(actor, {
    action: "item_restored",
    category: "content",
    targetType: "item",
    targetId: before.key,
    targetLabel: before.name,
    reason,
    beforeState: { isDeleted: before.isDeleted },
    afterState: { isDeleted: false },
    requestId: requestIdOf(req),
    ip: ipOf(req),
  });
  jsonResponse(res, 200, { ok: true, item: after });
}
