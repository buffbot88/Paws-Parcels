import { beforeEach, describe, expect, it, vi } from "vitest";

function makeStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
}

beforeEach(() => {
  vi.resetModules();
});

describe("persistent courier session", () => {
  it("ignores a legacy localStorage selection", async () => {
    const session = makeStorage();
    vi.stubGlobal("window", {
      sessionStorage: session,
      localStorage: makeStorage({ "paws.auth.selectedCharacter": "99" }),
    });
    const { readSelectedCharacterId } = await import("../../src/net/bootTarget.ts");
    expect(readSelectedCharacterId()).toBeNull();
  });

  it("reads the active JWT from persistent localStorage", async () => {
    const session = makeStorage();
    const local = makeStorage({ "paws.auth.token": "persistent-token" });
    vi.stubGlobal("window", { sessionStorage: session, localStorage: local });
    const { readAuthToken } = await import("../../src/ui/LoginOverlay.ts");
    expect(readAuthToken()).toBe("persistent-token");
  });

  it("promotes a legacy tab JWT into persistent storage", async () => {
    const session = makeStorage({
      "paws.auth.token": "legacy-token",
      "paws.auth.account": '{"role":"Member"}',
      "paws.auth.characters": "[]",
    });
    const local = makeStorage();
    vi.stubGlobal("window", { sessionStorage: session, localStorage: local });
    const { readAuthToken } = await import("../../src/ui/LoginOverlay.ts");
    expect(readAuthToken()).toBe("legacy-token");
    expect(local.getItem("paws.auth.token")).toBe("legacy-token");
    expect(local.getItem("paws.auth.account")).toBe('{"role":"Member"}');
  });

  it("keeps two browser tabs on different selected couriers", async () => {
    const firstTab = makeStorage();
    const secondTab = makeStorage();
    vi.stubGlobal("window", { sessionStorage: firstTab, localStorage: makeStorage() });
    const first = await import("../../src/net/bootTarget.ts");
    first.writeSelectedCharacterId(1);
    expect(first.readSelectedCharacterId()).toBe(1);

    vi.resetModules();
    vi.stubGlobal("window", { sessionStorage: secondTab, localStorage: makeStorage() });
    const second = await import("../../src/net/bootTarget.ts");
    second.writeSelectedCharacterId(2);
    expect(second.readSelectedCharacterId()).toBe(2);
    expect(firstTab.getItem("paws.auth.selectedCharacter")).toBe("1");
    expect(secondTab.getItem("paws.auth.selectedCharacter")).toBe("2");
  });
});
