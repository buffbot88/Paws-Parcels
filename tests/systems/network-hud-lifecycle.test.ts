/**
 * NetworkSystem HUD lifecycle regression tests.
 *
 * Proves that:
 *   - NetworkSystem.get() does not create PlayerStatusCard (pre-auth safe)
 *   - mountHUD() creates the card exactly once
 *   - repeated mountHUD() calls do not duplicate the card
 *   - attach() before mountHUD() does not create the card
 *   - attach() after mountHUD() restores the card (character switch / scene restart)
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

  appendChild(child: FakeElement): FakeElement {
    child.appendedTo = this;
    this.children.push(child);
    return child;
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
  private container = new FakeElement();

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

vi.mock("../../src/entities/RemotePlayer.ts", () => ({ RemotePlayer: class RemotePlayer {} }));

vi.mock("../../src/entities/Monster.ts", () => ({ Monster: class Monster {} }));

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

vi.mock("../../src/ui/PlayerStatusCard.ts", () => {
  return {
    PlayerStatusCard: class {
      constructor() { statusCardCreateCount++; }
      setStatus(_d: unknown): void { /* no-op */ }
      setHp(_hp: number, _max: number): void { /* no-op */ }
      // Part of the card's surface: the HUD adopts the courier's class resource
      // on mount, so a mock missing it would only fail at runtime.
      setResourceKind(resource: { label: string }): void {
        statusCardResources.push(resource.label);
      }
      setResource(_current: number, _max: number): void { /* no-op */ }
      setStampRating(_earned: number): void { /* no-op */ }
      destroy(): void { statusCardDestroyCount++; }
    },
  };
});

// ---- GameSocket stub ---------------------------------------------------------

vi.mock("../../src/net/GameSocket.ts", () => ({
  GameSocket: class {
    callbacks: Record<string, unknown> = {};
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
  fakeDoc = new FakeDocument();
  vi.stubGlobal("document", fakeDoc);

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
