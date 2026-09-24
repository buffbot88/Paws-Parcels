/** The one bindings table must drive both InputSystem's Phaser keys and the help overlay. */
import { describe, expect, it } from "vitest";
import {
  DEV_KEY_BINDINGS,
  KEY_BINDINGS,
  binding,
  helpRows,
  matchesKey,
  phaserKeyList,
} from "../../src/systems/keybindings.ts";

describe("key bindings table", () => {
  it("lists every approved player shortcut", () => {
    expect(KEY_BINDINGS.map((entry) => entry.id)).toEqual([
      "move", "interact", "attack", "inventory", "map", "questLog", "help", "chat", "close",
    ]);
  });

  it("gives every binding keycaps and at least one trigger key", () => {
    for (const entry of [...KEY_BINDINGS, ...DEV_KEY_BINDINGS]) {
      expect(entry.caps.length).toBeGreaterThan(0);
      expect((entry.phaserKeys?.length ?? 0) + (entry.domKeys?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it("generates help rows one-to-one from the table, hiding admin shortcuts from players", () => {
    expect(helpRows(false)).toEqual(KEY_BINDINGS.map((entry) => ({ label: entry.label, caps: entry.caps })));
    expect(helpRows(false).some((row) => row.caps.includes("Ctrl"))).toBe(false);
    expect(helpRows(true)).toEqual(
      [...KEY_BINDINGS, ...DEV_KEY_BINDINGS].map((entry) => ({ label: entry.label, caps: entry.caps })),
    );
  });

  it("derives InputSystem's Phaser key list from the same table", () => {
    const playerKeys = phaserKeyList(false).split(",");
    expect(playerKeys).toEqual(KEY_BINDINGS.flatMap((entry) => entry.phaserKeys ?? []));
    expect(playerKeys).toEqual(expect.arrayContaining(["W", "A", "S", "D", "UP", "DOWN", "LEFT", "RIGHT", "E", "SPACE", "ONE", "I"]));
    expect(playerKeys).not.toContain("V");
    expect(phaserKeyList(true).split(",")).toContain("V");
  });

  it("matches DOM shortcuts by KeyboardEvent.key", () => {
    const key = (value: string) => ({ key: value }) as KeyboardEvent;
    expect(matchesKey(key("j"), "questLog")).toBe(true);
    expect(matchesKey(key("J"), "questLog")).toBe(true);
    expect(matchesKey(key("?"), "help")).toBe(true);
    expect(matchesKey(key("Enter"), "chat")).toBe(true);
    expect(matchesKey(key("Escape"), "close")).toBe(true);
    expect(matchesKey(key("k"), "questLog")).toBe(false);
    expect(() => binding("nope")).toThrow(/Unknown key binding/);
  });
});
