/**
 * Minimal deterministic RGBA rasterizer for node review images.
 *
 * Node has no canvas, so the repo's review generators (`render-tiles.mjs`,
 * `render-composition.mjs`) draw into a plain buffer and encode it with
 * `./png.mjs`. There is no RNG and no clock anywhere in here: the same input
 * always produces the same bytes, which is what makes a generated review image
 * diffsable and testable.
 *
 * The 3x5 font exists so a review image can label its own panels and print the
 * audit's numbers next to the picture they describe — an unlabelled contact
 * sheet of coloured tiles is not reviewable.
 */

/** A tiny 3x5 bitmap font. Rows top-to-bottom, one string of 3 cells per row. */
const GLYPHS = {
  A: "010/101/111/101/101",
  B: "110/101/110/101/110",
  C: "011/100/100/100/011",
  D: "110/101/101/101/110",
  E: "111/100/110/100/111",
  F: "111/100/110/100/100",
  G: "011/100/101/101/011",
  H: "101/101/111/101/101",
  I: "111/010/010/010/111",
  J: "001/001/001/101/010",
  K: "101/101/110/101/101",
  L: "100/100/100/100/111",
  M: "101/111/111/101/101",
  N: "101/111/101/101/101",
  O: "010/101/101/101/010",
  P: "110/101/110/100/100",
  Q: "010/101/101/111/011",
  R: "110/101/110/101/101",
  S: "011/100/010/001/110",
  T: "111/010/010/010/010",
  U: "101/101/101/101/111",
  V: "101/101/101/101/010",
  W: "101/101/111/111/101",
  X: "101/101/010/101/101",
  Y: "101/101/010/010/010",
  Z: "111/001/010/100/111",
  0: "111/101/101/101/111",
  1: "010/110/010/010/111",
  2: "111/001/111/100/111",
  3: "111/001/011/001/111",
  4: "101/101/111/001/001",
  5: "111/100/111/001/111",
  6: "111/100/111/101/111",
  7: "111/001/010/010/010",
  8: "111/101/111/101/111",
  9: "111/101/111/001/111",
  " ": "000/000/000/000/000",
  "-": "000/000/111/000/000",
  "/": "001/001/010/100/100",
  ".": "000/000/000/000/010",
  ":": "000/010/000/010/000",
  "+": "000/010/111/010/000",
  ",": "000/000/000/010/100",
  "%": "101/001/010/100/101",
  "(": "010/100/100/100/010",
  ")": "010/001/001/001/010",
  "=": "000/111/000/111/000",
  "#": "101/111/101/111/101",
  "'": "010/010/000/000/000",
};

/** Glyph cell size and the gap between characters, in unscaled pixels. */
export const FONT = { width: 3, height: 5, advance: 4, lineHeight: 6 };

/** Parse `#rrggbb` (or `#rrggbbaa`) into an RGBA tuple. */
export function hex(value) {
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
    value.length >= 9 ? parseInt(value.slice(7, 9), 16) : 255,
  ];
}

/** The same colour at a different alpha (0..1). */
export function alpha(color, a) {
  return [color[0], color[1], color[2], Math.round(a * 255)];
}

/** Linear blend between two colours, `t` = 0 gives `from`. */
export function mix(from, to, t) {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
    Math.round(from[3] + (to[3] - from[3]) * t),
  ];
}

export class Raster {
  constructor(w, h, background = [0, 0, 0, 255]) {
    this.w = w;
    this.h = h;
    this.buf = new Uint8Array(w * h * 4);
    if (background[3] > 0) this.fillRect(0, 0, w, h, background);
  }

  /** Alpha-composite one pixel. Out-of-bounds writes are ignored. */
  blend(x, y, color) {
    const a = color[3] ?? 255;
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (a === 255) {
      this.buf[i] = color[0];
      this.buf[i + 1] = color[1];
      this.buf[i + 2] = color[2];
      this.buf[i + 3] = 255;
      return;
    }
    const sa = a / 255;
    this.buf[i] = Math.round(color[0] * sa + this.buf[i] * (1 - sa));
    this.buf[i + 1] = Math.round(color[1] * sa + this.buf[i + 1] * (1 - sa));
    this.buf[i + 2] = Math.round(color[2] * sa + this.buf[i + 2] * (1 - sa));
    this.buf[i + 3] = Math.max(this.buf[i + 3], a);
  }

  fillRect(x, y, w, h, color) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) this.blend(xx, yy, color);
    }
  }

  /** Rectangle outline, `lw` pixels thick, drawn inward. */
  strokeRect(x, y, w, h, lw, color) {
    this.fillRect(x, y, w, lw, color);
    this.fillRect(x, y + h - lw, w, lw, color);
    this.fillRect(x, y, lw, h, color);
    this.fillRect(x + w - lw, y, lw, h, color);
  }

  fillEllipse(cx, cy, rx, ry, color) {
    const x0 = Math.floor(cx - rx);
    const x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry);
    const y1 = Math.ceil(cy + ry);
    for (let yy = y0; yy <= y1; yy += 1) {
      for (let xx = x0; xx <= x1; xx += 1) {
        const dx = (xx + 0.5 - cx) / (rx || 1);
        const dy = (yy + 0.5 - cy) / (ry || 1);
        if (dx * dx + dy * dy <= 1) this.blend(xx, yy, color);
      }
    }
  }

  /** An ellipse outline, `lw` pixels thick. */
  strokeEllipse(cx, cy, rx, ry, lw, color) {
    const x0 = Math.floor(cx - rx - lw);
    const x1 = Math.ceil(cx + rx + lw);
    const y0 = Math.floor(cy - ry - lw);
    const y1 = Math.ceil(cy + ry + lw);
    for (let yy = y0; yy <= y1; yy += 1) {
      for (let xx = x0; xx <= x1; xx += 1) {
        const dx = (xx + 0.5 - cx) / (rx || 1);
        const dy = (yy + 0.5 - cy) / (ry || 1);
        const outer = dx * dx + dy * dy;
        const innerRx = Math.max(rx - lw, 0.001);
        const innerRy = Math.max(ry - lw, 0.001);
        const ix = (xx + 0.5 - cx) / innerRx;
        const iy = (yy + 0.5 - cy) / innerRy;
        if (outer <= 1 && ix * ix + iy * iy > 1) this.blend(xx, yy, color);
      }
    }
  }

  /** Blit another raster at (x, y), preserving its alpha. */
  blit(source, x, y) {
    for (let sy = 0; sy < source.h; sy += 1) {
      for (let sx = 0; sx < source.w; sx += 1) {
        const i = (sy * source.w + sx) * 4;
        this.blend(x + sx, y + sy, [
          source.buf[i],
          source.buf[i + 1],
          source.buf[i + 2],
          source.buf[i + 3],
        ]);
      }
    }
  }

  /** Uppercase text in the 3x5 font. `scale` is the pixel size of one cell. */
  text(x, y, value, color, scale = 1) {
    let cx = Math.floor(x);
    for (const raw of String(value).toUpperCase()) {
      const glyph = GLYPHS[raw] ?? GLYPHS["#"];
      for (const [row, line] of glyph.split("/").entries()) {
        for (let col = 0; col < FONT.width; col += 1) {
          if (line[col] !== "1") continue;
          this.fillRect(
            cx + col * scale,
            Math.floor(y) + row * scale,
            scale,
            scale,
            color,
          );
        }
      }
      cx += FONT.advance * scale;
    }
  }

  /** Pixel width `text()` would occupy at this scale. */
  static textWidth(value, scale = 1) {
    return (String(value).length * FONT.advance - 1) * scale;
  }
}

/**
 * Stack rasters vertically, each behind a label band, and return one image.
 *
 * `entries` are `{ label, sublabel, raster }`. The label band carries the panel
 * name and, on the right, the panel's own measured numbers — so a reviewer can
 * read the audit result off the image instead of cross-referencing a log.
 */
export function stackPanels(entries, options = {}) {
  const {
    gap = 8,
    labelHeight = 13,
    pad = 8,
    background = hex("#12171a"),
    labelColor = hex("#e8f0e2"),
    sublabelColor = hex("#8fa08c"),
  } = options;

  const width = Math.max(...entries.map((e) => e.raster.w)) + pad * 2;
  const height =
    entries.reduce((sum, e) => sum + labelHeight + e.raster.h + gap, 0) + pad;
  const sheet = new Raster(width, height, background);

  let y = pad;
  for (const entry of entries) {
    sheet.text(pad, y, entry.label, labelColor, 2);
    if (entry.sublabel) {
      const subX = pad + Raster.textWidth(entry.label, 2) + 8;
      sheet.text(subX, y + 3, entry.sublabel, sublabelColor, 1);
    }
    sheet.blit(entry.raster, pad, y + labelHeight);
    y += labelHeight + entry.raster.h + gap;
  }
  return sheet;
}
