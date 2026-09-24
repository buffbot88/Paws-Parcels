/**
 * Recolour a courier frame's parts while keeping the art's own shading.
 *
 * The class art has no part masks, so parts are recognised by colour: each
 * body's palette separates cleanly by hue and lightness (fur, markings, eyes,
 * outfit, trim). A pixel takes its part's target hue and saturation, and keeps
 * its lightness offset from the part's reference tone, so highlights and
 * shadows survive. Dark pixels on the silhouette edge are outline and never
 * change. Pure, so it is unit-tested without a canvas.
 */
import type { AvatarBody, AvatarColors, AvatarPart } from "./appearance.ts";

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const v = u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
    return Math.round(v * 255);
  };
  const hn = h / 360;
  return s === 0 ? [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)] : [channel(hn + 1 / 3), channel(hn), channel(hn - 1 / 3)];
}

function hexToHsl(hex: string): Hsl {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgbToHsl((value >> 16) & 255, (value >> 8) & 255, value & 255);
}

function hueIn(h: number, lo: number, hi: number): boolean {
  return lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi;
}

/** Which part a colour belongs to on a body, or null for outline, metal, teeth. */
export function classifyColor(body: AvatarBody, r: number, g: number, b: number): AvatarPart | null {
  const { h, s, l } = rgbToHsl(r, g, b);
  if (body === "bear") {
    if (l < 0.05) return null;
    if (hueIn(h, 195, 255) && s > 0.3) return "eyes";
    if (s < 0.15 && l < 0.35) return "outfit";
    if (hueIn(h, 335, 15) && s > 0.3) return "accent";
    if (hueIn(h, 15, 40) && s >= 0.2) return l >= 0.78 ? "fur2" : l >= 0.25 ? "fur" : null;
    return null;
  }
  if (body === "cat") {
    if (l < 0.1) return null;
    if (hueIn(h, 235, 295) && s > 0.3) return "eyes";
    if (l >= 0.75 && hueIn(h, 290, 60) && s > 0.2) return "fur2";
    if (hueIn(h, 295, 10) && s >= 0.15) return "fur";
    return null;
  }
  if (l < 0.1) return null;
  if (hueIn(h, 170, 210) && s > 0.5) return "eyes";
  if (hueIn(h, 335, 22) && s > 0.35 && l < 0.5) return "accent";
  if (hueIn(h, 15, 48) && s >= 0.45 && l >= 0.38 && l < 0.79) return "fur";
  if (hueIn(h, 5, 60) && s >= 0.3 && l >= 0.76) return "fur2";
  if (s < 0.4 && l < 0.3) return "outfit";
  return null;
}

/** Each part's mid tone in the authored art: the lightness a target colour lands on. */
export const PART_REFERENCE: Readonly<Record<AvatarBody, AvatarColors>> = {
  bear: { fur: "#deb17b", fur2: "#efd9ca", eyes: "#0e4aa0", outfit: "#2b2929", accent: "#a95556" },
  cat: { fur: "#af206f", fur2: "#f8c9d6", eyes: "#3a38c7" },
  fox: { fur: "#fcb65e", fur2: "#f6e7db", eyes: "#74fcfd", outfit: "#2f222b", accent: "#4b2523" },
};

const OUTLINE_MAX_LIGHTNESS = 0.25;

/** A recoloured copy of one RGBA frame. Parts without a colour keep their art. */
export function recolorPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  body: AvatarBody,
  colors: AvatarColors,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  const cache = new Map<number, [number, number, number] | null>();
  const alphaAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : (data[(y * width + x) * 4 + 3] ?? 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if ((data[i + 3] ?? 0) === 0) continue;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const edge = alphaAt(x + 1, y) === 0 || alphaAt(x - 1, y) === 0 || alphaAt(x, y + 1) === 0 || alphaAt(x, y - 1) === 0;
      if (edge && rgbToHsl(r, g, b).l < OUTLINE_MAX_LIGHTNESS) continue;
      const colorKey = (r << 16) | (g << 8) | b;
      let mapped = cache.get(colorKey);
      if (mapped === undefined) {
        mapped = null;
        const part = classifyColor(body, r, g, b);
        const target = part === null ? undefined : colors[part];
        const reference = part === null ? undefined : PART_REFERENCE[body][part];
        if (target !== undefined && reference !== undefined) {
          const pixel = rgbToHsl(r, g, b);
          const goal = hexToHsl(target);
          const ref = hexToHsl(reference);
          mapped = hslToRgb({
            h: goal.h,
            s: Math.min(1, goal.s * (ref.s > 0.01 ? pixel.s / ref.s : 1)),
            l: Math.min(0.98, Math.max(0.02, goal.l + (pixel.l - ref.l))),
          });
        }
        cache.set(colorKey, mapped);
      }
      if (mapped !== null) {
        out[i] = mapped[0];
        out[i + 1] = mapped[1];
        out[i + 2] = mapped[2];
      }
    }
  }
  return out;
}
