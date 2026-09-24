import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/src/config/index.ts", () => ({
  server: { port: 3001, host: "0.0.0.0", nodeEnv: "testing", isDev: true, corsAllowedOrigins: [], debug: false },
  db: { file: ":memory:" },
  auth: { jwtSecret: "test-jwt-secret-of-sufficient-length-32-chars-x", accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800, bcryptRounds: 4 },
  oidc: { clientId: "test", redirectUri: "http://localhost/callback", scopes: "openid", discoveryUrl: "https://test/.well-known", issuer: "https://test", jwksTtlSeconds: 600 },
  ai: { enabled: false, port: 3101, modelPath: "", mmprojPath: "", idleMs: 600000, warmupTimeoutMs: 90000, requestTimeoutMs: 4000, monsterDecisionIntervalMs: 5000, maxTokensMonster: 40, maxTokensNpc: 160, npcTalkMinIntervalMs: 6000 },
}));

import { runMigrations } from "../../server/src/db/migrate.ts";
import { closeDb, getDb } from "../../server/src/db/connection.ts";
import { findOrCreateAccountByAshatId } from "../../server/src/models/Account.ts";
import { createCharacter, grantInventoryItems } from "../../server/src/models/Character.ts";
import { getCharacterClasses } from "../../server/src/models/CharacterClass.ts";
import { equipItem, getInventoryState, moveInventoryItem, unequipItem } from "../../server/src/models/Equipment.ts";

afterEach(async () => {
  await closeDb();
  vi.restoreAllMocks();
});

async function makeCharacter(): Promise<number> {
  await runMigrations();
  const account = await findOrCreateAccountByAshatId({ ashatUserId: "inv-user", username: "inv-user", displayName: "Inv User", role: "Member" });
  const cls = (await getCharacterClasses())[0];
  const created = await createCharacter({ accountId: account.id, name: "Inv User", classId: cls.id, appearance: {}, cls });
  if (!created.ok) throw new Error("character creation failed");
  return created.character.id;
}

/** Grant one item and return its instance id + current slot. */
function grantOne(characterId: number, itemKey: string): { instanceId: number; slot: number } {
  const db = getDb();
  const def = db.prepare("SELECT id FROM item_definitions WHERE key = ?").get(itemKey) as { id: number };
  const inserted = db.prepare("INSERT INTO inventory_items (character_id, item_definition_id, slot, quantity) VALUES (?, ?, ?, 1)").run(characterId, def.id, 0);
  return { instanceId: Number(inserted.lastInsertRowid), slot: 0 };
}

describe("moveInventoryItem", () => {
  it("moves an owned unlocked item into an empty slot", async () => {
    const id = await makeCharacter();
    const { instanceId } = grantOne(id, "item-strawberry");
    const result = moveInventoryItem(id, instanceId, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.inventory.items.find((i) => i.itemInstanceId === instanceId);
    expect(moved?.slot).toBe(3);
  });

  it("rejects a negative or out-of-range target slot", async () => {
    const id = await makeCharacter();
    const { instanceId } = grantOne(id, "item-strawberry");
    expect(moveInventoryItem(id, instanceId, -1)).toEqual({ ok: false, reason: "INVALID_SLOT" });
    const slotCount = getInventoryState(id).slotCount;
    expect(moveInventoryItem(id, instanceId, slotCount)).toEqual({ ok: false, reason: "INVALID_SLOT" });
  });

  it("rejects moving an item the character does not own", async () => {
    const id = await makeCharacter();
    expect(moveInventoryItem(id, 99999, 1)).toEqual({ ok: false, reason: "ITEM_NOT_OWNED" });
  });

  it("rejects moving an equipped item", async () => {
    const id = await makeCharacter();
    const { instanceId } = grantOne(id, "item-courier-cap-gear");
    const equipped = equipItem(id, instanceId);
    expect(equipped.ok).toBe(true);
    expect(moveInventoryItem(id, instanceId, 2)).toEqual({ ok: false, reason: "ITEM_EQUIPPED" });
  });

  it("rejects moving a locked quest item", async () => {
    const id = await makeCharacter();
    const db = getDb();
    const def = db.prepare("SELECT id FROM item_definitions WHERE key = ?").get("item-strawberry") as { id: number };
    const inserted = db.prepare("INSERT INTO inventory_items (character_id, item_definition_id, slot, quantity, stack_meta) VALUES (?, ?, 0, 1, ?)").run(id, def.id, JSON.stringify({ locked: true }));
    const instanceId = Number(inserted.lastInsertRowid);
    expect(moveInventoryItem(id, instanceId, 2)).toEqual({ ok: false, reason: "ITEM_LOCKED" });
  });

  it("rejects moving into an occupied slot", async () => {
    const id = await makeCharacter();
    const a = grantOne(id, "item-strawberry");
    const db = getDb();
    const def = db.prepare("SELECT id FROM item_definitions WHERE key = ?").get("item-blueberry") as { id: number };
    db.prepare("INSERT INTO inventory_items (character_id, item_definition_id, slot, quantity) VALUES (?, ?, 4, 1)").run(id, def.id);
    expect(moveInventoryItem(id, a.instanceId, 4)).toEqual({ ok: false, reason: "SLOT_OCCUPIED" });
  });

  it("no-op move to its own slot succeeds without disturbing other items", async () => {
    const id = await makeCharacter();
    const { instanceId } = grantOne(id, "item-strawberry"); // slot 0
    const db = getDb();
    const def = db.prepare("SELECT id FROM item_definitions WHERE key = ?").get("item-blueberry") as { id: number };
    db.prepare("INSERT INTO inventory_items (character_id, item_definition_id, slot, quantity) VALUES (?, ?, 1, 1)").run(id, def.id);
    const result = moveInventoryItem(id, instanceId, 0); // already in slot 0
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.inventory.items.find((i) => i.itemInstanceId === instanceId);
    expect(moved?.slot).toBe(0);
    const untouched = result.inventory.items.find((i) => i.itemKey === "item-blueberry");
    expect(untouched?.slot).toBe(1);
  });
});

describe("unequipItem — courier satchel capacity", () => {
  it("refuses to unequip a satchel while its bonus slots hold items, and never unequips into them", async () => {
    const id = await makeCharacter();
    const satchel = grantOne(id, "item-courier-satchel");
    expect(equipItem(id, satchel.instanceId).ok).toBe(true);
    const base = getInventoryState(id).slotCount - 6;
    const db = getDb();
    const def = db.prepare("SELECT id FROM item_definitions WHERE key = ?").get("item-strawberry") as { id: number };
    const bonus = db.prepare("INSERT INTO inventory_items (character_id, item_definition_id, slot, quantity) VALUES (?, ?, ?, 1)").run(id, def.id, base);
    expect(unequipItem(id, "courier-bag")).toEqual({ ok: false, reason: "INVENTORY_FULL" });

    // Base slots full, bonus slots empty: still no room once the satchel is gone.
    db.prepare("DELETE FROM inventory_items WHERE id = ?").run(Number(bonus.lastInsertRowid));
    for (let slot = 0; slot < base; slot++) {
      db.prepare("INSERT INTO inventory_items (character_id, item_definition_id, slot, quantity) VALUES (?, ?, ?, 1)").run(id, def.id, slot);
    }
    expect(unequipItem(id, "courier-bag")).toEqual({ ok: false, reason: "INVENTORY_FULL" });
  });
});
