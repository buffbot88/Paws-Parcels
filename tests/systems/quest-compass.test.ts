/**
 * Quest compass — the guidance rule, the geometry, and the DOM element.
 *
 * The point of these tests is that a new player is never pointed somewhere
 * wrong: the destination comes from server quest state (a search step before
 * the villager it returns to), the bearing matches the axis the renderer draws
 * (top-down vs the 3/4 3D camera), the arrow stays on screen at the map edges,
 * and a target in another zone yields no arrow at all instead of a direction
 * that means nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The compass component reads the internal canvas size to turn canvas pixels
// into percentages. GameConfig re-exports the Phaser scenes, and Phaser's ESM
// build touches `window`, so the constants are stubbed for this node-environment
// suite — the same approach the other HUD tests take.
vi.mock("../../src/game/GameConfig.ts", () => ({
  TILE_SIZE: 48,
  GAME_WIDTH: 960,
  GAME_HEIGHT: 540,
}));

import {
  clampToCanvas,
  compassArrowPoint,
  compassDistanceTiles,
  compassLabel,
  groundCompassAngle,
  questDestination,
  questMarkerPulse,
  shouldShowCompass,
  tileCentre,
  COMPASS_OFFSET_PX,
  COMPASS_SIZE_PX,
  QUEST_MARKER_PERIOD_MS,
  type ActiveQuest,
  type OrderedQuest,
} from "../../src/ui/hud/questCompass.ts";
import { CAMERA_3D, groundForeshortening } from "../../src/render3d/camera3d.ts";

const CANVAS = { width: 960, height: 540 };

const NPCS = [
  { id: "npc-pip", name: "Pip", homeZone: "zone-clover-village", homeTile: { x: 46, y: 31 } },
  { id: "npc-biscuit", name: "Biscuit", homeZone: "zone-clover-village", homeTile: { x: 38, y: 43 } },
  { id: "npc-moss", name: "Moss", homeZone: "zone-happy-valley", homeTile: { x: 10, y: 10 } },
];

const OBJECTS = [
  { id: "object-rabbit-burrows", label: "Rabbit Burrows", x: 30, y: 20 },
];

function quest(overrides: Partial<ActiveQuest> = {}): ActiveQuest {
  return {
    state: "active",
    giverId: "npc-pip",
    targetId: "npc-pip",
    searchObjectId: null,
    progress: 0,
    ...overrides,
  };
}

function ordered(overrides: Partial<OrderedQuest> = {}): OrderedQuest {
  return { ...quest({ state: "available" }), chainPosition: 1, sideQuest: false, ...overrides };
}

const ZONE = "zone-clover-village";

function resolve(input: {
  active?: ActiveQuest | null;
  quests?: readonly OrderedQuest[];
  zoneId?: string;
}): ReturnType<typeof questDestination> {
  return questDestination({
    active: input.active ?? null,
    quests: input.quests ?? [],
    zoneId: input.zoneId ?? ZONE,
    npcs: NPCS,
    objects: OBJECTS,
  });
}

describe("questDestination", () => {
  it("points at the delivery target's villager", () => {
    expect(resolve({ active: quest({ targetId: "npc-biscuit" }) })).toEqual({
      destination: { id: "npc-biscuit", label: "Biscuit", kind: "npc", tile: { x: 38, y: 43 } },
      reason: "objective",
    });
  });

  it("points at the authored search object before the villager it returns to", () => {
    expect(
      resolve({ active: quest({ targetId: "npc-pip", searchObjectId: "object-rabbit-burrows", progress: 0 }) }),
    ).toEqual({
      destination: { id: "object-rabbit-burrows", label: "Rabbit Burrows", kind: "object", tile: { x: 30, y: 20 } },
      reason: "objective",
    });
  });

  it("switches to the villager once the objective has been found", () => {
    expect(
      resolve({ active: quest({ targetId: "npc-pip", searchObjectId: "object-rabbit-burrows", progress: 1 }) })
        ?.destination.id,
    ).toBe("npc-pip");
  });

  it("guides a brand-new courier to whoever hands out the next leg", () => {
    expect(resolve({ quests: [ordered({ giverId: "npc-pip", chainPosition: 1 })] })).toEqual({
      destination: { id: "npc-pip", label: "Pip", kind: "npc", tile: { x: 46, y: 31 } },
      reason: "giver",
    });
  });

  it("takes the earliest chain quest and never lets an errand jump the queue", () => {
    const guide = resolve({
      quests: [
        ordered({ giverId: "npc-biscuit", chainPosition: 3 }),
        ordered({ giverId: "npc-moss", chainPosition: 0, sideQuest: true }),
        ordered({ giverId: "npc-pip", chainPosition: 2 }),
      ],
    });
    expect(guide?.destination.id).toBe("npc-pip");
    expect(guide?.reason).toBe("giver");
  });

  it("keeps following a quest in progress rather than the next one to take", () => {
    const guide = resolve({
      active: quest({ targetId: "npc-biscuit" }),
      quests: [ordered({ giverId: "npc-biscuit", chainPosition: 2 })],
    });
    expect(guide).toMatchObject({ reason: "objective" });
    expect(guide?.destination.id).toBe("npc-biscuit");
  });

  it("stays silent when there is nothing to go to", () => {
    // No quest in progress and none available.
    expect(resolve({ quests: [ordered({ state: "completed" })] })).toBeNull();
    // Available, but its giver is not in this zone.
    expect(resolve({ quests: [ordered({ giverId: "npc-moss", chainPosition: 1 })] })).toBeNull();
    // Nothing at all.
    expect(resolve({})).toBeNull();
  });

  it("never points at a villager standing in another zone", () => {
    expect(resolve({ active: quest({ targetId: "npc-moss" }) })).toBeNull();
  });
});

describe("compass distance and label", () => {
  it("measures ground distance in tiles", () => {
    expect(compassDistanceTiles({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 6);
  });

  it("converts an authored tile index into the point content actually stands on", () => {
    // Tile 7 spans [7, 8) on the continuous grid the courier's position lives
    // in, so its centre — where the villager art is drawn — is 7.5.
    expect(tileCentre({ x: 7, y: 3 })).toEqual({ x: 7.5, y: 3.5 });
    // Standing on that very tile centre is a distance of zero, not 0.71.
    const villager = tileCentre({ x: 7, y: 3 });
    expect(compassDistanceTiles({ x: 7.5, y: 3.5 }, villager)).toBe(0);
  });

  it("drops out once the courier is standing next to the target", () => {
    expect(shouldShowCompass(1.5)).toBe(false);
    expect(shouldShowCompass(1.51)).toBe(true);
    expect(shouldShowCompass(40)).toBe(true);
  });

  it("names the destination and the remaining distance", () => {
    const pip = { id: "npc-pip", label: "Pip", kind: "npc" as const, tile: { x: 0, y: 0 } };
    expect(compassLabel(pip, 12.4)).toBe("Pip · 12 tiles");
    expect(compassLabel(pip, 1)).toBe("Pip · 1 tile");
    expect(compassLabel(pip, 0.4)).toBe("Pip · here");
  });
});

describe("compass bearing", () => {
  it("puts east at 0 and south at +90 degrees (canvas y grows downward)", () => {
    expect(groundCompassAngle(1, 0)).toBeCloseTo(0, 6);
    expect(groundCompassAngle(0, 1)).toBeCloseTo(Math.PI / 2, 6);
    expect(groundCompassAngle(0, -1)).toBeCloseTo(-Math.PI / 2, 6);
    expect(Math.abs(groundCompassAngle(-1, 0))).toBeCloseTo(Math.PI, 6);
    expect(groundCompassAngle(1, 1)).toBeCloseTo(Math.PI / 4, 6);
  });

  it("flattens the north/south axis under the 3/4 camera, and not in the top-down world", () => {
    const foreshortening = groundForeshortening(CAMERA_3D);
    expect(foreshortening).toBeCloseTo(Math.sin((55 * Math.PI) / 180), 6);
    // A due-south target still points straight down in both renderers.
    expect(groundCompassAngle(0, 10, foreshortening)).toBeCloseTo(Math.PI / 2, 6);
    // A diagonal reads flatter in 3D than its ground angle, because the frame
    // compresses the axis the camera looks along.
    const diagonal3d = groundCompassAngle(10, 10, foreshortening);
    expect(diagonal3d).toBeLessThan(Math.PI / 4);
    expect(diagonal3d).toBeGreaterThan(0);
    // A top-down camera has no tilt, so its factor is exactly 1.
    expect(groundForeshortening({ ...CAMERA_3D, pitchDeg: 90 })).toBeCloseTo(1, 6);
  });
});

describe("compass layout", () => {
  it("floats the arrow a fixed pixel distance ahead, measured in canvas pixels", () => {
    const origin = { x: 0.5, y: 0.5 };
    const east = compassArrowPoint(origin, 0, CANVAS);
    const south = compassArrowPoint(origin, Math.PI / 2, CANVAS);
    const px = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
      Math.hypot((a.x - b.x) * CANVAS.width, (a.y - b.y) * CANVAS.height);
    expect(px(origin, east)).toBeCloseTo(COMPASS_OFFSET_PX, 6);
    expect(px(origin, south)).toBeCloseTo(COMPASS_OFFSET_PX, 6);
    // ...and the offset is resolved per axis, so east and south are different
    // fractions of a 16:9 canvas.
    expect(east.x - origin.x).not.toBeCloseTo(south.y - origin.y, 6);
  });

  it("keeps the arrow inside the play area when the courier hugs an edge", () => {
    const clamped = clampToCanvas({ x: -0.4, y: 1.3 }, COMPASS_SIZE_PX / 2, CANVAS);
    expect(clamped.x).toBeCloseTo(COMPASS_SIZE_PX / 2 / CANVAS.width, 6);
    expect(clamped.y).toBeCloseTo(1 - COMPASS_SIZE_PX / 2 / CANVAS.height, 6);
    // A point with room around it is left exactly where it was.
    expect(clampToCanvas({ x: 0.5, y: 0.5 }, COMPASS_SIZE_PX / 2, CANVAS)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("questMarkerPulse", () => {
  it("expands and fades across one period, then repeats", () => {
    const start = questMarkerPulse(0);
    const middle = questMarkerPulse(QUEST_MARKER_PERIOD_MS / 2);
    const end = questMarkerPulse(QUEST_MARKER_PERIOD_MS);
    expect(start.radiusTiles).toBeCloseTo(2.2, 6);
    expect(middle.radiusTiles).toBeGreaterThan(start.radiusTiles);
    expect(middle.alpha).toBeLessThan(start.alpha);
    expect(end.radiusTiles).toBeCloseTo(start.radiusTiles, 6);
    expect(end.alpha).toBeCloseTo(start.alpha, 6);
  });

  it("stays inside its range for any clock, including a negative one", () => {
    for (const elapsed of [-5000, -1, 0, 137, QUEST_MARKER_PERIOD_MS * 3.7, 1e9]) {
      const pulse = questMarkerPulse(elapsed);
      expect(pulse.radiusTiles).toBeGreaterThanOrEqual(2.2 - 1e-9);
      expect(pulse.radiusTiles).toBeLessThanOrEqual(4.8 + 1e-9);
      expect(pulse.alpha).toBeGreaterThanOrEqual(0);
      expect(pulse.alpha).toBeLessThanOrEqual(0.75 + 1e-9);
    }
  });
});

// ---- DOM component ----------------------------------------------------------

/**
 * A minimal element: the compass positions itself with `style.left/top` and
 * `style.setProperty("--compass-angle", ...)`, so the stub records both.
 */
class FakeStyle {
  left?: string;
  top?: string;
  private readonly properties = new Map<string, string>();
  setProperty(name: string, value: string): void { this.properties.set(name, value); }
  get(name: string): string | undefined { return this.properties.get(name); }
}

class FakeElement {
  id = "";
  className = "";
  hidden = false;
  textContent = "";
  innerHTML = "";
  readonly style = new FakeStyle();
  children: FakeElement[] = [];
  attrs: Record<string, string> = {};
  parent: FakeElement | null = null;

  appendChild<T extends FakeElement>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  append(...nodes: FakeElement[]): void { for (const node of nodes) this.appendChild(node); }
  remove(): void {
    if (this.parent === null) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  setAttribute(name: string, value: string): void { this.attrs[name] = value; }
  getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
  querySelector(): null { return null; }
}

class FakeDocument {
  readonly layer = new FakeElement();
  getElementById(id: string): FakeElement | null {
    return id === "hud-layer" || id === "game-container" ? this.layer : null;
  }
  createElement(_tag: string): FakeElement { return new FakeElement(); }
  createElementNS(_ns: string, _tag: string): FakeElement { return new FakeElement(); }
  querySelector(): null { return null; }
}

let fakeDoc: FakeDocument;

beforeEach(() => {
  fakeDoc = new FakeDocument();
  vi.stubGlobal("document", fakeDoc);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("QuestCompass", () => {
  it("is hidden until it has somewhere to point", async () => {
    const { QuestCompass } = await import("../../src/ui/QuestCompass.ts");
    const compass = new QuestCompass();
    const root = fakeDoc.layer.children[0]!;
    expect(root.id).toBe("quest-compass");
    expect(root.hidden).toBe(true);
    expect(root.attrs["aria-hidden"]).toBe("true");

    compass.update({ origin: { x: 0.5, y: 0.5 }, label: "", angleRad: 0, visible: false });
    expect(root.hidden).toBe(true);
    compass.destroy();
    expect(fakeDoc.layer.children).toHaveLength(0);
  });

  it("aims, positions and captions itself from the frame's numbers", async () => {
    const { QuestCompass } = await import("../../src/ui/QuestCompass.ts");
    const compass = new QuestCompass();
    const root = fakeDoc.layer.children[0]!;

    compass.update({ origin: { x: 0.5, y: 0.5 }, label: "Biscuit · 9 tiles", angleRad: Math.PI / 2, visible: true });
    expect(root.hidden).toBe(false);
    // Half-way across, nudged down by the offset converted through the canvas
    // height, expressed as a percentage for the stylesheet.
    expect(root.style.left).toBe("50%");
    const top = Number.parseFloat(String(root.style.top));
    expect(top).toBeGreaterThan(50);
    expect(top).toBeLessThan(60);
    expect(root.style.get("--compass-angle")).toBe(`${Math.PI / 2}rad`);

    const label = root.children[1]!;
    expect(label.className).toBe("quest-compass__label");
    expect(label.textContent).toBe("Biscuit · 9 tiles");

    compass.update({ origin: { x: 0.5, y: 0.5 }, label: "Biscuit · 8 tiles", angleRad: 0, visible: false });
    expect(root.hidden).toBe(true);
    compass.destroy();
  });
});
