import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the config loader so the DB opens as an in-memory SQLite file — the
// real (unmocked) models + migrations run against it, so this is a genuine
// integration test of the persistence layer.
vi.mock("../../server/src/config/index.ts", () => ({
  server: {
    port: 3001,
    host: "0.0.0.0",
    nodeEnv: "testing",
    isDev: true,
    corsAllowedOrigins: ["http://localhost:5173"],
    debug: false,
  },
  db: {
    file: ":memory:",
  },
  auth: {
    jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x",
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 604800,
    bcryptRounds: 4,
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
}));

import { runMigrations } from "../../server/src/db/migrate.ts";
import { closeDb, getDb } from "../../server/src/db/connection.ts";
import { findOrCreateAccountByAshatId } from "../../server/src/models/Account.ts";
import {
  createCharacter,
  getCharacterById,
  getCharactersByAccountId,
  getCharacterWithClass,
  getCharacterProfile,
  grantInventoryItems,
  unlockSkill,
  updateCharacterPosition,
} from "../../server/src/models/Character.ts";
import { getCharacterClasses } from "../../server/src/models/CharacterClass.ts";
import { getZoneByKey } from "../../server/src/models/Zone.ts";

afterEach(async () => {
  await closeDb(); // next test reopens a fresh in-memory database
  vi.restoreAllMocks();
});

describe("SQLite persistence layer", () => {
  it("applies all migrations and seeds zones + classes", async () => {
    await runMigrations();

    const zone = await getZoneByKey("zone-clover-village");
    expect(zone?.key).toBe("zone-clover-village");
    expect(zone?.default_spawn_x).toBe(37);
    expect(zone?.default_spawn_y).toBe(38);
    expect(zone?.is_safe).toBe(true);

    const classes = await getCharacterClasses();
    expect(classes.map((c) => c.key)).toEqual([
      "bear-warrior",
      "cat-mage",
      "fox-archer",
    ]);
    expect((getDb().prepare("SELECT COUNT(*) AS count FROM item_definitions").get() as { count: number }).count).toBe(31);
    expect((getDb().prepare("SELECT COUNT(*) AS count FROM skill_definitions").get() as { count: number }).count).toBe(9);
    expect((getDb().prepare("SELECT COUNT(*) AS count FROM monster_definitions").get() as { count: number }).count).toBe(5);
  });

  it("is idempotent — re-running migrations applies nothing new", async () => {
    await runMigrations();
    await runMigrations();
    const zone = await getZoneByKey("zone-clover-village");
    expect(zone).not.toBeNull();
  });

  it("upserts an account by ashat_user_id and syncs the display name", async () => {
    await runMigrations();
    const created = await findOrCreateAccountByAshatId({
      ashatUserId: "u-1",
      username: "pip",
      displayName: "Pip",
      role: "Member",
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.email).toBe("pip@ashat.local");

    // Same ashat user again — same account row, updated display name.
    const again = await findOrCreateAccountByAshatId({
      ashatUserId: "u-1",
      username: "pip",
      displayName: "Pip the Hedgehog",
      role: "Member",
    });
    expect(again.id).toBe(created.id);
    expect(again.display_name).toBe("Pip the Hedgehog");
  });

  it("creates a character with stats + inventory and reports NAME_TAKEN on duplicate", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({
      ashatUserId: "u-2",
      username: "maple",
      displayName: "Maple",
      role: "Member",
    });
    const classes = await getCharacterClasses();

    const created = await createCharacter({
      accountId: account.id,
      name: "Maple",
      classId: classes[0].id,
      appearance: { fur: "brown" },
      cls: classes[0],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The duplicate name on the same account is rejected by the UNIQUE index.
    const dup = await createCharacter({
      accountId: account.id,
      name: "Maple",
      classId: classes[0].id,
      appearance: {},
      cls: classes[0],
    });
    expect(dup).toEqual({ ok: false, reason: "NAME_TAKEN" });

    // The failed insert must not have leaked a half-created row.
    const chars = await getCharactersByAccountId(account.id);
    expect(chars).toHaveLength(1);
    expect(chars[0].name).toBe("Maple");
    expect(chars[0].zone_id).toBe("zone-clover-village");
  });

  it("loads profile/inventory/skill data and enforces skill unlocks", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({ ashatUserId: "u-profile", username: "profile", displayName: "Profile", role: "Member" });
    const classes = await getCharacterClasses();
    const created = await createCharacter({ accountId: account.id, name: "Profile", classId: classes[0].id, appearance: {}, cls: classes[0] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const before = await getCharacterProfile(created.character.id);
    expect(before?.inventory.slotCount).toBe(12);
    expect(before?.skills.entries.length).toBe(3);
    expect(before?.skills.skillPoints).toBe(1);

    await grantInventoryItems(created.character.id, [{ itemKey: "item-boar-hide", quantity: 2 }]);
    const afterLoot = await getCharacterProfile(created.character.id);
    expect(afterLoot?.inventory.items[0]).toMatchObject({ key: "item-boar-hide", quantity: 2, slot: 0 });

    const unlocked = await unlockSkill(created.character.id, "bear-iron-hide");
    expect(unlocked.ok).toBe(true);
    if (unlocked.ok) expect(unlocked.profile.skills.entries[0].unlocked).toBe(true);
    expect((await unlockSkill(created.character.id, "bear-iron-hide"))).toEqual({ ok: false, reason: "ALREADY_UNLOCKED" });
    expect((await unlockSkill(created.character.id, "cat-arcane-focus"))).toEqual({ ok: false, reason: "WRONG_CLASS" });
  });

  it("returns the class key for a WS session and persists position updates", async () => {
    await runMigrations();
    const account = await findOrCreateAccountByAshatId({
      ashatUserId: "u-3",
      username: "birch",
      displayName: "Birch",
      role: "Member",
    });
    const classes = await getCharacterClasses();
    const fox = classes.find((c) => c.key === "fox-archer");
    expect(fox).toBeDefined();
    if (fox === undefined) return;

    const created = await createCharacter({
      accountId: account.id,
      name: "Birch",
      classId: fox.id,
      appearance: {},
      cls: fox,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const session = await getCharacterWithClass(created.character.id);
    expect(session?.class_key).toBe("fox-archer");
    expect(session?.pos_x).toBe(37);
    expect(session?.pos_y).toBe(38);

    await updateCharacterPosition(created.character.id, "zone-clover-village", 4, 7);
    const after = await getCharacterWithClass(created.character.id);
    expect(after?.pos_x).toBe(4);
    expect(after?.pos_y).toBe(7);

    const byId = await getCharacterById(created.character.id);
    expect(byId?.level).toBe(1);
  });
});
