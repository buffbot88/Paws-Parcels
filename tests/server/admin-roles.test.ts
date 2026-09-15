import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

vi.mock("../../server/src/config/index.ts", () => ({
  server: {
    port: 3001,
    host: "0.0.0.0",
    nodeEnv: "testing",
    isDev: true,
    corsAllowedOrigins: ["http://localhost:5173"],
    debug: false,
    staticDir: "",
  },
  db: { file: ":memory:" },
  auth: {
    jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x",
    accessTokenTtlSeconds: 900,
  },
  oidc: {
    clientId: "paws-and-parcels",
    redirectUri: "http://localhost:5173/oidc-callback.html",
    scopes: "openid profile",
    discoveryUrl: "https://ashat.test/api/oauth/.well-known/openid-configuration",
    issuer: "https://ashat.test/api/oauth",
    jwksTtlSeconds: 600,
  },
  ai: {
    enabled: false,
    port: 3101,
    modelPath: "",
    mmprojPath: "",
    idleMs: 600_000,
    warmupTimeoutMs: 90_000,
    requestTimeoutMs: 4_000,
    monsterDecisionIntervalMs: 5_000,
    maxTokensMonster: 40,
    maxTokensNpc: 160,
    npcTalkMinIntervalMs: 6_000,
  },
  admin: { roleTiers: {} },
}));

import { generateAccessToken } from "../../server/src/auth/index.ts";
import { getDb, closeDb } from "../../server/src/db/connection.ts";
import { runMigrations } from "../../server/src/db/migrate.ts";
import {
  listAdminRoles,
  getAssignedRoles,
  setRoleAssignment,
  actorHasPermission,
  tierHasPermission,
  updateRolePermissions,
  writeAuditLog,
  listAuditEntries,
  type AdminActor,
  type AdminPermission,
} from "../../server/src/models/Admin.ts";
import {
  adminRolesHandler,
  adminRolePermissionsHandler,
  adminRoleAssignmentsHandler,
  adminUsersHandler,
  adminPlayersHandler,
} from "../../server/src/routes/admin.ts";

type SqlRow = Record<string, unknown>;

function makeRes(): { _status: number; _body: unknown; writeHead: (...a: unknown[]) => unknown; setHeader: (...a: unknown[]) => unknown; end: (c?: unknown) => unknown } & Partial<ServerResponse> {
  const res: Record<string, unknown> = { _status: 0, _body: null };
  res.writeHead = (status: number) => { res._status = status as number; return res; };
  res.setHeader = () => res;
  res.end = (chunk?: unknown) => {
    if (typeof chunk === "string") {
      try { res._body = JSON.parse(chunk); } catch { res._body = chunk; }
    }
    return res;
  };
  return res as never;
}

function makeReq(opts: { method?: string; url?: string; token?: string; body?: unknown }): IncomingMessage {
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
  return { method: opts.method ?? "GET", url: opts.url ?? "/", headers, body: opts.body, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage;
}

function asRes(mock: ReturnType<typeof makeRes>): ServerResponse {
  return mock as unknown as ServerResponse;
}

const DEV_ACTOR: AdminActor = {
  accountId: 1,
  username: "devmichael",
  displayName: "DevMichael",
  role: "Developer",
  tier: "developer",
};

let adminToken = "";
let gmToken = "";
let adminId = 0;
let gmId = 0;

async function seeded(): Promise<void> {
  const db = getDb();
  await runMigrations();
  db.prepare(
    "INSERT INTO accounts (username, email, display_name, role, ashat_user_id, status) VALUES ('devmichael', 'd@x.test', 'DevMichael', 'Developer', 'ashat-dev', 'active')",
  ).run();
  db.prepare(
    "INSERT INTO accounts (username, email, display_name, role, ashat_user_id, status) VALUES ('gmRowan', 'g@x.test', 'GM Rowan', 'Game Master', 'ashat-gm', 'active')",
  ).run();
  db.prepare(
    "INSERT INTO accounts (username, email, display_name, role, ashat_user_id, status) VALUES ('playerSam', 's@x.test', 'Sam', 'Member', 'ashat-member', 'active')",
  ).run();
  adminId = Number((db.prepare("SELECT id FROM accounts WHERE username = 'devmichael'").get() as SqlRow).id);
  gmId = Number((db.prepare("SELECT id FROM accounts WHERE username = 'gmRowan'").get() as SqlRow).id);
  adminToken = await generateAccessToken({ accountId: adminId, ashatUserId: "ashat-dev", username: "devmichael", role: "Developer" });
  gmToken = await generateAccessToken({ accountId: gmId, ashatUserId: "ashat-gm", username: "gmRowan", role: "Game Master" });
}

beforeEach(() => {
  // fresh DB per test — seeded() runs migrations
});

afterEach(() => {
  closeDb();
});

describe("migration 015 seeds", () => {
  it("seeds the six spec §70 roles with matrix permissions", async () => {
    await seeded();
    const roles = listAdminRoles();
    const keys = roles.map((r) => r.roleKey);
    expect(keys).toEqual([
      "developer", "administrator", "game-master", "content-designer", "liveops", "support",
    ]);
    const gm = roles.find((r) => r.roleKey === "game-master");
    expect(gm?.permissions).toEqual(expect.arrayContaining(["view_players", "ban_player", "edit_inventory"]));
    expect(gm?.permissions).not.toContain("server_settings");
    const dev = roles.find((r) => r.roleKey === "developer");
    expect(dev?.permissions).toContain("manage_roles");
    expect(dev?.isSystem).toBe(true);
  });
});

describe("permission resolution", () => {
  it("developer tier keeps full baseline", async () => {
    await seeded();
    for (const permission of ["view_players", "ban_player", "server_settings", "manage_roles"] as AdminPermission[]) {
      expect(actorHasPermission(DEV_ACTOR, permission)).toBe(true);
    }
  });

  it("tier defaults apply when no roles are assigned", async () => {
    await seeded();
    const gm: AdminActor = { ...DEV_ACTOR, accountId: gmId, tier: "moderator" };
    expect(actorHasPermission(gm, "view_players")).toBe(true);
    expect(actorHasPermission(gm, "ban_player")).toBe(true);
    expect(actorHasPermission(gm, "server_settings")).toBe(false);
  });

  it("explicit role assignments add permissions on top of tier", async () => {
    await seeded();
    const gm: AdminActor = { ...DEV_ACTOR, accountId: gmId, tier: "moderator" };
    // edit_quests requires the admin tier — a moderator has no baseline grant.
    expect(actorHasPermission(gm, "edit_quests")).toBe(false);
    setRoleAssignment(gmId, "content-designer", true, "devmichael");
    expect(actorHasPermission(gm, "edit_quests")).toBe(true);
    expect(getAssignedRoles(gmId)).toEqual(["content-designer"]);
  });

  it("tier hasPermission matches the spec §71 rows", async () => {
    await seeded();
    expect(tierHasPermission("support", "view_players")).toBe(true);
    expect(tierHasPermission("support", "ban_player")).toBe(false);
    expect(tierHasPermission("moderator", "ban_player")).toBe(true);
    expect(tierHasPermission("admin", "server_settings")).toBe(true);
    expect(tierHasPermission("developer", "manage_roles")).toBe(true);
  });
});

describe("role permission guardrails", () => {
  it("blocks removing manage_roles from the last role holding it", async () => {
    await seeded();
    const result = updateRolePermissions("developer", ["view_players", "ban_player"]);
    expect(result).toEqual({ ok: false, reason: "LAST_MANAGE_ROLES" });
  });

  it("allows a permission swap that keeps manage_roles somewhere", async () => {
    await seeded();
    // Give administrator manage_roles first, then trimming developer is fine.
    expect(updateRolePermissions("administrator", ["server_settings", "manage_roles"])).toEqual({ ok: true });
    expect(updateRolePermissions("developer", ["view_players"])).toEqual({ ok: true });
    const dev = listAdminRoles().find((r) => r.roleKey === "developer");
    expect(dev?.permissions).toEqual(["view_players"]);
  });

  it("404s on an unknown role", async () => {
    await seeded();
    expect(updateRolePermissions("bogus-role", ["view_players"])).toEqual({ ok: false, reason: "ROLE_NOT_FOUND" });
  });
});

describe("roles API", () => {
  it("returns the catalog + caller context", async () => {
    await seeded();
    const res = makeRes();
    await adminRolesHandler(makeReq({ token: adminToken }), asRes(res));
    expect(res._status).toBe(200);
    const body = res._body as { roles: unknown[]; caller: { canManageRoles: boolean; tier: string } };
    expect(body.roles).toHaveLength(6);
    expect(body.caller.canManageRoles).toBe(true);
    expect(body.caller.tier).toBe("developer");
  });

  it("rejects permission updates from a caller without manage_roles", async () => {
    await seeded();
    // A Hub-tier admin whose only assigned role (game-master) lacks manage_roles.
    const db = getDb();
    db.prepare(
      "INSERT INTO accounts (username, email, display_name, role, ashat_user_id, status) VALUES ('tieradmin', 't@x.test', 'Tier Admin', 'Admin', 'ashat-tieradmin', 'active')",
    ).run();
    const tierAdminId = Number((db.prepare("SELECT id FROM accounts WHERE username = 'tieradmin'").get() as SqlRow).id);
    setRoleAssignment(tierAdminId, "game-master", true, "devmichael");
    const tierAdminToken = await generateAccessToken({ accountId: tierAdminId, ashatUserId: "ashat-tieradmin", username: "tieradmin", role: "Admin" });
    const res = makeRes();
    await adminRolePermissionsHandler(
      makeReq({
        method: "PUT",
        token: tierAdminToken,
        body: { permissions: ["view_players"], reason: "test" },
      }),
      asRes(res),
      { roleKey: "game-master" },
    );
    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ error: "PERMISSION_DENIED" });
  });

  it("updates a role's matrix with an audit trail", async () => {
    await seeded();
    const res = makeRes();
    await adminRolePermissionsHandler(
      makeReq({
        method: "PUT",
        token: adminToken,
        body: { permissions: ["view_players", "ban_player", "edit_inventory", "manage_roles"], reason: "Tighten GM scope" },
      }),
      asRes(res),
      { roleKey: "developer" },
    );
    expect(res._status).toBe(200);
    const dev = listAdminRoles().find((r) => r.roleKey === "developer");
    expect(dev?.permissions).toEqual(expect.arrayContaining(["manage_roles"]));
    const audit = listAuditEntries({ category: "roles" });
    expect(audit.entries[0]?.action).toBe("role_permissions_updated");
    expect(audit.entries[0]?.beforeState).toBeDefined();
  });

  it("rejects unknown permission keys", async () => {
    await seeded();
    const res = makeRes();
    await adminRolePermissionsHandler(
      makeReq({ method: "PUT", token: adminToken, body: { permissions: ["view_players", "fly"], reason: "test" } }),
      asRes(res),
      { roleKey: "support" },
    );
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "INVALID_PERMISSION" });
  });
});

describe("role assignments API", () => {
  it("assigns and unassigns a role with audit", async () => {
    await seeded();
    const addRes = makeRes();
    await adminRoleAssignmentsHandler(
      makeReq({ method: "PUT", token: adminToken, body: { add: "content-designer", reason: "Covering quest triage" } }),
      asRes(addRes),
      { accountId: String(gmId) },
    );
    expect(addRes._status).toBe(200);
    expect(getAssignedRoles(gmId)).toEqual(["content-designer"]);

    const rmRes = makeRes();
    await adminRoleAssignmentsHandler(
      makeReq({ method: "PUT", token: adminToken, body: { remove: "content-designer", reason: "Rotation ended" } }),
      asRes(rmRes),
      { accountId: String(gmId) },
    );
    expect(rmRes._status).toBe(200);
    expect(getAssignedRoles(gmId)).toEqual([]);
    const audit = listAuditEntries({ category: "roles" });
    expect(audit.entries.map((e) => e.action)).toEqual(["role_unassigned", "role_assigned"]);
  });

  it("blocks self-edit of roles", async () => {
    await seeded();
    const res = makeRes();
    await adminRoleAssignmentsHandler(
      makeReq({ method: "PUT", token: adminToken, body: { add: "support", reason: "self promo" } }),
      asRes(res),
      { accountId: String(adminId) },
    );
    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ error: "SELF_EDIT_FORBIDDEN" });
  });

  it("rejects ambiguous add+remove payloads", async () => {
    await seeded();
    const res = makeRes();
    await adminRoleAssignmentsHandler(
      makeReq({ method: "PUT", token: adminToken, body: { add: "support", remove: "liveops", reason: "test" } }),
      asRes(res),
      { accountId: String(gmId) },
    );
    expect(res._status).toBe(400);
  });
});

describe("admin users directory", () => {
  it("lists only admin-ish accounts with tier + assignments", async () => {
    await seeded();
    setRoleAssignment(gmId, "content-designer", true, "devmichael");
    const res = makeRes();
    await adminUsersHandler(makeReq({ token: adminToken }), asRes(res));
    expect(res._status).toBe(200);
    const body = res._body as { admins: { username: string; tier: string; assignedRoles: string[] }[] };
    const usernames = body.admins.map((a) => a.username);
    expect(usernames).toContain("devmichael");
    expect(usernames).toContain("gmRowan");
    expect(usernames).not.toContain("playerSam");
    const gm = body.admins.find((a) => a.username === "gmRowan");
    expect(gm?.tier).toBe("moderator");
    expect(gm?.assignedRoles).toEqual(["content-designer"]);
  });
});

describe("permission gates on player tools", () => {
  it("a support-tier actor without edit_inventory is denied grant paths", async () => {
    await seeded();
    // Keep manage_roles alive elsewhere first (guardrail), then trim support.
    expect(updateRolePermissions("administrator", ["server_settings_limited", "manage_roles"])).toEqual({ ok: true });
    setRoleAssignment(gmId, "support", true, "devmichael");
    // support role seeds view_players + edit_inventory; trim edit_inventory.
    expect(updateRolePermissions("support", ["view_players"])).toEqual({ ok: true });
    const gm: AdminActor = { ...DEV_ACTOR, accountId: gmId, tier: "moderator", role: "Game Master" };
    expect(actorHasPermission(gm, "view_players")).toBe(true);
    expect(actorHasPermission(gm, "edit_inventory")).toBe(false);
    // Players list still passes view_players.
    const res = makeRes();
    await adminPlayersHandler(makeReq({ token: gmToken }), asRes(res));
    expect(res._status).toBe(200);
  });
});
