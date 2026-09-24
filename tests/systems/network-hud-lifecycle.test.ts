/**
 * NetworkSystem HUD lifecycle regression tests.
 *
 * Proves that:
 *   - NetworkSystem.get() does not create PlayerStatusCard (pre-auth safe)
 *   - mountHUD() creates the card exactly once
 *   - repeated mountHUD() calls do not duplicate the card
 *   - attach() before mountHUD() does not create the card
 *   - attach() after mountHUD() restores the card (character switch / scene restart)
 *   - the card mounts hidden and is revealed only once a scene attaches
 *   - shutdown() destroys the card; mountHUD() after shutdown re-creates it
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- DOM stub ---------------------------------------------------------------
// NetworkSystem appends elements to #game-container; provide a minimal stub.

class FakeElement {
  id = "";
  children: FakeElement[] = [];
  style: Record<string, string> = {};
  appendedTo: FakeElement | null = null;
  hidden = false;
  title = "";
  private readonly classNames = new Set<string>();
  // The banner's tone/visibility is driven by classList, so the stub needs a
  // real (if minimal) one rather than a no-op.
  readonly classList = {
    add: (...names: string[]): void => { for (const name of names) this.classNames.add(name); },
    remove: (...names: string[]): void => { for (const name of names) this.classNames.delete(name); },
    toggle: (name: string, force?: boolean): boolean => {
      const next = force ?? !this.classNames.has(name);
      if (next) this.classNames.add(name);
      else this.classNames.delete(name);
      return next;
    },
    contains: (name: string): boolean => this.classNames.has(name),
  };

  appendChild(child: FakeElement): FakeElement {
    child.appendedTo = this;
    this.children.push(child);
    return child;
  }
  // HUD components build their rows with ParentNode.append (the real DOM
  // method), so the stub has to provide it too — the level-up banner is
  // constructed for real in this suite.
  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }
  remove(): void {
    if (this.appendedTo) {
      this.appendedTo.children = this.appendedTo.children.filter((c) => c !== this);
      this.appendedTo = null;
    }
  }
  querySelector(): null { return null; }
  getAttribute(): null { return null; }
  setAttribute(): void { /* no-op */ }
  removeAttribute(): void { /* no-op */ }
  replaceChildren(): void { this.children = []; }
  get textContent(): string { return ""; }
  set textContent(_v: string) { /* no-op */ }
}

class FakeDocument {
  private root = new FakeElement();
  /** Exposed so tests can inspect what the HUD mounted into the container. */
  readonly container = new FakeElement();

  constructor() {
    this.root.id = "body";
    this.container.id = "game-container";
    this.root.appendChild(this.container);
  }

  getElementById(id: string): FakeElement | null {
    if (id === "game-container") return this.container;
    return null;
  }
  createElement(_tag: string): FakeElement {
    return new FakeElement();
  }
  createElementNS(_ns: string, _tag: string): FakeElement {
    return new FakeElement();
  }
  querySelector(_sel: string): null { return null; }
}

// ---- Module mocks -----------------------------------------------------------

// NetworkSystem imports these collaborators at module scope. Phaser is used
// there for types only, GameConfig re-exports the Phaser scenes, and the
// entity classes are only constructed when snapshot frames arrive — but
// importing the real modules pulls Phaser's ESM build, which touches `window`
// and cannot load in this node-environment test. Mocking them keeps this suite
// a pure HUD-lifecycle check (no rendering).
vi.mock("phaser", () => ({ default: {} }));

vi.mock("../../src/game/GameConfig.ts", () => ({
  TILE_SIZE: 48,
  GAME_WIDTH: 960,
  GAME_HEIGHT: 540,
}));

/** Scene each remote entity was constructed on, and monster movement calls. */
let entityScenes: unknown[] = [];
let monsterMoves: string[] = [];

vi.mock("../../src/entities/RemotePlayer.ts", () => ({
  RemotePlayer: class RemotePlayer {
    constructor(scene: unknown) { entityScenes.push(scene); }
    snapTo(): void { /* no-op */ }
    setTarget(): void { /* no-op */ }
    destroy(): void { /* no-op */ }
  },
}));

vi.mock("../../src/entities/Monster.ts", () => ({
  Monster: class Monster {
    visible = true;
    readonly id: string;
    constructor(scene: unknown, info: { id: string }) {
      entityScenes.push(scene);
      this.id = info.id;
    }
    snapTo(pos: { x: number; y: number }): void { monsterMoves.push(`snap ${pos.x},${pos.y}`); }
    setTarget(pos: { x: number; y: number }): void { monsterMoves.push(`glide ${pos.x},${pos.y}`); }
    setVisible(visible: boolean): void { this.visible = visible; }
    setHp(): void { /* no-op */ }
    destroy(): void { /* no-op */ }
  },
}));

vi.mock("../../src/net/bootTarget.ts", () => ({
  pickCharacter: () => ({ id: 42, name: "Pip", class_id: 1, level: 1, zone_id: "zone-clover-village", pos_x: 0, pos_y: 0 }),
  readBootCharacters: () => [],
  readSelectedCharacterId: () => null,
  writeSelectedCharacterId: vi.fn(),
  SELECTED_CHARACTER_KEY: "paws.selected-character",
}));

vi.mock("../../src/config.ts", () => ({
  apiPath: (p: string) => p,
  getWsUrl: () => "ws://localhost:3003/ws",
  isMaintenance: () => false,
}));

vi.mock("../../src/game/classAssets.ts", () => ({
  classKeyFromId: () => "bear-warrior",
  classSpeedFromId: () => 96,
  playAttackEffect: vi.fn(),
}));

// ---- PlayerStatusCard tracking -----------------------------------------------

let statusCardCreateCount = 0;
let statusCardDestroyCount = 0;
/** Every resource the card was told to adopt, in order. */
let statusCardResources: string[] = [];
/** Every level-up/promotion flash the HUD asked the card to show. */
let statusCardFlashes: { level: number; rank?: string | null }[] = [];
/** How many times a stamp payout flashed the rating row. */
let statusCardStampFlashes = 0;
/** How many times the card was revealed over the live world. */
let statusCardReveals = 0;
/** Last HP the card was told to show. */
let statusCardHp: [number, number] | null = null;

vi.mock("../../src/ui/PlayerStatusCard.ts", () => {
  return {
    PlayerStatusCard: class {
      // Mirrors the real card: reveal() is idempotent, so repeated scene
      // attaches must not replay the reveal.
      private revealed = false;
      constructor() { statusCardCreateCount++; }
      setStatus(_d: unknown): void { /* no-op */ }
      setHp(hp: number, max: number): void { statusCardHp = [hp, max]; }
      // Part of the card's surface: the HUD adopts the courier's class resource
      // on mount, so a mock missing it would only fail at runtime.
      setResourceKind(resource: { label: string }): void {
        statusCardResources.push(resource.label);
      }
      setResource(_current: number, _max: number): void { /* no-op */ }
      setStampRating(_earned: number): void { /* no-op */ }
      // The celebration hooks the network layer calls on a level crossing. A
      // mock without them would only fail at runtime, like the resource above.
      flashProgression(options: { level: number; rank?: string | null }): void {
        statusCardFlashes.push(options);
      }
      flashStamps(): void { statusCardStampFlashes++; }
      reveal(): void {
        if (this.revealed) return;
        this.revealed = true;
        statusCardReveals++;
      }
      destroy(): void { statusCardDestroyCount++; }
    },
  };
});

// ---- Audio bus ---------------------------------------------------------------

let progressionSfx: string[] = [];

vi.mock("../../src/audio/sfx.ts", () => ({
  sfx: {
    isMuted: () => false,
    setMuted: vi.fn(),
    toggleMuted: vi.fn(),
    subscribe: () => () => undefined,
    playProgression: (tone: string) => { progressionSfx.push(tone); },
  },
}));

// ---- GameSocket stub ---------------------------------------------------------

/** The socket the system built, so tests can drive its inbound callbacks. */
let lastSocket: { callbacks: Record<string, (...args: never[]) => void> } | null = null;

vi.mock("../../src/net/GameSocket.ts", () => ({
  GameSocket: class {
    callbacks: Record<string, unknown> = {};
    constructor() { lastSocket = this as unknown as typeof lastSocket; }
    connect = vi.fn().mockResolvedValue(undefined);
    close = vi.fn();
    joinZone = vi.fn();
    setMoveIntervalMs = vi.fn();
    moveIntent = vi.fn();
    interact = vi.fn();
    acceptQuest = vi.fn();
    searchQuest = vi.fn();
    chat = vi.fn();
    attack = vi.fn();
    moveInventoryItem = vi.fn();
    equipItem = vi.fn();
    unequipItem = vi.fn();
    requestInventory = vi.fn();
  },
}));

// ---- Provide fake document --------------------------------------------------

let fakeDoc: FakeDocument;

beforeEach(() => {
  statusCardCreateCount = 0;
  statusCardDestroyCount = 0;
  statusCardResources = [];
  statusCardFlashes = [];
  statusCardStampFlashes = 0;
  statusCardReveals = 0;
  statusCardHp = null;
  entityScenes = [];
  monsterMoves = [];
  progressionSfx = [];
  lastSocket = null;
  fakeDoc = new FakeDocument();
  vi.stubGlobal("document", fakeDoc);
  // The real LevelUpBanner is constructed on mount and schedules its hold with
  // window.setTimeout; node has no window, so point it at the global timers.
  vi.stubGlobal("window", globalThis);

  // Stub localStorage/sessionStorage so readToken() doesn't throw
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ---- Tests ------------------------------------------------------------------

describe("NetworkSystem HUD lifecycle", () => {
  it("NetworkSystem.get() does not create PlayerStatusCard (pre-auth safe)", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();

    const _sys = NetworkSystem.get();
    expect(statusCardCreateCount).toBe(0);

    NetworkSystem.resetForTests();
  });

  it("mountHUD() creates PlayerStatusCard exactly once", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();

    const sys = NetworkSystem.get();
    expect(statusCardCreateCount).toBe(0);

    // Simulate what start() sets, then mountHUD
    sys.start("zone-clover-village", 42);
    sys.mountHUD();
    expect(statusCardCreateCount).toBe(1);
    // The card is told which class resource it shows on the same pass that
    // gives it the courier's name; with no boot character stored, that falls
    // back to the first seeded class (bear → Stamina).
    expect(statusCardResources).toEqual(["Stamina"]);

    NetworkSystem.resetForTests();
  });

  it("repeated mountHUD() calls do not duplicate the status card", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();

    const sys = NetworkSystem.get();
    sys.start("zone-clover-village", 42);
    sys.mountHUD();
    sys.mountHUD();
    sys.mountHUD();
    expect(statusCardCreateCount).toBe(1);

    NetworkSystem.resetForTests();
  });

  it("attach() before mountHUD() does not create the card (unauthenticated scene attach)", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();

    const sys = NetworkSystem.get();
    // Attach without calling start() or mountHUD() — myCharacterId is null
    const fakeScene = { add: {}, tweens: {}, cameras: { main: {} } } as unknown as import("phaser").Scene;
    sys.attach(fakeScene, "zone-clover-village");
    expect(statusCardCreateCount).toBe(0);

    NetworkSystem.resetForTests();
  });

  it("mountHUD() mounts the card hidden until a scene attaches", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();

    const sys = NetworkSystem.get();
    sys.start("zone-clover-village", 42);
    // Auth-time mount: the boot/preloader screens are still up, so the card
    // must not be revealed yet.
    sys.mountHUD();
    expect(statusCardReveals).toBe(0);

    // The Overworld attaches and the card appears over the live world.
    const fakeScene = { add: {}, tweens: {}, cameras: { main: {} } } as unknown as import("phaser").Scene;
    sys.attach(fakeScene, "zone-clover-village");
    expect(statusCardReveals).toBe(1);

    NetworkSystem.resetForTests();
  });

  it("reveals the card once across repeated scene attaches", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();

    const sys = NetworkSystem.get();
    sys.start("zone-clover-village", 42);
    sys.mountHUD();
    const fakeScene = { add: {}, tweens: {}, cameras: { main: {} } } as unknown as import("phaser").Scene;
    sys.attach(fakeScene, "zone-clover-village");
    sys.attach(fakeScene, "zone-clover-village");
    sys.attach(fakeScene, "zone-clover-village");
    expect(statusCardReveals).toBe(1);

    NetworkSystem.resetForTests();
  });

  it("attach() after mountHUD() restores the card on scene restart", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();

    const sys = NetworkSystem.get();
    sys.start("zone-clover-village", 42);
    sys.mountHUD();
    expect(statusCardCreateCount).toBe(1);

    // shutdown() destroys the card (simulating character switch)
    sys.shutdown();
    expect(statusCardDestroyCount).toBe(1);

    // A fresh start + mountHUD re-creates it
    sys.start("zone-clover-village", 42);
    sys.mountHUD();
    expect(statusCardCreateCount).toBe(2);

    NetworkSystem.resetForTests();
  });

  it("celebrates the level and promotion a delivery reports", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();

    const sys = NetworkSystem.get();
    sys.start("zone-clover-village", 42);
    sys.mountHUD();
    expect(lastSocket).not.toBeNull();

    // The tutorial's closing delivery: two levels crossed and the rank
    // promotion, which the server reports as one progression frame.
    lastSocket!.callbacks.onQuestUpdated!({
      action: "delivery",
      quest: { questId: "quest-garden-greeting-moss", state: "completed" },
      quests: [],
      inventory: [],
      stamps: 80,
      xp: 400,
      message: "Delivery complete: The Last Stamp: Back to Pip — you are now an official Courier!",
      progression: {
        level: 5,
        previousLevel: 3,
        levelsGained: 2,
        experience: 400,
        skillPoints: 4,
        courierRank: "Courier",
        rankPromotion: "Courier",
      },
    } as never);

    expect(statusCardFlashes).toEqual([{ level: 5, rank: "Courier" }]);
    expect(statusCardStampFlashes).toBe(1);
    expect(progressionSfx).toEqual(["both"]);
    const banner = fakeDoc.container.children.find((child) => child.id === "level-up-banner");
    expect(banner?.hidden).toBe(false);

    NetworkSystem.resetForTests();
  });

  it("stays quiet on a delivery that crosses no level", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();

    const sys = NetworkSystem.get();
    sys.start("zone-clover-village", 42);
    sys.mountHUD();

    lastSocket!.callbacks.onQuestUpdated!({
      action: "delivery",
      quest: { questId: "quest-village-welcome", state: "completed" },
      quests: [],
      inventory: [],
      stamps: 8,
      xp: 40,
      message: "Delivery complete: Welcome to Clover Village",
      progression: {
        level: 1,
        previousLevel: 1,
        levelsGained: 0,
        experience: 40,
        skillPoints: 0,
        courierRank: "Trainee",
        rankPromotion: null,
      },
    } as never);

    expect(statusCardFlashes).toEqual([]);
    expect(progressionSfx).toEqual([]);
    // The stamp payout still flashes the rating row.
    expect(statusCardStampFlashes).toBe(1);

    NetworkSystem.resetForTests();
  });

  it("shutdown() destroys the status card and cleans up", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();

    const sys = NetworkSystem.get();
    sys.start("zone-clover-village", 42);
    sys.mountHUD();
    expect(statusCardCreateCount).toBe(1);
    expect(statusCardDestroyCount).toBe(0);

    sys.shutdown();
    expect(statusCardDestroyCount).toBe(1);

    NetworkSystem.resetForTests();
  });
});

describe("NetworkSystem session lifecycle", () => {
  const ZONE = "zone-clover-village";
  const remote = { characterId: 7, name: "Birch", classKey: "fox-archer", pos: { x: 3, y: 4 } };
  const critter = { id: "m1", key: "monster-slime", displayName: "Slime", pos: { x: 5, y: 5 }, hp: 10, maxHp: 10, alive: true };
  const fakeScene = () => ({ add: {}, tweens: {}, cameras: { main: {} } }) as unknown as import("phaser").Scene;

  it("shutdown() detaches the scene and resets HP so a new session never builds on the old scene", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();
    const sys = NetworkSystem.get();
    sys.start(ZONE, 42);
    sys.mountHUD();
    sys.attach(fakeScene(), ZONE);
    sys.setPlayerHp(30, 100);
    const onSelfPosition = vi.fn();
    sys.onSelfPosition = onSelfPosition;

    sys.shutdown();
    sys.start(ZONE, 42);
    sys.mountHUD();
    expect(statusCardHp).toEqual([0, 0]);

    // The new socket answers before the new game's scene attaches.
    lastSocket!.callbacks.onZoneState!(ZONE as never, [remote, { ...remote, characterId: 42 }] as never, [critter] as never);
    expect(entityScenes).toEqual([]);
    expect(onSelfPosition).not.toHaveBeenCalled();

    NetworkSystem.resetForTests();
  });

  it("a replaced scene's late detach leaves the new scene attached", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();
    const sys = NetworkSystem.get();
    const oldScene = fakeScene();
    const newScene = fakeScene();
    sys.start(ZONE, 42);
    sys.attach(oldScene, ZONE);
    sys.shutdown();
    sys.start(ZONE, 42);
    sys.attach(newScene, ZONE);

    sys.detach(oldScene);
    lastSocket!.callbacks.onZoneState!(ZONE as never, [remote] as never, [] as never);
    expect(entityScenes).toEqual([newScene]);

    NetworkSystem.resetForTests();
  });

  it("keeps the server's authenticated zone until a scene attaches", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();
    const sys = NetworkSystem.get();
    sys.start(ZONE, 42);
    lastSocket!.callbacks.onAuthenticated!({ accountId: 1, characterId: 42, zoneId: "zone-happy-valley" } as never);
    // zone_state lands while the preloader is still running.
    lastSocket!.callbacks.onZoneState!("zone-happy-valley" as never, [] as never, [] as never);
    expect(sys.getAuthoritativeZone()).toBe("zone-happy-valley");

    sys.attach(fakeScene(), "zone-happy-valley");
    expect(sys.getAuthoritativeZone()).toBeNull();

    NetworkSystem.resetForTests();
  });

  it("routes a refused zone switch back to the last confirmed zone", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();
    const sys = NetworkSystem.get();
    sys.start(ZONE, 42);
    lastSocket!.callbacks.onZoneState!(ZONE as never, [] as never, [] as never);
    sys.joinZone("zone-happy-valley");
    const onRejected = vi.fn();
    const onNotice = vi.fn();
    sys.onZoneJoinRejected = onRejected;
    sys.onGameplayNotice = onNotice;

    lastSocket!.callbacks.onError!("ZONE_FULL" as never, "The valley is full" as never, "join_zone" as never);
    expect(onRejected).toHaveBeenCalledWith(ZONE, "The valley is full");
    expect(onNotice).not.toHaveBeenCalled();

    NetworkSystem.resetForTests();
  });

  it("snaps a respawned monster to its spawn instead of gliding from the death spot", async () => {
    const { NetworkSystem } = await import("../../src/systems/NetworkSystem.ts");
    NetworkSystem.resetForTests();
    const sys = NetworkSystem.get();
    sys.start(ZONE, 42);
    sys.attach(fakeScene(), ZONE);
    lastSocket!.callbacks.onZoneState!(ZONE as never, [] as never, [critter] as never);
    monsterMoves = [];

    lastSocket!.callbacks.onMonsterSnapshot!([{ ...critter, pos: { x: 6, y: 5 } }] as never);
    lastSocket!.callbacks.onMonsterSnapshot!([{ ...critter, alive: false }] as never);
    lastSocket!.callbacks.onMonsterSnapshot!([{ ...critter, pos: { x: 1, y: 1 } }] as never);
    expect(monsterMoves).toEqual(["glide 6,5", "snap 1,1"]);

    NetworkSystem.resetForTests();
  });
});
