#!/usr/bin/env node
/**
 * Deterministic generator for the NEW Clover Village map (75x75).
 *
 * The map is authored to match the approved reference composition:
 *   - Courier Square plaza at the center (37,28) with flower bed, bench,
 *     banners and lanterns
 *   - Two-story Post Office (Building 17 art) north of the plaza
 *   - Café west, Research Shop east, Florist southeast — the delivery loop
 *   - Fenced open garden south of the plaza (Moss — no building)
 *   - Two background cottages (NW + SE-of-garden)
 *   - NW pond with footbridge + Rabbit Burrow landmark
 *   - Hollow Oak clearing off a woodland trail (southwest)
 *   - SE pond with footbridge + picnic clearing
 *   - Long southern road through a banner gate to the Happy Valley exit
 *
 * Tiles: G grass, P path, F floor, W wall, ~ water, T tree, B bush, X flower.
 * Buildings are authored as real W footprints so collision matches the
 * visible 2.5D art; fences/props stay visual-only set pieces.
 *
 * Run: node scripts/generate-clover-village.mjs
 * Writes: src/data/maps/clover-village.json (deterministic, seed 7)
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const W = 75;
const H = 75;

/** Deterministic PRNG (mulberry32) so regeneration is byte-stable. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(7);

const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => "G"));

function set(x, y, code) {
  if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = code;
}
function get(x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return "T";
  return grid[y][x];
}
function hline(y, x0, x1, code = "P") {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) set(x, y, code);
}
function vline(x, y0, y1, code = "P") {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) set(x, y, code);
}
function rect(x0, y0, x1, y1, code) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, code);
}

// ---------------------------------------------------------------------------
// Authored layout (tile coordinates)
// ---------------------------------------------------------------------------
const SPAWN = { x: 37, y: 31 };
const PLAZA = { x: 37, y: 28, r: 7.6 };

const BUILDINGS = [
  { name: "post-office", x0: 33, y0: 15, x1: 41, y1: 22, door: { x: 37, y: 23 } },
  { name: "cafe", x0: 15, y0: 25, x1: 19, y1: 28, door: { x: 17, y: 29 } },
  { name: "research-shop", x0: 51, y0: 22, x1: 56, y1: 26, door: { x: 54, y: 27 } },
  { name: "florist", x0: 55, y0: 35, x1: 59, y1: 38, door: { x: 57, y: 39 } },
  { name: "cottage-nw", x0: 14, y0: 43, x1: 16, y1: 46, door: { x: 15, y: 47 } },
  { name: "cottage-ne", x0: 55, y0: 45, x1: 57, y1: 47, door: { x: 56, y: 48 } },
];

const NPC_TILES = {
  "npc-pip": { x: 37, y: 24, code: "P" },
  "npc-biscuit": { x: 19, y: 30, code: "P" },
  "npc-lumi": { x: 52, y: 28, code: "P" },
  "npc-maple": { x: 56, y: 40, code: "P" },
  "npc-moss": { x: 46, y: 43, code: "G" },
};

const GARDEN = { x0: 40, y0: 40, x1: 52, y1: 47, opening: { x: 40, y: 43 } };

// ---------------------------------------------------------------------------
// 1. Forest border + dense woodland bands
// ---------------------------------------------------------------------------
rect(0, 0, W - 1, 3, "T");
rect(0, H - 4, W - 1, H - 1, "T");
rect(0, 0, 3, H - 1, "T");
rect(W - 4, 0, W - 1, H - 1, "T");

// Keep-clear zones: village district + authored clearings stay open.
const CLEAR_OF = [
  { x: 37, y: 28, r: 24 }, // village district around the plaza
  { x: 17, y: 9, r: 8 }, // rabbit burrow clearing
  { x: 8, y: 7, r: 7 }, // NW pond
  { x: 14, y: 58, r: 8 }, // hollow oak clearing
  { x: 65, y: 57, r: 7 }, // picnic clearing
  { x: 55, y: 63, r: 9 }, // SE pond
  { x: 15, y: 45, r: 7 }, // NW cottage lawn
  { x: 56, y: 47, r: 7 }, // NE cottage lawn
];
function inClearing(x, y) {
  return CLEAR_OF.some((c) => Math.hypot(x - c.x, y - c.y) < c.r);
}

// Woodland clusters fill the frontier bands between clearings.
const FOREST_BANDS = [
  { cx0: 5, cy0: 5, cx1: 69, cy1: 18 }, // north woodland
  { cx0: 5, cy0: 52, cx1: 69, cy1: 69 }, // south woodland
  { cx0: 5, cy0: 19, cx1: 24, cy1: 51 }, // west woodland
  { cx0: 60, cy0: 19, cx1: 69, cy1: 51 }, // east woodland
  { cx0: 25, cy0: 48, cx1: 55, cy1: 51 }, // mid-south belt
];
for (let i = 0; i < 90; i++) {
  const band = FOREST_BANDS[i % FOREST_BANDS.length];
  const cx = band.cx0 + Math.floor(rng() * (band.cx1 - band.cx0 + 1));
  const cy = band.cy0 + Math.floor(rng() * (band.cy1 - band.cy0 + 1));
  const r = 2 + Math.floor(rng() * 4);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 2 || x >= W - 2 || y < 2 || y >= H - 2) continue;
      if (inClearing(x, y)) continue;
      if (rng() < 0.62) set(x, y, "T");
    }
  }
}

// Scattered bushes + flowers everywhere outside the plaza core.
for (let i = 0; i < 240; i++) {
  const x = 4 + Math.floor(rng() * (W - 8));
  const y = 4 + Math.floor(rng() * (H - 8));
  if (Math.hypot(x - PLAZA.x, y - PLAZA.y) < 12) continue;
  if (get(x, y) === "G" && rng() < 0.75) set(x, y, "B");
}
for (let i = 0; i < 190; i++) {
  const x = 4 + Math.floor(rng() * (W - 8));
  const y = 4 + Math.floor(rng() * (H - 8));
  if (Math.hypot(x - PLAZA.x, y - PLAZA.y) < 13) continue;
  if (get(x, y) === "G" && rng() < 0.7) set(x, y, "X");
}

// ---------------------------------------------------------------------------
// 2. Water: NW pond (+ outlet neck) and SE pond
// ---------------------------------------------------------------------------
function blob(cx, cy, r) {
  const R = Math.ceil(r) + 2;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 4 || x >= W - 4 || y < 4 || y >= H - 4) continue;
      const d = Math.hypot(dx, dy);
      const wobble = 0.72 + 0.46 * Math.sin(dx * 1.7 + dy * 0.9);
      if (d < r * wobble) set(x, y, "~");
    }
  }
}
blob(8, 7, 3.4);
// Forced outlet neck so the footbridge art sits over real water.
hline(11, 7, 9, "~");
blob(55, 63, 5.2);

// ---------------------------------------------------------------------------
// 3. Roads — carved after scatter/water so they always connect
// ---------------------------------------------------------------------------
// North road from the forest edge into the plaza.
vline(37, 3, 21);
vline(38, 3, 21);
// West branch to the burrow clearing + pond shore.
hline(12, 12, 37);
vline(17, 10, 12);
// Plaza disk (Courier Square).
for (let y = PLAZA.y - 9; y <= PLAZA.y + 9; y++) {
  for (let x = PLAZA.x - 9; x <= PLAZA.x + 9; x++) {
    const d = Math.hypot(x - PLAZA.x, y - PLAZA.y);
    if (d <= PLAZA.r) set(x, y, "P");
    else if (d <= PLAZA.r + 1 && get(x, y) === "T") set(x, y, "B");
  }
}
// West arm to the café.
hline(29, 17, 30);
// East arm to the research shop.
hline(27, 45, 54);
// Southeast connector down to the florist road.
vline(44, 31, 39);
hline(39, 44, 57);
// South road to Happy Valley.
vline(37, 36, 74);
vline(38, 36, 74);
// Southern ring road serving both cottages.
hline(49, 15, 56);
vline(15, 47, 49);
vline(56, 48, 49);
// Picnic spur + shore road by the SE pond.
vline(50, 49, 56);
hline(56, 50, 66);
// Hollow Oak woodland trail (narrow, off the south road).
hline(57, 16, 36);
vline(15, 57, 58);
set(14, 58, "P");
vline(14, 58, 59);
// Garden entrance path (west opening).
set(39, 43, "P");
set(40, 43, "P");
// Gateway widening at the southern exit.
rect(35, 70, 40, 74, "P");
hline(70, 36, 39);
// Small pads in front of cottage/café doors.
set(19, 30, "P");
set(52, 28, "P");
set(56, 40, "P");

// ---------------------------------------------------------------------------
// 4. Buildings — real collision footprints over the roads
// ---------------------------------------------------------------------------
for (const b of BUILDINGS) {
  rect(b.x0, b.y0, b.x1, b.y1, "W");
  set(b.door.x, b.door.y, "P");
  // Porch tiles below the door keep entrances approachable.
  if (get(b.door.x, b.door.y + 1) === "T") set(b.door.x, b.door.y + 1, "P");
}

// ---------------------------------------------------------------------------
// 5. Plaza flower bed + garden beds
// ---------------------------------------------------------------------------
rect(36, 27, 38, 28, "X");
// Garden flower beds inside the fence line (visual garden plot).
for (let y = GARDEN.y0 + 1; y <= GARDEN.y1 - 1; y++) {
  for (let x = GARDEN.x0 + 1; x <= GARDEN.x1 - 1; x++) {
    if ((x + y) % 3 === 0 && get(x, y) !== "P") set(x, y, "X");
    else if ((x * y) % 5 === 0 && get(x, y) === "G") set(x, y, "B");
  }
}
set(NPC_TILES["npc-moss"].x, NPC_TILES["npc-moss"].y, "G");
// Bushy shore dressing around both ponds.
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== "~") continue;
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (get(nx, ny) === "G" && rng() < 0.5) set(nx, ny, "B");
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Landmark pads — guarantee key tiles are walkable
// ---------------------------------------------------------------------------
const KEY_TILES = [
  SPAWN,
  ...BUILDINGS.map((b) => b.door),
  ...Object.values(NPC_TILES),
  { x: 39, y: 8 }, // welcome sign
  { x: 18, y: 11 }, // rabbit burrows (adjacent to landmark art at 18.6,11.4)
  { x: 49, y: 56 }, // pond edge
  { x: 14, y: 59 }, // hollow oak
  { x: 65, y: 57 }, // picnic blanket
  { x: 37, y: 74 }, // happy valley transition
];
function pad(pt) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = pt.x + dx;
      const y = pt.y + dy;
      const code = get(x, y);
      if (code === "T" || code === "~") set(x, y, "G");
    }
  }
}
for (const pt of KEY_TILES) pad(pt);
// Re-assert the exact NPC path tiles after padding.
for (const { x, y, code } of Object.values(NPC_TILES)) {
  if (code === "P") set(x, y, "P");
}

// ---------------------------------------------------------------------------
// 7. Interactables (positions must match the pads above)
// ---------------------------------------------------------------------------
const interactables = [
  {
    id: "object-counter",
    kind: "counter",
    label: "Post Office Counter",
    x: 37,
    y: 23,
    lines: [
      "The post office front desk stands open beneath the big timber sign. Deliveries begin here.",
    ],
  },
  {
    id: "object-post-counter",
    kind: "counter",
    label: "Counter Corner",
    x: 36,
    y: 23,
    lines: ["A brass glint catches your eye at the corner of the counter."],
  },
  {
    id: "object-quest-board",
    kind: "quest-board",
    label: "Quest Board",
    x: 41,
    y: 30,
    lines: [
      "A corkboard of quest cards stands at the edge of Courier Square — check back often.",
    ],
  },
  {
    id: "object-mailbox",
    kind: "mailbox",
    label: "Mailbox",
    x: 33,
    y: 30,
    lines: [
      "Your little green mailbox. It's empty right now — nothing to claim yet.",
    ],
  },
  {
    id: "object-shop",
    kind: "shop",
    label: "Research Shop Shelf",
    x: 53,
    y: 28,
    lines: [
      "Lumi's outdoor shelf glimmers with lenses, jars, and shiny things… for now.",
    ],
  },
  {
    id: "object-welcome-sign",
    kind: "sign",
    label: "Welcome Sign",
    x: 39,
    y: 8,
    lines: [
      "Welcome to Clover Village! Letters, parcels, and very organized hedgehogs.",
    ],
  },
  {
    id: "object-rabbit-burrows",
    kind: "sign",
    label: "Rabbit Burrows",
    x: 18,
    y: 11,
    lines: [
      "The rabbits are watching you very carefully. Something shiny may be tucked nearby.",
    ],
  },
  {
    id: "object-pond-edge",
    kind: "sign",
    label: "Pond Edge",
    x: 49,
    y: 56,
    lines: [
      "The pond laps softly at the bank. A damp notebook could be hiding among the reeds.",
    ],
  },
  {
    id: "object-hollow-oak",
    kind: "sign",
    label: "Hollow Oak",
    x: 14,
    y: 59,
    lines: [
      "An ancient oak with a doorway-sized hollow. The legend of the golden acorn lives here.",
    ],
  },
  {
    id: "object-picnic-blanket",
    kind: "sign",
    label: "Picnic Blanket",
    x: 65,
    y: 57,
    lines: [
      "A checkered blanket, a full basket, and nobody around. The biscuits look fresh.",
    ],
  },
];

// ---------------------------------------------------------------------------
// 8. Assemble + self-check
// ---------------------------------------------------------------------------
const rows = grid.map((row) => row.join(""));
assert(rows.length === H && rows.every((r) => r.length === W), "grid shape");

const mapData = {
  id: "zone-clover-village",
  name: "Clover Village",
  width: W,
  height: H,
  rows,
  spawn: SPAWN,
  transitions: [
    {
      id: "trans-clover-valley",
      label: "Happy Valley",
      x: 37,
      y: 74,
      toZone: "zone-happy-valley",
      spawn: { x: 20, y: 1 },
    },
  ],
  interactables,
};

const COLLIDE = new Set(["W", "~", "T"]);
function walkable(x, y) {
  return x >= 0 && x < W && y >= 0 && y < H && !COLLIDE.has(get(x, y));
}

// Spawn + transition must be walkable.
assert(walkable(SPAWN.x, SPAWN.y), "spawn walkable");
assert(walkable(37, 74), "transition walkable");

// Every building footprint collides; every door is walkable.
for (const b of BUILDINGS) {
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      assert(get(x, y) === "W", `${b.name} footprint solid at (${x},${y})`);
    }
  }
  assert(walkable(b.door.x, b.door.y), `${b.name} door walkable`);
}

// Every NPC + interactable tile is walkable and reachable from spawn.
const targets = [
  ...Object.entries(NPC_TILES).map(([id, t]) => [id, t.x, t.y]),
  ...interactables.map((o) => [o.id, o.x, o.y]),
  ["door-post-office", 37, 23],
  ["door-cafe", 17, 29],
  ["door-research", 54, 27],
  ["door-florist", 57, 39],
  ["door-cottage-nw", 15, 47],
  ["door-cottage-ne", 56, 48],
  ["garden-opening", 40, 43],
  ["picnic", 65, 57],
  ["hollow-oak", 14, 59],
  ["transition", 37, 74],
];
for (const [id, x, y] of targets) {
  assert(walkable(x, y), `${id} tile (${x},${y}) walkable`);
}
// BFS reachability over walkable tiles.
{
  const seen = new Set([`${SPAWN.x},${SPAWN.y}`]);
  const queue = [[SPAWN.x, SPAWN.y]];
  while (queue.length > 0) {
    const [cx, cy] = queue.shift();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !walkable(nx, ny)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  const unreachable = targets.filter(([, x, y]) => !seen.has(`${x},${y}`));
  assert(unreachable.length === 0, `all landmarks reachable, got ${JSON.stringify(unreachable)}`);
}

function assert(cond, message) {
  if (!cond) {
    console.error(`CLOVER VILLAGE GENERATION FAILED: ${message}`);
    process.exit(1);
  }
}

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/maps/clover-village.json");
writeFileSync(outPath, `${JSON.stringify(mapData, null, 1)}\n`);

const counts = {};
for (const row of rows) for (const c of row) counts[c] = (counts[c] ?? 0) + 1;
console.log(`wrote ${outPath}`);
console.log("tile counts:", counts);
console.log(`ok — spawn ${SPAWN.x},${SPAWN.y}; ${interactables.length} interactables; all landmarks walkable + reachable`);
