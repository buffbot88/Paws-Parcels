/**
 * Per-zone atmosphere shared by both renderers: fog colours and the drifting
 * ambient motes. Pure (no three.js), so the 2D world can use it without
 * pulling the 3D renderer into the main bundle.
 */

/** Distance fog, in tiles of view depth (the camera sits ~15.6 tiles from its focus). */
export interface ZoneFog {
  readonly colour: number;
  readonly near: number;
  readonly far: number;
}

/** How one zone's motes look and move. */
export interface AmbientStyle {
  readonly count: number;
  readonly colour: number;
  /** Point size in tiles. */
  readonly sizeTiles: number;
  /** Steady drift, in tiles per second. */
  readonly drift: { readonly x: number; readonly y: number; readonly z: number };
  /** Wander amplitude, in tiles. */
  readonly sway: number;
  /** Fireflies pulse; pollen glows steadily. */
  readonly blink: boolean;
  /** The box the motes fill around the camera focus, in tiles. */
  readonly box: { readonly width: number; readonly height: number; readonly depth: number };
}

export interface ZoneAtmosphere {
  readonly fog: ZoneFog;
  readonly ambient: AmbientStyle;
}

const ATMOSPHERE: Readonly<Record<string, ZoneAtmosphere>> = {
  // Warm evening haze and fireflies over the village.
  "zone-clover-village": {
    fog: { colour: 0x5e5238, near: 18, far: 40 },
    ambient: {
      count: 70,
      colour: 0xffd27a,
      sizeTiles: 0.16,
      drift: { x: 0.05, y: 0.02, z: 0 },
      sway: 0.45,
      blink: true,
      box: { width: 22, height: 2.6, depth: 16 },
    },
  },
  // Slightly cooler valley air, pollen drifting down on the breeze.
  "zone-happy-valley": {
    fog: { colour: 0x4f5e52, near: 18, far: 42 },
    ambient: {
      count: 120,
      colour: 0xf4f0c8,
      sizeTiles: 0.09,
      drift: { x: 0.35, y: -0.12, z: 0.08 },
      sway: 0.3,
      blink: false,
      box: { width: 22, height: 3.2, depth: 16 },
    },
  },
};

/** A zone's fog and motes; unknown zones borrow the village's. */
export function zoneAtmosphere(zoneId: string): ZoneAtmosphere {
  return ATMOSPHERE[zoneId] ?? (ATMOSPHERE["zone-clover-village"] as ZoneAtmosphere);
}

/** A stable pseudo-random 0-1 value per (index, salt). */
function hash(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/** `value` wrapped into `[start, start + span)`, negatives included. */
export function wrapInto(value: number, start: number, span: number): number {
  return start + (((value - start) % span) + span) % span;
}

/**
 * Where mote `index` is at `timeSeconds`, and how brightly it glows (0-1).
 *
 * Motes are anchored in the world and wrap into the box around `focus`, so they
 * stay put as the camera pans instead of travelling with it.
 */
export function ambientPoint(
  style: AmbientStyle,
  index: number,
  timeSeconds: number,
  focus: { readonly x: number; readonly z: number },
): { x: number; y: number; z: number; glow: number } {
  const { box, drift, sway } = style;
  const phase = hash(index, 4) * Math.PI * 2;
  const rate = 0.35 + hash(index, 5) * 0.5;
  const t = timeSeconds * rate + phase;
  const rawX = hash(index, 1) * box.width + drift.x * timeSeconds + Math.sin(t) * sway;
  const rawY = hash(index, 2) * box.height + drift.y * timeSeconds + Math.sin(t * 1.3) * sway * 0.4;
  const rawZ = hash(index, 3) * box.depth + drift.z * timeSeconds + Math.cos(t * 0.8) * sway;
  const glow = style.blink ? Math.max(0, Math.sin(t * 2.1)) ** 2 : 0.55 + 0.25 * Math.sin(t);
  return {
    x: wrapInto(rawX, focus.x - box.width / 2, box.width),
    y: wrapInto(rawY, 0.15, box.height),
    z: wrapInto(rawZ, focus.z - box.depth / 2, box.depth),
    glow,
  };
}
