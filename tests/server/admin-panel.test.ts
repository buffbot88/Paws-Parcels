import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

// Mock the config loader BEFORE importing anything that uses it (same pattern
// as characters.test.ts) so server tests never need server_config.json.
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
  db: {
    file: ":memory:",
  },
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
  admin: {
    roleTiers: {},
  },
}));

import { generateAccessToken } from "../../server/src/auth/index.ts";
import { mintStepUpToken, resetStepUpState } from "../../server/src/auth/adminHardening.ts";
import { getDb, closeDb } from "../../server/src/db/connection.ts";
import { runMigrations } from "../../server/src/db/migrate.ts";
import { setAdminRuntime, type AdminRuntime } from "../../server/src/routes/admin.ts";
import {
  adminTierForRole,
  tierSatisfies,
  getServerSettings,
  validateSettingValue,
  writeAuditLog,
  listAuditEntries,
} from "../../server/src/models/Admin.ts";
import {
  adminOverviewHandler,
  adminPlayersHandler,
  adminPlayerDetailHandler,
  adminPlayerStatusHandler,
  adminGrantItemHandler,
  adminAdjustHandler,
  adminInventoryHandler,
  adminAuditHandler,
  adminSettingsHandler,
  adminTierHandler,
} from "../../server/src/routes/admin.ts";

type SqlRow = Record<string, unknown>;

const RUNTIME: AdminRuntime = {
  onlineCount: () => 3,
  zonePlayerCounts: () => ({ "zone-clover-village": 3 }),
  disconnectCharacter: () => 1,
  aiEnabled: false,
  staticDirPresent: false,
};

interface MockResponse {
  _status: number;
  _headers: Record<string, string>;
  _body: unknown;
  _ended: boolean;
  writeHead: (status: number, headers?: Record<string, string>) => unknown;
  setHeader: (name: string, value: string | string[]) => unknown;
  end: (chunk?: string | Buffer) => unknown;
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    _status: 0,
    _headers: {},
    _body: null,
    _ended: false,
    writeHead: () => res,
    setHeader: () => res,
    end: () => res,
  };
  res.writeHead = (status: number, headers?: Record<string, string>) => {
    res._status = status;
    if (headers) Object.assign(res._headers, headers);
    return res;
  };
  res.setHeader = (name: string, value: string | string[]) => {
    res._headers[name] = Array.isArray(value) ? value.join(",") : value;
    return res;
  };
  res.end = (chunk?: string | Buffer) => {
    res._ended = true;
    if (typeof chunk === "string") {
      try {
        res._body = JSON.parse(chunk);
      } catch {
        res._body = chunk;
      }
    }
    return res;
  };
  return res;
}

/** Handler signature expects ServerResponse — tests pass the mock. */
function asRes(mock: MockResponse): ServerResponse {
  return mock as unknown as ServerResponse;
}
function makeReq(opts: {
  method?: string;
  url?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): IncomingMessage {  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
  return {
    method: opts.method ?? "GET",
    url: opts.url ?? "/",
    headers,
    body: opts.body,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

let adminToken = "";
let memberToken = "";

async function seed(): Promise<void> {
  const db = getDb();
  await runMigrations();
  // Migrations seed the real class + item catalogs — reuse a shipped class and
  // item key so the data stays consistent with src/data.
  const classId = Number(
    (db.prepare("SELECT id FROM character_classes WHERE `key` = 'bear-warrior'").get() as SqlRow).id,
  );
  db.prepare(
    "INSERT INTO accounts (username, email, display_name, role, ashat_user_id, status) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("devmichael", "dev@x.test", "DevMichael", "Developer", "ashat-dev-1", "active");
  db.prepare(
    "INSERT INTO accounts (username, email, display_name, role, ashat_user_id, status) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("cloverfox", "fox@x.test", "CloverFox", "Member", "ashat-member-1", "active");
  const adminId = Number(
    (db.prepare("SELECT id FROM accounts WHERE username = 'devmichael'").get() as SqlRow).id,
  );
  const memberId = Number(
    (db.prepare("SELECT id FROM accounts WHERE username = 'cloverfox'").get() as SqlRow).id,
  );
  db.prepare(
    "INSERT INTO characters (account_id, class_id, name, appearance, zone_id, pos_x, pos_y, level, experience, stamps) VALUES (?, ?, ?, '{}', ?, 37, 31, ?, ?, ?)",
  ).run(adminId, classId, "Bramble", "zone-clover-village", 5, 250, 40);
  db.prepare(
    "INSERT INTO characters (account_id, class_id, name, appearance, zone_id, pos_x, pos_y, level, experience, stamps) VALUES (?, ?, ?, '{}', ?, 10, 10, ?, ?, ?)",
  ).run(memberId, classId, "Nutmeg", "zone-happy-valley", 12, 900, 5);
  // grantInventoryItems requires an inventories row per character.
  const charRows = db.prepare("SELECT id FROM characters").all() as SqlRow[];
  for (const row of charRows) {
    db.prepare("INSERT INTO inventories (character_id, slot_count) VALUES (?, 12)").run(Number(row.id));
  }
  adminToken = await generateAccessToken({
    accountId: adminId,
    ashatUserId: "ashat-dev-1",
    username: "devmichael",
    role: "Developer",
  });
  memberToken = await generateAccessToken({
    accountId: memberId,
    ashatUserId: "ashat-member-1",
    username: "cloverfox",
    role: "Member",
  });
}

beforeEach(() => {
  setAdminRuntime(RUNTIME);
  resetStepUpState();
});

afterEach(() => {
  closeDb(); // fresh in-memory DB per test — seed() runs after open
});

/** Call first in each test: open + seed the shared fixtures. */
async function seeded(): Promise<void> {
  await seed();
}

/** Mint a valid step-up token for the admin (Level 3 operations). */
function stepUpHeader(accountId = 1): Record<string, string> {
  const { token } = mintStepUpToken(accountId);
  return { "x-admin-step-up": token };
}

// ---- Tier mapping ----

describe("admin tier mapping", () => {
  it("maps Hub roles to tiers", () => {
    expect(adminTierForRole("Developer")).toBe("developer");
    expect(adminTierForRole("Admin")).toBe("admin");
    expect(adminTierForRole("Game Master")).toBe("moderator");
    expect(adminTierForRole("Support")).toBe("support");
    expect(adminTierForRole("Member")).toBe("none");
  });

  it("orders tiers cumulatively", () => {
    expect(tierSatisfies("developer", "support")).toBe(true);
    expect(tierSatisfies("admin", "moderator")).toBe(true);
    expect(tierSatisfies("support", "moderator")).toBe(false);
    expect(tierSatisfies("none", "support")).toBe(false);
  });
});

// ---- Gating ----

describe("admin gating", () => {
  it("rejects a Member-tier token on the overview", async () => {
    await seeded();
    const res = makeRes();
    await adminOverviewHandler(makeReq({ token: memberToken }), asRes(res));
    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ error: "ADMIN_REQUIRED" });
  });

  it("rejects requests without a token", async () => {
    const res = makeRes();
    await adminOverviewHandler(makeReq({}), asRes(res));
    expect(res._status).toBe(401);
  });

  it("reports the caller's tier", async () => {
    await seeded();
    const res = makeRes();
    await adminTierHandler(makeReq({ token: adminToken }), asRes(res));
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ tier: "developer", username: "devmichael" });
  });
});

// ---- Overview / settings reads ----

describe("adminOverviewHandler", () => {
  it("returns live KPIs and stored settings", async () => {
    await seeded();
    const res = makeRes();
    await adminOverviewHandler(makeReq({ token: adminToken }), asRes(res));
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({
      playersOnline: 3,
      registeredPlayers: 2,
      expRate: 1,
      maxConcurrentPlayers: 500,
      levelCap: 30,
    });
  });
});

describe("adminSettingsHandler", () => {
  it("reads settings", async () => {
    await seeded();
    const res = makeRes();
    await adminSettingsHandler(makeReq({ token: adminToken }), asRes(res));
    expect(res._status).toBe(200);
    expect((res._body as { settings: { expRate: number } }).settings.expRate).toBe(1);
  });

  it("rejects PUT from a non-admin tier", async () => {
    await seeded();
    // Member token is rejected before even reaching tier "admin".
    const res = makeRes();
    await adminSettingsHandler(makeReq({ method: "PUT", token: memberToken, body: { updates: { exp_rate: "2" }, reason: "test" } }), asRes(res));
    expect(res._status).toBe(403);
  });

  it("updates settings with an audit trail", async () => {
    await seeded();
    const res = makeRes();
    await adminSettingsHandler(
      makeReq({
        method: "PUT",
        token: adminToken,
        body: { updates: { exp_rate: "1.5" }, reason: "Weekend event" },
      }),
      asRes(res),
    );
    expect(res._status).toBe(200);
    expect((res._body as { settings: { expRate: number } }).settings.expRate).toBe(1.5);
    const audit = listAuditEntries({ category: "settings" });
    expect(audit.total).toBe(1);
    expect(audit.entries[0].action).toBe("server_settings_updated");
    expect(audit.entries[0].afterState).toMatchObject({ exp_rate: "1.5" });
  });

  it("rejects invalid values", async () => {
    await seeded();
    const res = makeRes();
    await adminSettingsHandler(
      makeReq({ method: "PUT", token: adminToken, body: { updates: { exp_rate: "999" }, reason: "bad" } }),
      asRes(res),
    );
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "INVALID_VALUE" });
  });

  it("rejects unknown settings", async () => {
    await seeded();
    const res = makeRes();
    await adminSettingsHandler(
      makeReq({ method: "PUT", token: adminToken, body: { updates: { bogus: "1" }, reason: "bad" } }),
      asRes(res),
    );
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "UNKNOWN_SETTING" });
  });

  it("validates ranges per key", () => {
    expect(validateSettingValue("exp_rate", "2.5")).toBe("2.5");
    expect(validateSettingValue("exp_rate", "-1")).toBeNull();
    expect(validateSettingValue("max_concurrent_players", "750")).toBe("750");
    expect(validateSettingValue("max_concurrent_players", "0")).toBeNull();
    expect(validateSettingValue("level_cap", "30")).toBe("30");
    expect(validateSettingValue("level_cap", "12.5")).toBeNull();
  });
});

// ---- Players ----

describe("adminPlayersHandler", () => {
  it("lists all players with characters", async () => {
    await seeded();
    const res = makeRes();
    await adminPlayersHandler(makeReq({ token: adminToken }), asRes(res));
    expect(res._status).toBe(200);
    const body = res._body as { players: { username: string; characters: { name: string }[] }[]; total: number };
    expect(body.total).toBe(2);
    const fox = body.players.find((p) => p.username === "cloverfox");
    expect(fox?.characters[0]?.name).toBe("Nutmeg");
  });

  it("filters by search across usernames and character names", async () => {
    await seeded();
    const res = makeRes();
    await adminPlayersHandler(makeReq({ token: adminToken, url: "/?search=Nutmeg" }), asRes(res));
    const body = res._body as { players: { username: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.players[0]?.username).toBe("cloverfox");
  });

  it("filters by zone and level", async () => {
    await seeded();
    const res = makeRes();
    await adminPlayersHandler(
      makeReq({ token: adminToken, url: "/?zone=zone-happy-valley&levelMin=10" }),
      asRes(res),
    );
    const body = res._body as { total: number };
    expect(body.total).toBe(1);
  });

  it("filters by account status", async () => {
    await seeded();
    getDb()
      .prepare("UPDATE accounts SET status = 'banned' WHERE username = 'cloverfox'")
      .run();
    const res = makeRes();
    await adminPlayersHandler(makeReq({ token: adminToken, url: "/?status=banned" }), asRes(res));
    const body = res._body as { players: { username: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.players[0]?.username).toBe("cloverfox");
  });
});

describe("adminPlayerDetailHandler", () => {
  it("returns account + character detail", async () => {
    await seeded();
    const res = makeRes();
    await adminPlayerDetailHandler(
      makeReq({ token: adminToken, url: "/api/admin/players/1" }),
      asRes(res),
      { accountId: "1" },
    );
    expect(res._status).toBe(200);
    const body = res._body as { player: { username: string; characters: { classKey: string }[] } };
    expect(body.player.username).toBe("devmichael");
    expect(body.player.characters[0]?.classKey).toBe("bear-warrior");
  });

  it("404s on an unknown account", async () => {
    await seeded();
    const res = makeRes();
    await adminPlayerDetailHandler(makeReq({ token: adminToken }), asRes(res), { accountId: "999" });
    expect(res._status).toBe(404);
  });
});

// ---- Mutations ----

describe("adminPlayerStatusHandler", () => {
  it("requires typed confirmation for a ban", async () => {
    await seeded();
    const res = makeRes();
    await adminPlayerStatusHandler(
      makeReq({ method: "POST", token: adminToken, headers: stepUpHeader(), body: { status: "banned", reason: "cheating" } }),
      asRes(res),
      { accountId: "2" },
    );
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "CONFIRMATION_REQUIRED" });
  });

  it("bans with typed confirmation and disconnects sessions", async () => {
    await seeded();
    const res = makeRes();
    await adminPlayerStatusHandler(
      makeReq({
        method: "POST",
        token: adminToken,
        headers: stepUpHeader(),
        body: { status: "banned", reason: "cheating", confirm: "BAN cloverfox" },
      }),
      asRes(res),
      { accountId: "2" },
    );
    expect(res._status).toBe(200);
    const status = String(
      (getDb().prepare("SELECT status FROM accounts WHERE id = 2").get() as SqlRow).status,
    );
    expect(status).toBe("banned");
    const audit = listAuditEntries({ category: "moderation" });
    expect(audit.entries[0]?.action).toBe("account_banned");
  });

  it("requires a fresh step-up token before banning", async () => {
    await seeded();
    const res = makeRes();
    await adminPlayerStatusHandler(
      makeReq({ method: "POST", token: adminToken, body: { status: "banned", reason: "cheating", confirm: "BAN cloverfox" } }),
      asRes(res),
      { accountId: "2" },
    );
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "STEP_UP_REQUIRED" });
  });

  it("rejects a step-up token issued for another account", async () => {
    await seeded();
    const res = makeRes();
    const wrongToken = mintStepUpToken(999).token;
    await adminPlayerStatusHandler(
      makeReq({
        method: "POST",
        token: adminToken,
        headers: { "x-admin-step-up": wrongToken },
        body: { status: "banned", reason: "cheating", confirm: "BAN cloverfox" },
      }),
      asRes(res),
      { accountId: "2" },
    );
    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ error: "STEP_UP_WRONG_ACCOUNT" });
  });

  it("consumes a step-up token after one use (no replay)", async () => {
    await seeded();
    const headers = stepUpHeader();
    const first = makeRes();
    await adminPlayerStatusHandler(
      makeReq({ method: "POST", token: adminToken, headers, body: { status: "suspended", reason: "first", confirm: "SUSPEND cloverfox" } }),
      asRes(first),
      { accountId: "2" },
    );
    expect(first._status).toBe(200);
    // Reactivate to reset state, then attempt to replay the same token.
    getDb().prepare("UPDATE accounts SET status = 'active' WHERE id = 2").run();
    const second = makeRes();
    await adminPlayerStatusHandler(
      makeReq({ method: "POST", token: adminToken, headers, body: { status: "suspended", reason: "replay", confirm: "SUSPEND cloverfox" } }),
      asRes(second),
      { accountId: "2" },
    );
    expect(second._status).toBe(403);
    expect(second._body).toMatchObject({ error: "STEP_UP_REPLAYED" });
  });

  it("requires a reason", async () => {
    await seeded();
    const res = makeRes();
    await adminPlayerStatusHandler(
      makeReq({ method: "POST", token: adminToken, headers: stepUpHeader(), body: { status: "suspended", reason: "" } }),
      asRes(res),
      { accountId: "2" },
    );
    expect(res._status).toBe(400);
  });
});

describe("adminGrantItemHandler", () => {
  it("grants an item and audits it", async () => {
    await seeded();
    const charId = Number(
      (getDb().prepare("SELECT id FROM characters WHERE name = 'Nutmeg'").get() as SqlRow).id,
    );
    const res = makeRes();
    await adminGrantItemHandler(
      makeReq({
        method: "POST",
        token: adminToken,
        body: { characterId: charId, itemKey: "item-strawberry", quantity: 3, reason: "Compensation" },
      }),
      asRes(res),
      { accountId: "2" },
    );
    expect(res._status).toBe(200);
    const count = Number(
      (
        getDb()
          .prepare("SELECT SUM(quantity) AS n FROM inventory_items WHERE item_definition_id = (SELECT id FROM item_definitions WHERE `key` = 'item-strawberry')")
          .get() as SqlRow
      ).n ?? 0,
    );
    expect(count).toBe(3);
    const audit = listAuditEntries({ category: "economy" });
    expect(audit.entries[0]?.action).toBe("item_granted");
  });

  it("rejects unknown items", async () => {
    await seeded();
    const charId = Number(
      (getDb().prepare("SELECT id FROM characters WHERE name = 'Nutmeg'").get() as SqlRow).id,
    );
    const res = makeRes();
    await adminGrantItemHandler(
      makeReq({
        method: "POST",
        token: adminToken,
        body: { characterId: charId, itemKey: "nope", quantity: 1, reason: "test" },
      }),
      asRes(res),
      { accountId: "2" },
    );
    expect(res._status).toBe(404);
    expect(res._body).toMatchObject({ error: "ITEM_NOT_FOUND" });
  });
});

describe("adminAdjustHandler", () => {
  it("adjusts stamps with clamping and audit", async () => {
    await seeded();
    const charId = Number(
      (getDb().prepare("SELECT id FROM characters WHERE name = 'Nutmeg'").get() as SqlRow).id,
    );
    const res = makeRes();
    await adminAdjustHandler(
      makeReq({ method: "POST", token: adminToken, body: { characterId: charId, kind: "stamps", delta: -100, reason: "Duped stamps" } }),
      asRes(res),
      { accountId: "2" },
    );
    expect(res._status).toBe(200);
    expect((res._body as { stamps: number }).stamps).toBe(0);
    const audit = listAuditEntries({});
    expect(audit.entries[0]?.action).toBe("stamps_adjusted");
  });

  it("adjusts experience", async () => {
    await seeded();
    const charId = Number(
      (getDb().prepare("SELECT id FROM characters WHERE name = 'Nutmeg'").get() as SqlRow).id,
    );
    const res = makeRes();
    await adminAdjustHandler(
      makeReq({ method: "POST", token: adminToken, body: { characterId: charId, kind: "experience", delta: 100, reason: "Event reward" } }),
      asRes(res),
      { accountId: "2" },
    );
    expect(res._status).toBe(200);
    expect((res._body as { experience: number }).experience).toBe(1000);
  });

  it("rejects zero deltas", async () => {
    await seeded();
    const charId = Number(
      (getDb().prepare("SELECT id FROM characters WHERE name = 'Nutmeg'").get() as SqlRow).id,
    );
    const res = makeRes();
    await adminAdjustHandler(
      makeReq({ method: "POST", token: adminToken, body: { characterId: charId, kind: "stamps", delta: 0, reason: "test" } }),
      asRes(res),
      { accountId: "2" },
    );
    expect(res._status).toBe(400);
  });
});

describe("adminInventoryHandler", () => {
  function seedInventoryItem(): number {
    const charId = Number(
      (getDb().prepare("SELECT id FROM characters WHERE name = 'Nutmeg'").get() as SqlRow).id,
    );
    const info = getDb()
      .prepare("INSERT INTO inventory_items (character_id, item_definition_id, slot, quantity) VALUES (?, (SELECT id FROM item_definitions WHERE `key` = 'item-strawberry'), 0, 5)")
      .run(charId);
    return Number(info.lastInsertRowid);
  }

  it("sets quantity with audit", async () => {
    await seeded();
    const instanceId = seedInventoryItem();
    const res = makeRes();
    await adminInventoryHandler(
      makeReq({ method: "POST", token: adminToken, body: { op: "set-quantity", quantity: 9, reason: "Restock fix" } }),
      asRes(res),
      { instanceId: String(instanceId) },
    );
    expect(res._status).toBe(200);
    const qty = Number(
      (getDb().prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(instanceId) as SqlRow).quantity,
    );
    expect(qty).toBe(9);
  });

  it("removes the item and audits before-state", async () => {
    await seeded();
    const instanceId = seedInventoryItem();
    const res = makeRes();
    await adminInventoryHandler(
      makeReq({ method: "POST", token: adminToken, body: { op: "remove", reason: "Duped item" } }),
      asRes(res),
      { instanceId: String(instanceId) },
    );
    expect(res._status).toBe(200);
    const row = getDb().prepare("SELECT id FROM inventory_items WHERE id = ?").get(instanceId);
    expect(row).toBeUndefined();
    const audit = listAuditEntries({});
    expect(audit.entries[0]?.action).toBe("inventory_item_removed");
    expect(audit.entries[0]?.beforeState).toMatchObject({ quantity: 5 });
  });

  it("rejects invalid ops", async () => {
    await seeded();
    const instanceId = seedInventoryItem();
    const res = makeRes();
    await adminInventoryHandler(
      makeReq({ method: "POST", token: adminToken, body: { op: "explode", reason: "test" } }),
      asRes(res),
      { instanceId: String(instanceId) },
    );
    expect(res._status).toBe(400);
  });
});

// ---- Audit log ----

describe("adminAuditHandler", () => {
  it("lists written audit entries", async () => {
    await seeded();
    writeAuditLog(
      { accountId: 1, username: "devmichael", displayName: "DevMichael", role: "Developer", tier: "developer" },
      { action: "test_action", category: "general", targetType: "system", targetId: "", reason: "unit test" },
    );
    const res = makeRes();
    await adminAuditHandler(makeReq({ token: adminToken }), asRes(res));
    expect(res._status).toBe(200);
    const body = res._body as { entries: { action: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.entries[0]?.action).toBe("test_action");
  });

  it("fetches a single entry by id", async () => {
    await seeded();
    const id = writeAuditLog(
      { accountId: 1, username: "devmichael", displayName: "DevMichael", role: "Developer", tier: "developer" },
      { action: "detail_action", category: "general", targetType: "system", targetId: "" },
    );
    const res = makeRes();
    await adminAuditHandler(makeReq({ token: adminToken }), asRes(res), { auditId: String(id) });
    expect(res._status).toBe(200);
    expect((res._body as { entry: { action: string } }).entry.action).toBe("detail_action");
  });

  it("404s on an unknown audit id", async () => {
    await seeded();
    const res = makeRes();
    await adminAuditHandler(makeReq({ token: adminToken }), asRes(res), { auditId: "424242" });
    expect(res._status).toBe(404);
  });
});

// ---- Settings model ----

describe("getServerSettings", () => {
  it("returns migrated defaults", async () => {
    await seeded();
    const settings = getServerSettings();
    expect(settings.expRate).toBe(1);
    expect(settings.dropRate).toBe(1);
    expect(settings.honorRate).toBe(1);
    expect(settings.maxConcurrentPlayers).toBe(500);
    expect(settings.levelCap).toBe(30);
    expect(settings.meta.length).toBe(5);
  });
});
