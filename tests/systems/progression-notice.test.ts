/**
 * Level-up / promotion celebration — pure model, banner DOM and the audio bus.
 *
 * The moment is driven entirely by server facts (`progression` on a delivery),
 * so these tests pin what the player sees and hears for each fact combination:
 * a plain delivery celebrates nothing, one level shows the level, a two-level
 * delivery shows the crossing, a promotion is announced as one, and the
 * tutorial's closing delivery (level + promotion together) is a single moment.
 *
 * The banner is exercised against a minimal fake DOM (the suite runs in the
 * node environment, like the other HUD tests) and the audio bus against a stub
 * AudioContext, so "it made the right sound" is asserted rather than assumed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NetQuestProgression } from "../../src/net/GameSocket.ts";

// ---- fake DOM ---------------------------------------------------------------

class FakeClassList {
  private readonly names = new Set<string>();
  add(...values: string[]): void { for (const value of values) this.names.add(value); }
  remove(...values: string[]): void { for (const value of values) this.names.delete(value); }
  contains(value: string): boolean { return this.names.has(value); }
  values(): string[] { return [...this.names]; }
}

class FakeElement {
  id = "";
  className = "";
  hidden = false;
  title = "";
  textContent = "";
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  attrs: Record<string, string> = {};
  parent: FakeElement | null = null;
  classList = new FakeClassList();

  appendChild<T extends FakeElement>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  append(...nodes: FakeElement[]): void { for (const node of nodes) this.appendChild(node); }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children = [];
    this.append(...nodes);
  }
  remove(): void {
    if (this.parent === null) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  setAttribute(name: string, value: string): void { this.attrs[name] = value; }
  getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
  querySelector(): null { return null; }

  /** className + classList, which is how the components actually set classes. */
  classes(): string[] {
    return [...new Set([...this.className.split(/\s+/).filter(Boolean), ...this.classList.values()])];
  }
  /** Depth-first text, so assertions can read the rendered card. */
  text(): string {
    return [this.textContent, ...this.children.map((child) => child.text())].join(" ").trim();
  }
}

class FakeDocument {
  readonly layer = new FakeElement();
  readonly body = new FakeElement();
  constructor() {
    this.layer.id = "hud-layer";
    this.body.id = "body";
    this.body.appendChild(this.layer);
  }
  getElementById(id: string): FakeElement | null {
    if (id === "hud-layer") return this.layer;
    if (id === "game-container") return this.layer;
    return null;
  }
  createElement(_tag: string): FakeElement { return new FakeElement(); }
  createElementNS(_ns: string, _tag: string): FakeElement { return new FakeElement(); }
  querySelector(): null { return null; }
}

// ---- stub WebAudio ----------------------------------------------------------

interface RecordedNote {
  frequency: number;
  type: string;
  /** Only ever 0 with the stub clock; kept so the record matches real notes. */
  startedAt: number;
}

let notes: RecordedNote[] = [];

function stubAudioContext(): void {
  class StubOscillator {
    type = "sine";
    private frequencyValue = 0;
    readonly frequency = {
      setValueAtTime: (value: number): void => { this.frequencyValue = value; },
    };
    connect(): void { /* no-op */ }
    start(): void { notes.push({ frequency: this.frequencyValue, type: this.type, startedAt: 0 }); }
    stop(): void { /* no-op */ }
  }
  class StubGain {
    gain = {
      setValueAtTime: (): void => undefined,
      exponentialRampToValueAtTime: (): void => undefined,
    };
    connect(): void { /* no-op */ }
  }
  vi.stubGlobal("AudioContext", class {
    currentTime = 0;
    state = "running";
    destination = {};
    createOscillator(): StubOscillator { return new StubOscillator(); }
    createGain(): StubGain { return new StubGain(); }
    resume(): Promise<void> { return Promise.resolve(); }
  });
}

// ---- fixtures ---------------------------------------------------------------

function progression(overrides: Partial<NetQuestProgression> = {}): NetQuestProgression {
  return {
    level: 5,
    previousLevel: 4,
    levelsGained: 1,
    experience: 400,
    skillPoints: 4,
    courierRank: "Courier",
    rankPromotion: null,
    ...overrides,
  };
}

let fakeDoc: FakeDocument;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  notes = [];
  fakeDoc = new FakeDocument();
  vi.stubGlobal("document", fakeDoc);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 1; });
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ---- pure model -------------------------------------------------------------

describe("levelUpMoment", () => {
  it("celebrates nothing when a delivery grants no level and no promotion", async () => {
    const { levelUpMoment } = await import("../../src/ui/hud/progression.ts");
    expect(levelUpMoment(progression({ levelsGained: 0, level: 4, previousLevel: 4 }))).toBeNull();
    expect(levelUpMoment(undefined)).toBeNull();
    expect(levelUpMoment(null)).toBeNull();
  });

  it("announces a single level with the skill point it granted", async () => {
    const { levelUpMoment } = await import("../../src/ui/hud/progression.ts");
    const moment = levelUpMoment(progression());
    expect(moment).toMatchObject({
      title: "Level Up!",
      headline: "Level 5",
      details: ["+1 skill point"],
      tone: "level",
      rankPromotion: null,
    });
  });

  it("reads a two-level delivery as the crossing the tutorial closes on", async () => {
    const { levelUpMoment } = await import("../../src/ui/hud/progression.ts");
    const moment = levelUpMoment(
      progression({ level: 5, previousLevel: 3, levelsGained: 2, skillPoints: 4 }),
    );
    expect(moment?.headline).toBe("Level 3 → 5");
    expect(moment?.details).toEqual(["+2 skill points"]);
    expect(moment?.tone).toBe("level");
  });

  it("announces a promotion alone when no level was crossed", async () => {
    const { levelUpMoment } = await import("../../src/ui/hud/progression.ts");
    const moment = levelUpMoment(
      progression({ levelsGained: 0, level: 3, previousLevel: 3, rankPromotion: "Courier" }),
    );
    expect(moment).toMatchObject({
      title: "Promotion!",
      tone: "rank",
      details: ["Promoted to Courier"],
      rankPromotion: "Courier",
    });
  });

  it("combines a level crossing and the rank promotion into one moment", async () => {
    const { levelUpMoment, describeMoment } = await import("../../src/ui/hud/progression.ts");
    const moment = levelUpMoment(progression({ rankPromotion: "Courier" }));
    expect(moment).toMatchObject({ title: "Level Up · Promotion!", tone: "both" });
    expect(moment?.details).toEqual(["+1 skill point", "Promoted to Courier"]);
    expect(describeMoment(moment!)).toBe("Level Up · Promotion! · Level 5 · +1 skill point · Promoted to Courier");
  });

  it("tolerates a malformed progression frame instead of trusting it", async () => {
    const { levelUpMoment } = await import("../../src/ui/hud/progression.ts");
    expect(levelUpMoment(progression({ levelsGained: -3, rankPromotion: null }))).toBeNull();
    expect(levelUpMoment(progression({ levelsGained: 1.9 }))?.levelsGained).toBe(1);
  });
});

// ---- banner -----------------------------------------------------------------

describe("LevelUpBanner", () => {
  it("shows the moment, tones the card, and announces it to assistive tech", async () => {
    const { LevelUpBanner } = await import("../../src/ui/LevelUpBanner.ts");
    const { levelUpMoment } = await import("../../src/ui/hud/progression.ts");
    const banner = new LevelUpBanner();

    expect(banner.show(levelUpMoment(progression()))).toBe(true);
    const root = fakeDoc.layer.children[0]!;
    expect(root.hidden).toBe(false);
    expect(root.classes()).toContain("level-up-banner");
    expect(root.classes()).toContain("level-up-banner--level");
    expect(root.classes()).toContain("level-up-banner--visible");
    expect(root.text()).toContain("Level Up!");
    expect(root.text()).toContain("Level 5");
    expect(root.text()).toContain("+1 skill point");
    expect(root.attrs["aria-label"]).toBe("Level Up! · Level 5 · +1 skill point");
    banner.destroy();
  });

  it("shows nothing for a plain delivery", async () => {
    const { LevelUpBanner } = await import("../../src/ui/LevelUpBanner.ts");
    const banner = new LevelUpBanner();
    expect(banner.show(null)).toBe(false);
    expect(fakeDoc.layer.children[0]!.hidden).toBe(true);
    expect(banner.current).toBeNull();
    banner.destroy();
  });

  it("queues a second celebration instead of overpainting the first", async () => {
    const { LevelUpBanner } = await import("../../src/ui/LevelUpBanner.ts");
    const { levelUpMoment } = await import("../../src/ui/hud/progression.ts");
    const banner = new LevelUpBanner();
    const first = levelUpMoment(progression())!;
    const second = levelUpMoment(progression({ rankPromotion: "Courier", level: 5 }))!;

    banner.show(first);
    banner.show(second);
    expect(banner.current?.headline).toBe("Level 5");
    expect(banner.pending).toBe(1);

    vi.advanceTimersByTime(2600 + 220);
    expect(banner.current?.title).toBe("Level Up · Promotion!");
    expect(banner.pending).toBe(0);
    banner.destroy();
  });

  it("hides itself again and drops its timers on destroy", async () => {
    const { LevelUpBanner } = await import("../../src/ui/LevelUpBanner.ts");
    const { levelUpMoment } = await import("../../src/ui/hud/progression.ts");
    const banner = new LevelUpBanner();
    banner.show(levelUpMoment(progression())!);

    vi.advanceTimersByTime(2600);
    const root = fakeDoc.layer.children[0]!;
    expect(root.classes()).not.toContain("level-up-banner--visible");

    vi.advanceTimersByTime(220);
    expect(root.hidden).toBe(true);

    banner.show(levelUpMoment(progression())!);
    banner.destroy();
    expect(banner.current).toBeNull();
    expect(fakeDoc.layer.children).toHaveLength(0);
    // Nothing left scheduled to fire against a removed element.
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });
});

// ---- audio bus --------------------------------------------------------------

describe("sfx", () => {
  it("is silent and harmless before any audio context exists", async () => {
    const { sfx } = await import("../../src/audio/sfx.ts");
    expect(sfx.isMuted()).toBe(false);
    expect(() => sfx.playProgression("both")).not.toThrow();
    expect(notes).toHaveLength(0);
  });

  it("plays a rising figure through WebAudio when sound is on", async () => {
    stubAudioContext();
    const { sfx } = await import("../../src/audio/sfx.ts");
    sfx.playProgression("level");
    expect(notes.map((note) => note.frequency)).toEqual([523.25, 659.25, 783.99]);
    expect(notes.every((note) => note.type === "triangle")).toBe(true);
  });

  it("adds the octave and a sparkle for a promotion", async () => {
    stubAudioContext();
    const { sfx } = await import("../../src/audio/sfx.ts");
    sfx.playProgression("both");
    expect(notes.map((note) => note.frequency)).toEqual([523.25, 659.25, 783.99, 1046.5, 1567.98]);
  });

  it("persists the mute preference locally and notifies subscribers", async () => {
    stubAudioContext();
    const { sfx } = await import("../../src/audio/sfx.ts");
    const seen: boolean[] = [];
    const unsubscribe = sfx.subscribe((muted) => seen.push(muted));

    expect(sfx.toggleMuted()).toBe(true);
    expect(sfx.isMuted()).toBe(true);
    expect(seen).toEqual([true]);
    expect(globalThis.localStorage.getItem("paws.audio.muted")).toBe("1");

    // Muted means muted: the figure is not scheduled at all.
    sfx.playProgression("level");
    expect(notes).toHaveLength(0);

    sfx.setMuted(true);
    expect(seen).toEqual([true]); // no duplicate notification

    unsubscribe();
    sfx.setMuted(false);
    expect(seen).toEqual([true]);
    expect(globalThis.localStorage.getItem("paws.audio.muted")).toBe("0");
  });

  it("restores a persisted mute on load", async () => {
    globalThis.localStorage.setItem("paws.audio.muted", "1");
    const { sfx } = await import("../../src/audio/sfx.ts");
    expect(sfx.isMuted()).toBe(true);
  });
});
