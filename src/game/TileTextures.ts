import { TILE_SIZE } from "./GameConfig.ts";
import type { TileDefinition } from "./Tiles.ts";
import { DEFAULT_TILE_PALETTE, type TileTextureParams } from "./tilePalette.ts";

/**
 * Procedural ground textures for the placeholder tileset (no binary assets —
 * BuildPlan keeps placeholders until art lands). Each tile frame is rendered
 * at 2x resolution with deterministic seeded detail (speckles, stones, planks,
 * bricks, waves, foliage) and downsampled into the sheet, so the ground reads
 * as textured instead of flat color while staying byte-for-byte stable across
 * reloads and players. All colors/counts come from the shared tunable palette
 * (tilePalette.ts) — the VL auto-tuner can adjust the shipped look directly.
 */

/** Render detail at 2x and downsample for softer edges. */
const DETAIL_SCALE = 2;

/** Deterministic PRNG (mulberry32) — same seed, same texture, every time. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function range(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

type Ctx = CanvasRenderingContext2D;

function drawGrass(ctx: Ctx, rng: () => number, size: number, p: TileTextureParams): void {
  // Darker blades of grass (noise = speckle count).
  ctx.fillStyle = p.dark;
  for (let i = 0; i < (p.darkCount ?? 64); i++) {
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, range(rng, 1.5, 3.5), 0, Math.PI * 2);
    ctx.fill();
  }
  // Lighter upright strokes.
  ctx.fillStyle = p.light;
  for (let i = 0; i < (p.lightCount ?? 8); i++) {
    ctx.fillRect(rng() * size, rng() * size, 2, range(rng, 5, 9));
  }
  // A few tiny wildflowers (fixed — pure charm).
  for (let i = 0; i < 3; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.fillStyle = "#f7f2c8";
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f2d13d";
    ctx.beginPath();
    ctx.arc(x, y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPath(ctx: Ctx, rng: () => number, size: number, p: TileTextureParams): void {
  // Trodden stones, tilted a little each way (dark + light halves).
  for (let i = 0; i < (p.darkCount ?? 8); i++) {
    ctx.fillStyle = p.dark;
    ctx.beginPath();
    ctx.ellipse(
      rng() * size,
      rng() * size,
      range(rng, 4, 9),
      range(rng, 3, 5.5),
      rng() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  for (let i = 0; i < (p.lightCount ?? 8); i++) {
    ctx.fillStyle = p.light;
    ctx.beginPath();
    ctx.ellipse(
      rng() * size,
      rng() * size,
      range(rng, 4, 9),
      range(rng, 3, 5.5),
      rng() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  // Dirt speckle.
  ctx.fillStyle = p.darkAlt ?? "#b88a52";
  for (let i = 0; i < 44; i++) {
    ctx.fillRect(rng() * size, rng() * size, 2, 2);
  }
}

function drawFloor(ctx: Ctx, rng: () => number, size: number, p: TileTextureParams): void {
  // Horizontal wood planks with staggered joints.
  const plank = size / 6;
  for (let row = 0; row < 6; row++) {
    const y = row * plank;
    ctx.fillStyle = row % 2 === 0 ? p.light : (p.lightAlt ?? p.light);
    ctx.fillRect(0, y + 2, size, plank - 4);
    ctx.fillStyle = p.dark;
    const joint = (row % 2 === 0 ? 22 : 40) + rng() * 8;
    ctx.fillRect(joint, y + 2, 3, plank - 4);
    ctx.fillRect(joint + plank * 2.4 + rng() * 6, y + 2, 3, plank - 4);
  }
  // Nail heads.
  ctx.fillStyle = p.darkAlt ?? "#946e42";
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWall(ctx: Ctx, rng: () => number, size: number, p: TileTextureParams): void {
  // Mortar bed first, then staggered brick courses over it (running bond).
  ctx.fillStyle = "#6f5f50";
  ctx.fillRect(0, 0, size, size);
  const brickH = size / 4;
  const brickW = size / 3;
  for (let row = 0; row < 4; row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col < 4; col++) {
      const x = col * brickW + offset;
      const y = row * brickH;
      ctx.fillStyle = rng() < 0.5 ? p.dark : (p.darkAlt ?? p.dark);
      ctx.fillRect(x + 2, y + 2, brickW - 6, brickH - 4);
      ctx.fillStyle = p.light;
      ctx.fillRect(x + 2, y + 2, brickW - 6, 3);
    }
  }
}

function drawWater(ctx: Ctx, rng: () => number, size: number, p: TileTextureParams): void {
  // Soft wave lines (slightly deeper blue per VL review).
  ctx.strokeStyle = p.dark;
  ctx.lineCap = "round";
  for (let i = 0; i < (p.darkCount ?? 8); i++) {
    const y = range(rng, 6, size - 6);
    const phase = rng() * 20;
    ctx.globalAlpha = range(rng, 0.35, 0.65);
    ctx.lineWidth = range(rng, 1.5, 3);
    ctx.beginPath();
    for (let x = 0; x <= size; x += 6) {
      const yy = y + Math.sin((x + phase) / 9) * 2.2;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Shimmering ripple rings.
  ctx.strokeStyle = p.light;
  ctx.lineWidth = 2;
  for (let i = 0; i < (p.lightCount ?? 3); i++) {
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, range(rng, 4, 8), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawFoliage(
  ctx: Ctx,
  rng: () => number,
  size: number,
  p: TileTextureParams,
  radius: number,
): void {
  const count = p.darkCount ?? 14;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rng() < 0.5 ? p.dark : p.light;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, range(rng, radius * 0.4, radius), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFlower(ctx: Ctx, rng: () => number, size: number, p: TileTextureParams): void {
  // Scattered blossoms: petals around a sunny center.
  for (let i = 0; i < (p.lightCount ?? 7); i++) {
    const x = rng() * size;
    const y = rng() * size;
    const petals = 5 + Math.floor(rng() * 3);
    ctx.fillStyle = p.light;
    for (let petal = 0; petal < petals; petal++) {
      const a = (petal / petals) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = p.lightAlt ?? "#f2d13d";
    ctx.beginPath();
    ctx.arc(x, y, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Render one tile's frame at 2x (base + palette texture detail + edge bars). */
function renderTileDetail(tile: TileDefinition): HTMLCanvasElement {
  const size = TILE_SIZE * DETAIL_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return canvas;
  const rng = seededRandom((tile.index + 1) * 7919);
  const p = DEFAULT_TILE_PALETTE[tile.code];

  ctx.fillStyle = cssHex(tile.base);
  ctx.fillRect(0, 0, size, size);

  if (p !== undefined) {
    switch (tile.code) {
      case "G":
        drawGrass(ctx, rng, size, p);
        break;
      case "P":
        drawPath(ctx, rng, size, p);
        break;
      case "F":
        drawFloor(ctx, rng, size, p);
        break;
      case "W":
        drawWall(ctx, rng, size, p);
        break;
      case "~":
        drawWater(ctx, rng, size, p);
        break;
      case "T":
        drawFoliage(ctx, rng, size, p, 11);
        break;
      case "B":
        drawFoliage(ctx, rng, size, p, 9);
        break;
      case "X":
        drawFlower(ctx, rng, size, p);
        break;
    }
  }

  // Depth edge bars sit on top of the detail (keeps the established look).
  ctx.fillStyle = cssHex(tile.edge);
  ctx.fillRect(0, 0, size, TILE_SIZE / 2);
  ctx.fillRect(0, size - TILE_SIZE / 2, size, TILE_SIZE / 2);
  return canvas;
}

/**
 * Build the full tileset sheet as a canvas: one frame per tile, rendered at
 * 2x detail and downsampled to TILE_SIZE. Matches the layout the map's
 * addTilesetImage expects (TILESET_COLUMNS wide, tile.index frames).
 */
export function renderTilesetCanvas(
  tiles: readonly TileDefinition[],
  columns: number,
): HTMLCanvasElement {
  const sheet = document.createElement("canvas");
  sheet.width = columns * TILE_SIZE;
  sheet.height = Math.ceil(tiles.length / columns) * TILE_SIZE;
  const ctx = sheet.getContext("2d");
  if (ctx === null) return sheet;
  for (const tile of tiles) {
    const fx = (tile.index % columns) * TILE_SIZE;
    const fy = Math.floor(tile.index / columns) * TILE_SIZE;
    ctx.drawImage(renderTileDetail(tile), fx, fy, TILE_SIZE, TILE_SIZE);
  }
  return sheet;
}
