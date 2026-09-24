/**
 * The local display-settings store: defaults, persistence, change events, and
 * surviving blocked or corrupt storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SettingsModule = typeof import("../../src/ui/settings.ts");

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const globals = globalThis as { localStorage?: unknown; matchMedia?: unknown };

async function load(): Promise<SettingsModule> {
  vi.resetModules();
  return import("../../src/ui/settings.ts");
}

describe("settings store", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    globals.localStorage = storage;
    delete globals.matchMedia;
  });

  afterEach(() => {
    delete globals.localStorage;
    delete globals.matchMedia;
  });

  it("defaults to high quality, damage numbers on, and the OS motion preference", async () => {
    const { getSettings } = await load();
    expect(getSettings()).toEqual({ graphicsQuality: "high", damageNumbers: true, reducedMotion: false });

    globals.matchMedia = (query: string) => ({ matches: query.includes("reduce") });
    const reloaded = await load();
    expect(reloaded.getSettings().reducedMotion).toBe(true);
  });

  it("persists only the changed fields under paws.settings and reloads them", async () => {
    const { updateSettings, SETTINGS_KEY } = await load();
    expect(SETTINGS_KEY).toBe("paws.settings");
    updateSettings({ graphicsQuality: "low" });
    expect(JSON.parse(storage.getItem(SETTINGS_KEY) ?? "")).toEqual({ graphicsQuality: "low" });

    const reloaded = await load();
    expect(reloaded.getSettings().graphicsQuality).toBe("low");
    expect(reloaded.getSettings().damageNumbers).toBe(true);
  });

  it("notifies subscribers until they unsubscribe", async () => {
    const { onSettingsChange, updateSettings } = await load();
    const seen: boolean[] = [];
    const unsubscribe = onSettingsChange((settings) => seen.push(settings.damageNumbers));
    updateSettings({ damageNumbers: false });
    unsubscribe();
    updateSettings({ damageNumbers: true });
    expect(seen).toEqual([false]);
  });

  it("ignores corrupt JSON and ill-typed fields", async () => {
    storage.setItem("paws.settings", "{not json");
    expect((await load()).getSettings().graphicsQuality).toBe("high");

    storage.setItem("paws.settings", JSON.stringify({ graphicsQuality: "ultra", damageNumbers: "no", reducedMotion: true }));
    expect((await load()).getSettings()).toEqual({ graphicsQuality: "high", damageNumbers: true, reducedMotion: true });
  });

  it("works when storage throws or is missing", async () => {
    globals.localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const blocked = await load();
    expect(blocked.getSettings().damageNumbers).toBe(true);
    expect(blocked.updateSettings({ damageNumbers: false }).damageNumbers).toBe(false);

    delete globals.localStorage;
    expect((await load()).getSettings().graphicsQuality).toBe("high");
  });
});
