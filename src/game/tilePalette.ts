/**
 * Shared, tunable drawing parameters for the procedural ground textures.
 * Single source of truth consumed by the browser factory (TileTextures.ts),
 * the dev renderer (scripts/render-tiles.mjs) and the VL auto-tuner
 * (scripts/auto-tune-tiles.mjs) — so the review image always matches the
 * game, and the tuner can adjust the shipped look automatically.
 *
 * Per tile: `dark`/`light` are the contrast pair the tuner moves (darken the
 * dark accents, lighten the light ones); `darkCount`/`lightCount` scale the
 * amount of detail (noise); `darkAlt`/`lightAlt` are secondary tones
 * (alternate bricks, nails, plank tints, flower cores).
 */

export interface TileTextureParams {
  /** Dark accent color (speckles, stones, joints, waves, foliage shadows). */
  dark: string;
  /** Light accent color (blades, highlights, ripples, foliage highlights). */
  light: string;
  /** Number of dark accents to draw (decorative detail / noise). */
  darkCount?: number;
  /** Number of light accents to draw (decorative detail / noise). */
  lightCount?: number;
  /** Secondary dark tone (alternate brick, nails, second stone shade). */
  darkAlt?: string;
  /** Secondary light tone (plank tint, flower petals/core). */
  lightAlt?: string;
}

/** Palette keyed by tile code (G P F W ~ T B X — see src/game/Tiles.ts). */
export type TilePalette = Record<string, TileTextureParams>;

/**
 * Current tuned look. ⚠ The VL auto-tuner (scripts/auto-tune-tiles.mjs)
 * rewrites this literal when it applies a tuning pass — keep it in sync with
 * scripts/render-tiles.mjs (which imports it).
 */
export const DEFAULT_TILE_PALETTE: TilePalette = {
  "G": {
    "dark": "#6fae6a",
    "light": "#a5d99e",
    "darkCount": 64,
    "lightCount": 8
  },
  "P": {
    "dark": "#a37a44",
    "light": "#ffe6b3",
    "darkCount": 9,
    "lightCount": 9,
    "darkAlt": "#a1733b"
  },
  "F": {
    "dark": "#a87f52",
    "light": "#dfbc97",
    "darkCount": 12,
    "darkAlt": "#946e42",
    "lightAlt": "#d6ae86"
  },
  "W": {
    "dark": "#8d7a68",
    "light": "#a08a74",
    "darkAlt": "#927c68"
  },
  "~": {
    "dark": "#5792b7",
    "light": "#e5ffff",
    "darkCount": 9,
    "lightCount": 3
  },
  "T": {
    "dark": "#0f4a14",
    "light": "#89d38e",
    "darkCount": 21,
    "lightCount": 21
  },
  "B": {
    "dark": "#195e20",
    "light": "#a2ea9e",
    "darkCount": 14,
    "lightCount": 14
  },
  "X": {
    "dark": "#a34485",
    "light": "#ffcdfb",
    "lightCount": 7,
    "lightAlt": "#ffe854"
  }
};

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Shift a `#rrggbb` color: positive `delta` lightens toward white, negative
 * darkens toward black (linear RGB, used by the contrast tuning).
 */
export function tone(hexColor: string, delta: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hexColor)) return hexColor;
  const n = parseInt(hexColor.slice(1), 16);
  const r = clampByte(((n >> 16) & 255) + 255 * delta);
  const g = clampByte(((n >> 8) & 255) + 255 * delta);
  const b = clampByte((n & 255) + 255 * delta);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Scale a decorative count by a noise delta (-1..1); clamped, integer. */
function scaleCount(count: number | undefined, noise: number): number | undefined {
  if (count === undefined) return undefined;
  return Math.max(2, Math.min(200, Math.round(count * (1 + noise))));
}

/**
 * Apply per-tile tuning deltas ({ contrast, noise } ∈ [-1, 1]) to a palette.
 * Contrast moves the dark/light pairs apart (or together); noise scales the
 * decorative counts. Returns a new palette (input untouched).
 */
export function adjustPalette(
  palette: TilePalette,
  deltas: Record<string, { contrast?: number; noise?: number }>,
): TilePalette {
  const out: TilePalette = {};
  for (const [code, p] of Object.entries(palette)) {
    const d = deltas[code];
    if (d === undefined) {
      out[code] = p;
      continue;
    }
    const c = d.contrast ?? 0;
    const n = d.noise ?? 0;
    out[code] = {
      ...p,
      dark: tone(p.dark, -c),
      light: tone(p.light, c),
      darkAlt: p.darkAlt === undefined ? undefined : tone(p.darkAlt, -c * 0.6),
      lightAlt: p.lightAlt === undefined ? undefined : tone(p.lightAlt, c * 0.6),
      darkCount: scaleCount(p.darkCount, n),
      lightCount: scaleCount(p.lightCount, n),
    };
  }
  return out;
}
