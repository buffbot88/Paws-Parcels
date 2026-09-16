import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

// Mock the config loader BEFORE importing anything that uses it (same pattern
// as the other server tests) so tests never need server_config.json.
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
import { syncStaticContent } from "../../server/src/content/staticContent.ts";
import { setAdminRuntime, type AdminRuntime } from "../../server/src/routes/admin.ts";
import { listAuditEntries } from "../../server/src/models/Admin.ts";
import {
  adminItemsHandler,
  adminItemsMetaHandler,
  adminItemCreateHandler,
  adminItemUpdateHandler,
  adminItemDuplicateHandler,
  adminItemArchiveHandler,
  adminItemRestoreHandler,
} from "../../server/src/routes/admin.ts";
import { grantInventoryItems } from "../../server/src/models/Character.ts";
import { EQUIPMENT_SLOTS, ITEM_CATEGORIES, ITEM_RARITIES, getItemByKey } from "../../server/src/models/ItemCatalog.ts";

type SqlRow = Record<string, unknown>;

const RUNTIME: AdminRuntime = {
  onlineCount: () => 0,
  zonePlayerCounts: () => ({}),
  disconnectCharacter: () => 0,
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

function asRes(mock: MockResponse): ServerResponse {
  return mock as unknown as ServerResponse;
}

function makeReq(opts: {
  method?: string;
  url?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): IncomingMessage {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
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
let supportToken = "";
let memberToken = "";
let adminAccountId = 0;

async function seed(): Promise<void> {
  const db = getDb();
  await runMigrations();
  const classId = Number((db.prepare("SELECT id FROM character_classes WHERE `key` = 'bear-warrior'").get() as SqlRow).id);
  const insertAccount = db.prepare(
    "INSERT INTO accounts (username, email, display_name, role, ashat_user_id, status) VALUES (?, ?, ?, ?, ?, 'active')",
  );
  insertAccount.run("devmichael", "dev@x.test", "DevMichael", "Developer", "ashat-dev-1");
  insertAccount.run("supportsam", "sam@x.test", "SupportSam", "Support", "ashat-support-1");
  insertAccount.run("cloverfox", "fox@x.test", "CloverFox", "Member", "ashat-member-1");
  adminAccountId = Number((db.prepare("SELECT id FROM accounts WHERE username = 'devmichael'").get() as SqlRow).id);
  const supportId = Number((db.prepare("SELECT id FROM accounts WHERE username = 'supportsam'").get() as SqlRow).id);
  const memberId = Number((db.prepare("SELECT id FROM accounts WHERE username = 'cloverfox'").get() as SqlRow).id);
  const insertCharacter = db.prepare(
    "INSERT INTO characters (account_id, class_id, name, appearance, zone_id, pos_x, pos_y, level, experience, stamps) VALUES (?, ?, ?, '{}', 'zone-clover-village', 37, 31, 5, 0, 0)",
  );
  insertCharacter.run(memberId, classId, "Nutmeg");
  for (const row of db.prepare("SELECT id FROM characters").all() as SqlRow[]) {
    db.prepare("INSERT INTO inventories (character_id, slot_count) VALUES (?, 12)").run(Number(row.id));
  }
  adminToken = await generateAccessToken({ accountId: adminAccountId, ashatUserId: "ashat-dev-1", username: "devmichael", role: "Developer" });
  supportToken = await generateAccessToken({ accountId: supportId, ashatUserId: "ashat-support-1", username: "supportsam", role: "Support" });
  memberToken = await generateAccessToken({ accountId: memberId, ashatUserId: "ashat-member-1", username: "cloverfox", role: "Member" });
}

beforeEach(() => {
  setAdminRuntime(RUNTIME);
  resetStepUpState();
});

afterEach(() => {
  closeDb(); // fresh in-memory DB per test — seed() runs after open
});

async function seeded(): Promise<void> {
  await seed();
}

function stepUpHeader(accountId = adminAccountId): Record<string, string> {
  const { token } = mintStepUpToken(accountId);
  return { "x-admin-step-up": token };
}

function validItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "item-moon-charm",
    name: "Moon Charm",
    description: "A charm that hums under the moon.",
    category: "material",
    maxStack: 5,
    icon: "charm-moon",
    rarity: "rare",
    value: 42,
    ...overrides,
  };
}

async function listItems(params = ""): Promise<MockResponse> {
  const res = makeRes();
  await adminItemsHandler(makeReq({ token: adminToken, url: `/api/admin/items${params}` }), asRes(res));
  return res;
}

// ---- Item Database (spec §25) ----

describe("item database listing", () => {
  it("lists the shipped catalog with facets and total", async () => {
    await seeded();
    const res = await listItems("?limit=100");
    expect(res._status).toBe(200);
    const body = res._body as { items: { key: string; source: string; category: string }[]; total: number; facets: { categories: { value: string }[] }; canEdit: boolean };
    // 37 items are authored in src/data/items.json.
    expect(body.total).toBe(37);
    expect(body.items.some((item) => item.key === "item-strawberry")).toBe(true);
    expect(body.items.every((item) => item.source === "content")).toBe(true);
    expect(body.facets.categories.map((c) => c.value)).toContain("equipment");
    expect(body.canEdit).toBe(true);
  });

  it("searches by key, name, or description", async () => {
    await seeded();
    const byName = await listItems("?search=Strawberry");
    expect((byName._body as { items: { key: string }[] }).items.map((i) => i.key)).toEqual(["item-strawberry"]);

    const byKey = await listItems("?search=item-trail-boots");
    expect((byKey._body as { total: number }).total).toBe(1);

    const miss = await listItems("?search=zzzz-not-an-item");
    expect((miss._body as { total: number }).total).toBe(0);
  });

  it("filters by category and rarity", async () => {
    await seeded();
    const equipment = await listItems("?category=equipment&limit=100");
    const body = equipment._body as { items: { category: string }[]; total: number };
    expect(body.total).toBe(6);
    expect(body.items.every((item) => item.category === "equipment")).toBe(true);

    const uncommon = await listItems("?rarity=uncommon&limit=100");
    expect((uncommon._body as { total: number }).total).toBe(3);
  });

  it("returns one item with usage references", async () => {
    await seeded();
    const strawberry = getItemByKey("item-strawberry");
    expect(strawberry).not.toBeNull();
    const res = makeRes();
    await adminItemsHandler(makeReq({ token: adminToken, url: `/api/admin/items/${strawberry?.id}` }), asRes(res), { itemId: String(strawberry?.id) });
    expect(res._status).toBe(200);
    const body = res._body as { item: { key: string }; references: { inventoryCount: number; quests: { id: string }[]; monsters: { key: string }[] } };
    expect(body.item.key).toBe("item-strawberry");
    expect(body.references.inventoryCount).toBe(0);
  });

  it("reports quest and monster references for catalog items", async () => {
    await seeded();
    const welcomeCard = getItemByKey("item-village-welcome-card");
    const welcomeRes = makeRes();
    await adminItemsHandler(makeReq({ token: adminToken, url: `/api/admin/items/${welcomeCard?.id}` }), asRes(welcomeRes), {
      itemId: String(welcomeCard?.id),
    });
    const welcomeBody = welcomeRes._body as { references: { quests: { id: string; role: string }[] } };
    expect(welcomeBody.references.quests).toContainEqual(
      expect.objectContaining({ id: "quest-village-welcome", role: "required" }),
    );

    const hide = getItemByKey("item-boar-hide");
    const hideRes = makeRes();
    await adminItemsHandler(makeReq({ token: adminToken, url: `/api/admin/items/${hide?.id}` }), asRes(hideRes), { itemId: String(hide?.id) });
    const hideBody = hideRes._body as { references: { monsters: { key: string }[] } };
    expect(hideBody.references.monsters.length).toBeGreaterThan(0);
  });

  it("404s an unknown item id", async () => {
    await seeded();
    const res = makeRes();
    await adminItemsHandler(makeReq({ token: adminToken, url: "/api/admin/items/999999" }), asRes(res), { itemId: "999999" });
    expect(res._status).toBe(404);
    expect(res._body).toMatchObject({ error: "ITEM_NOT_FOUND" });
  });

  it("exposes the authoring vocabulary", async () => {
    await seeded();
    const res = makeRes();
    await adminItemsMetaHandler(makeReq({ token: adminToken }), asRes(res));
    expect(res._status).toBe(200);
    const meta = (res._body as { meta: Record<string, unknown> }).meta;
    expect(meta.categories).toEqual(ITEM_CATEGORIES);
    expect(meta.equipmentSlots).toEqual(EQUIPMENT_SLOTS);
    expect(meta.rarities).toEqual(ITEM_RARITIES);
    expect(meta.classes).toContain("bear-warrior");
  });
});

// ---- Item Editor (spec §26) ----

describe("item editor CRUD", () => {
  it("creates an admin-authored item and audits it", async () => {
    await seeded();
    const res = makeRes();
    await adminItemCreateHandler(
      makeReq({ method: "POST", token: adminToken, body: { item: validItem(), reason: "Add moon charm for the festival" } }),
      asRes(res),
    );
    expect(res._status).toBe(201);
    const body = res._body as { item: { id: number; key: string; source: string; rarity: string; value: number } };
    expect(body.item.key).toBe("item-moon-charm");
    expect(body.item.source).toBe("admin");
    expect(body.item.value).toBe(42);

    const persisted = getItemByKey("item-moon-charm");
    expect(persisted?.name).toBe("Moon Charm");
    expect(persisted?.isDeleted).toBe(false);

    const audit = listAuditEntries({ category: "content" });
    expect(audit.entries[0]).toMatchObject({ action: "item_created", targetType: "item", targetId: "item-moon-charm" });
    expect(audit.entries[0].reason).toBe("Add moon charm for the festival");
  });

  it("rejects duplicate keys and invalid payloads", async () => {
    await seeded();
    const dup = makeRes();
    await adminItemCreateHandler(
      makeReq({ method: "POST", token: adminToken, body: { item: validItem({ key: "item-strawberry", name: "Other" }), reason: "dup test" } }),
      asRes(dup),
    );
    expect(dup._status).toBe(409);
    expect(dup._body).toMatchObject({ error: "KEY_TAKEN" });

    const badCategory = makeRes();
    await adminItemCreateHandler(
      makeReq({ method: "POST", token: adminToken, body: { item: validItem({ category: "wand" }), reason: "bad category" } }),
      asRes(badCategory),
    );
    expect(badCategory._status).toBe(400);
    expect(String((badCategory._body as { message: string }).message)).toContain("category must be one of");

    const badKey = makeRes();
    await adminItemCreateHandler(
      makeReq({ method: "POST", token: adminToken, body: { item: validItem({ key: "Moon Charm" }), reason: "bad key" } }),
      asRes(badKey),
    );
    expect(badKey._status).toBe(400);
    expect(String((badKey._body as { message: string }).message)).toContain("item-");

    const equipmentWithoutSlot = makeRes();
    await adminItemCreateHandler(
      makeReq({ method: "POST", token: adminToken, body: { item: validItem({ key: "item-meteor-cap", category: "equipment" }), reason: "no slot" } }),
      asRes(equipmentWithoutSlot),
    );
    expect(equipmentWithoutSlot._status).toBe(400);
    expect(String((equipmentWithoutSlot._body as { message: string }).message)).toContain("equipmentSlot");
  });

  it("requires a reason on every mutation", async () => {
    await seeded();
    const res = makeRes();
    await adminItemCreateHandler(makeReq({ method: "POST", token: adminToken, body: { item: validItem() } }), asRes(res));
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "REASON_REQUIRED" });
  });

  it("stores equipment stats and courier effects", async () => {
    await seeded();
    const res = makeRes();
    await adminItemCreateHandler(
      makeReq({
        method: "POST",
        token: adminToken,
        body: {
          item: validItem({
            key: "item-meteor-satchel",
            name: "Meteor Satchel",
            category: "equipment",
            maxStack: 1,
            equipmentSlot: "courier-bag",
            stats: { defense: 2, attack: 1 },
            courierEffects: { parcelCapacity: 4, fragileProtection: 1 },
            requiredClass: "bear-warrior",
            requiredLevel: 4,
          }),
          reason: "Festival equipment",
        },
      }),
      asRes(res),
    );
    expect(res._status).toBe(201);
    const item = getItemByKey("item-meteor-satchel");
    expect(item?.equipmentSlot).toBe("courier-bag");
    expect(item?.stats).toEqual({ defense: 2, attack: 1 });
    expect(item?.courierEffects).toEqual({ parcelCapacity: 4, fragileProtection: 1 });
    expect(item?.requiredClass).toBe("bear-warrior");
    expect(item?.requiredLevel).toBe(4);
  });

  it("rejects equipment metadata on non-equipment items", async () => {
    await seeded();
    const res = makeRes();
    await adminItemCreateHandler(
      makeReq({
        method: "POST",
        token: adminToken,
        body: { item: validItem({ stats: { attack: 9 } }), reason: "stats on a material" },
      }),
      asRes(res),
    );
    expect(res._status).toBe(400);
    expect(String((res._body as { message: string }).message)).toContain("only valid for the equipment category");
  });

  it("updates an item, keeps the key immutable, and audits before/after", async () => {
    await seeded();
    const strawberry = getItemByKey("item-strawberry");
    const res = makeRes();
    await adminItemUpdateHandler(
      makeReq({
        method: "PUT",
        token: adminToken,
        body: { item: { ...validItemNone(), key: undefined, name: "Sun Strawberry", value: 12 }, reason: "Rebalance strawberry value" },
      }),
      asRes(res),
      { itemId: String(strawberry?.id) },
    );
    expect(res._status).toBe(200);
    const updated = (res._body as { item: { name: string; source: string; key: string; value: number } }).item;
    expect(updated.name).toBe("Sun Strawberry");
    expect(updated.source).toBe("admin");
    expect(updated.key).toBe("item-strawberry");

    const audit = listAuditEntries({ category: "content" });
    const entry = audit.entries[0];
    expect(entry.action).toBe("item_updated");
    expect((entry.beforeState as { name: string }).name).toBe("Strawberry");
    expect((entry.afterState as { name: string }).name).toBe("Sun Strawberry");

    const rename = makeRes();
    await adminItemUpdateHandler(
      makeReq({ method: "PUT", token: adminToken, body: { item: { ...validItemNone(), key: "item-renamed" }, reason: "attempt rename" } }),
      asRes(rename),
      { itemId: String(strawberry?.id) },
    );
    expect(rename._status).toBe(400);
    expect(rename._body).toMatchObject({ error: "KEY_IMMUTABLE" });
  });

  it("duplicates an item under a new key", async () => {
    await seeded();
    const boots = getItemByKey("item-trail-boots");
    const res = makeRes();
    await adminItemDuplicateHandler(
      makeReq({ method: "POST", token: adminToken, body: { newKey: "item-river-boots", newName: "River Boots", reason: "Seasonal variant" } }),
      asRes(res),
      { itemId: String(boots?.id) },
    );
    expect(res._status).toBe(201);
    const copy = getItemByKey("item-river-boots");
    expect(copy?.name).toBe("River Boots");
    expect(copy?.courierEffects).toEqual(boots?.courierEffects);
    expect(copy?.source).toBe("admin");

    const clash = makeRes();
    await adminItemDuplicateHandler(
      makeReq({ method: "POST", token: adminToken, body: { newKey: "item-strawberry", reason: "clash" } }),
      asRes(clash),
      { itemId: String(boots?.id) },
    );
    expect(clash._status).toBe(409);
  });

  it("archives and restores an item, hiding it from the catalog list", async () => {
    await seeded();
    const strawberry = getItemByKey("item-strawberry");

    const noStepUp = makeRes();
    await adminItemArchiveHandler(
      makeReq({ method: "DELETE", token: adminToken, body: { reason: "Remove from rotation" } }),
      asRes(noStepUp),
      { itemId: String(strawberry?.id) },
    );
    expect(noStepUp._status).toBe(401);
    expect(noStepUp._body).toMatchObject({ error: "STEP_UP_REQUIRED" });

    const res = makeRes();
    await adminItemArchiveHandler(
      makeReq({ method: "DELETE", token: adminToken, body: { reason: "Remove from rotation" }, headers: stepUpHeader() }),
      asRes(res),
      { itemId: String(strawberry?.id) },
    );
    expect(res._status).toBe(200);
    expect((res._body as { item: { isDeleted: boolean } }).item.isDeleted).toBe(true);

    // Hidden from the default listing, visible with ?archived=1.
    const hidden = await listItems("?limit=100");
    expect((hidden._body as { items: { key: string }[] }).items.some((i) => i.key === "item-strawberry")).toBe(false);
    const shown = await listItems("?limit=100&archived=1");
    expect((shown._body as { items: { key: string }[] }).items.some((i) => i.key === "item-strawberry")).toBe(true);

    // Archived items can no longer be granted to couriers.
    const characterId = Number((getDb().prepare("SELECT id FROM characters LIMIT 1").get() as SqlRow).id);
    await grantInventoryItems(characterId, [{ itemKey: "item-strawberry", quantity: 2 }]);
    const owned = getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM inventory_items ii JOIN item_definitions d ON d.id = ii.item_definition_id WHERE d.`key` = 'item-strawberry'",
      )
      .get() as SqlRow;
    expect(Number(owned.n)).toBe(0);

    // Archiving is audited with the blast radius.
    const archiveAudit = listAuditEntries({ category: "content" }).entries[0];
    expect(archiveAudit).toMatchObject({ action: "item_archived", targetId: "item-strawberry" });

    const restore = makeRes();
    await adminItemRestoreHandler(
      makeReq({ method: "POST", token: adminToken, body: { reason: "Bring it back for spring" } }),
      asRes(restore),
      { itemId: String(strawberry?.id) },
    );
    expect(restore._status).toBe(200);
    expect((restore._body as { item: { isDeleted: boolean } }).item.isDeleted).toBe(false);
    await grantInventoryItems(characterId, [{ itemKey: "item-strawberry", quantity: 2 }]);
    const ownedAfter = getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM inventory_items ii JOIN item_definitions d ON d.id = ii.item_definition_id WHERE d.`key` = 'item-strawberry'",
      )
      .get() as SqlRow;
    expect(Number(ownedAfter.n)).toBe(1);
  });

  it("keeps admin edits through a content sync (no clobber on restart)", async () => {
    await seeded();
    const strawberry = getItemByKey("item-strawberry");
    const edit = makeRes();
    await adminItemUpdateHandler(
      makeReq({
        method: "PUT",
        token: adminToken,
        body: { item: { ...validItemNone(), name: "Festival Strawberry", rarity: "rare", value: 30 }, reason: "Festival rename" },
      }),
      asRes(edit),
      { itemId: String(strawberry?.id) },
    );
    expect(edit._status).toBe(200);

    // A server restart (or deploy) re-runs syncStaticContent from the JSON.
    syncStaticContent();

    const after = getItemByKey("item-strawberry");
    expect(after?.name).toBe("Festival Strawberry");
    expect(after?.rarity).toBe("rare");
    expect(after?.value).toBe(30);
    expect(after?.source).toBe("admin");

    // Untouched catalog rows still come from the JSON sync.
    const untouched = getItemByKey("item-blueberry");
    expect(untouched?.source).toBe("content");
    expect(untouched?.updatedBy).toBe("content-sync");
  });

  it("never resurrects an archived content item on sync", async () => {
    await seeded();
    const herb = getItemByKey("item-wild-herb");
    const res = makeRes();
    await adminItemArchiveHandler(
      makeReq({ method: "DELETE", token: adminToken, body: { reason: "Retire wild herb" }, headers: stepUpHeader() }),
      asRes(res),
      { itemId: String(herb?.id) },
    );
    expect(res._status).toBe(200);

    syncStaticContent();
    const after = getItemByKey("item-wild-herb");
    expect(after?.isDeleted).toBe(true);
    expect(after?.source).toBe("admin");
  });
});

// ---- Permission + tier gating ----

describe("item editor gating", () => {
  it("rejects Members and permission-less support admins on mutations", async () => {
    await seeded();
    const member = makeRes();
    await adminItemCreateHandler(
      makeReq({ method: "POST", token: memberToken, body: { item: validItem(), reason: "member attempt" } }),
      asRes(member),
    );
    expect(member._status).toBe(403);
    expect(member._body).toMatchObject({ error: "ADMIN_REQUIRED" });

    // Support tier with no role assignments has no edit_items baseline.
    const support = makeRes();
    await adminItemCreateHandler(
      makeReq({ method: "POST", token: supportToken, body: { item: validItem(), reason: "support attempt" } }),
      asRes(support),
    );
    expect(support._status).toBe(403);
    expect(support._body).toMatchObject({ error: "PERMISSION_DENIED" });
  });

  it("lets support staff read the catalog but marks it read-only", async () => {
    await seeded();
    const res = makeRes();
    await adminItemsHandler(makeReq({ token: supportToken, url: "/api/admin/items?limit=5" }), asRes(res));
    expect(res._status).toBe(200);
    expect((res._body as { canEdit: boolean }).canEdit).toBe(false);
  });

  it("grants edit_items through a role assignment", async () => {
    await seeded();
    const supportId = Number((getDb().prepare("SELECT id FROM accounts WHERE username = 'supportsam'").get() as SqlRow).id);
    getDb().prepare("INSERT INTO admin_role_assignments (account_id, role_key, assigned_by) VALUES (?, 'content-designer', 'test')").run(supportId);

    const res = makeRes();
    await adminItemCreateHandler(
      makeReq({ method: "POST", token: supportToken, body: { item: validItem({ key: "item-role-charm" }), reason: "Content designer adds charm" } }),
      asRes(res),
    );
    expect(res._status).toBe(201);
  });
});

/** Payload with no stale overrides — the update path keeps the existing key. */
function validItemNone(): Record<string, unknown> {
  return {
    name: "Strawberry",
    description: "A sweet red berry.",
    category: "resource",
    maxStack: 10,
    icon: "berry-strawberry",
    rarity: "common",
    value: 3,
  };
}
