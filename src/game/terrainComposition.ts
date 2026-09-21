/**
 * Deliberate composition for the scattered layers (visual Pass 4).
 *
 * The previous scatter was statistically even: every eligible tile rolled the
 * same dice (`hash01(x, y, salt) > 0.85` for canopy, `> 0.94` for grass islands)
 * and the result was the "sparse in some areas and cluttered in others" note in
 * review — not because the odds were wrong, but because even odds cannot produce
 * a place. Composition needs *contrast*: stretches of open lawn, thickets you
 * walk around, a treeline along the boundary, and planting that frames the
 * routes into the square.
 *
 * This module decides that, from the map alone and with no RNG state:
 *
 *   1. **Bands** — the map is divided into coarse cells; a seeded hash assigns
 *      each cell a density class. Neighbouring cells are biased toward the same
 *      class, so the result is patches of open ground and patches of thicket
 *      rather than salt-and-pepper.
 *   2. **Tree lines** — the outer band of the map is always the densest, so the
 *      canopy closes the world's edge instead of thinning out at it.
 *   3. **Framing clusters** — each road mouth into the plaza gets an arc of
 *      planting around it, so the approaches read as composed entrances.
 *   4. **Reserved tiles** — NPCs, the spawn, transitions and interactables are
 *      kept clear (with a margin), because decoration must never obscure the
 *      things a player has to find.
 *
 * Pure and Phaser-free: `terrainSurface.ts` consumes the plan, and
 * `tests/data/terrain-composition.test.ts` audits it in the node environment.
 */
import type { MapData } from "./Maps.ts";

/** The density classes, in increasing order of planting. */
export const DENSITY_CLASSES = ["open", "light", "normal", "dense"] as const;

export type DensityClass = (typeof DENSITY_CLASSES)[number];

/** Tiles kept clear around every reserved tile. */
export const RESERVED_RADIUS = 2;

/** A tile coordinate, shared by every authorable shape below. */
export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A named patch of ground: a clearing, a thicket, or anything in between.
 *
 * Regions are *paint*: they are applied in order, so a later region can carve an
 * opening out of an earlier thicket, and any tile no region covers keeps the
 * seeded variation. `center` is in tile coordinates (fractions allowed) and
 * `radius` is a half-extent in tiles.
 */
export interface CompositionRegion {
  readonly class: DensityClass;
  readonly shape: "ellipse" | "rect";
  readonly center: TilePoint;
  readonly radius: TilePoint;
  /** Why this patch exists, for whoever reads the plan next. */
  readonly note?: string;
}

/**
 * One framed way into a place, placed by hand.
 *
 * `outward` is the direction the route leaves in, in tile space; `radii` and
 * `spread` shape the planting arc around it and fall back to `DEFAULT_ARC`.
 */
export interface CompositionEntrance {
  readonly tile: TilePoint;
  readonly outward: TilePoint;
  readonly radii?: readonly number[];
  readonly spread?: number;
  readonly note?: string;
}

/** How thick the boundary treeline is, and how dense. */
export interface TreelineRule {
  readonly band: number;
  readonly class: DensityClass;
}

/** How much the scattered layers plant, and how close together. */
export interface CompositionScatter {
  /** Share of eligible tiles that carry canopy at density 1. */
  readonly canopyDensity: number;
  /** Minimum tile spacing between two canopy pieces. */
  readonly canopySpacing: number;
  /** Minimum spacing inside one framing arc (tighter: an arc is one group). */
  readonly clusterSpacing: number;
  /** Share of eligible grass tiles that become island candidates. */
  readonly patchDensity: number;
  /** Minimum tile spacing between two grass islands. */
  readonly patchSpacing: number;
  /** Tiles between a grass island and the nearest path or paving. */
  readonly patchClearance: number;
}

/**
 * The standing rule that a blocking tile must never become invisible.
 *
 * A zone that lists a code in `coveredBlockingCodes` stops painting that tile's
 * procedural square, so its art has to come from somewhere else. Where that art
 * is forest, the piece standing in for the tile has to be tall enough to hide
 * it — otherwise the courier walks into nothing. This is the minimum rendered
 * height for a piece doing that job.
 */
export interface BlockingCoverRule {
  readonly minHeightTiles: number;
}

/**
 * One zone's authored composition plan (`src/data/maps/<zone>.composition.json`).
 *
 * This is where composition *intent* lives: which ground is a clearing, which is
 * a thicket, and where the framed entrances belong. The seeded cell roll, the
 * treeline and the spacing floors are all here too, so a designer can change how
 * a zone composes without editing a planner (see `COMPOSITION_DEFAULTS` for what
 * a zone that authors nothing gets).
 *
 * Deliberately *not* here, because they are rules rather than intent:
 * `RESERVED_RADIUS` (decoration must never obscure a tile the player acts on)
 * and `MOUTH_MERGE_TILES` / `APPROACH_CHAIN_TILES` (how the map's own road
 * mouths are derived when a zone authors no entrances).
 */
export interface ZoneComposition {
  readonly version: number;
  /** Zone this plan belongs to; `"*"` marks the shared defaults. */
  readonly zone: string;
  readonly cellTiles: number;
  readonly treeline: TreelineRule;
  readonly bands: Readonly<Record<DensityClass, number>>;
  readonly regions: readonly CompositionRegion[];
  /** Authored entrances, or `null` to derive them from the map's own roads. */
  readonly entrances: readonly CompositionEntrance[] | null;
  readonly scatter: CompositionScatter;
  readonly blockingCover: BlockingCoverRule;
}

/** The arc shape of a framing cluster, when an entrance does not author one. */
export const DEFAULT_ARC = { radii: [2.5, 4.5] as readonly number[], spread: 0.7 };

/**
 * What a zone gets when it authors no composition plan.
 *
 * These are the numbers the planner used before composition was authorable, so
 * an unauthored zone behaves exactly as it did. `TREE_LINE_BAND`,
 * `COMPOSITION_CELL` and `DENSITY_MULTIPLIER` re-export the same values for
 * readers (the review harness, the audits) — the planners themselves read the
 * zone's spec, never these constants.
 */
export const COMPOSITION_DEFAULTS: ZoneComposition = {
  version: 1,
  zone: "*",
  cellTiles: 12,
  treeline: { band: 5, class: "dense" },
  bands: {
    /** A clearing: nothing scatters here at all. */
    open: 0,
    light: 0.4,
    normal: 1,
    dense: 1.7,
  },
  regions: [],
  entrances: null,
  scatter: {
    canopyDensity: 0.85,
    canopySpacing: 1.6,
    clusterSpacing: 1.3,
    patchDensity: 0.06,
    patchSpacing: 5,
    patchClearance: 2,
  },
  blockingCover: { minHeightTiles: 2.4 },
};

/** Coarse composition cell size, in tiles (the shared default). */
export const COMPOSITION_CELL = COMPOSITION_DEFAULTS.cellTiles;

/** The outer band of the map, in tiles, which carries the tree line by default. */
export const TREE_LINE_BAND = COMPOSITION_DEFAULTS.treeline.band;

/** Density multiplier per class, by default (see `COMPOSITION_DEFAULTS.bands`). */
export const DENSITY_MULTIPLIER: Readonly<Record<DensityClass, number>> =
  COMPOSITION_DEFAULTS.bands;

/** Why a tile is kept clear of decoration. */
export type ReservedKind = "npc" | "spawn" | "transition" | "interactable";

export interface ReservedTile {
  readonly x: number;
  readonly y: number;
  readonly kind: ReservedKind;
}

/** An arc of planting framing one way into the plaza. */
export interface FramingCluster {
  /** Tiles along the approach direction; the far one is the outermost. */
  readonly tiles: readonly TilePoint[];
}

/** Minimal structural shape of an NPC definition (see src/data/npcs.json). */
export interface NpcHome {
  readonly id: string;
  readonly homeTile: TilePoint;
  readonly zone?: string;
}

/**
 * Every tile decoration must keep clear of, derived from the map and its NPCs.
 *
 * Interactables, the spawn point and transitions come straight from the map
 * JSON; NPCs come from the content file, filtered to the zone by the caller.
 */
export function reservedTilesFor(
  map: MapData & {
    spawn?: TilePoint;
    transitions?: readonly { x: number; y: number }[];
    interactables?: readonly { x: number; y: number }[];
  },
  npcTiles: readonly TilePoint[] = [],
): ReservedTile[] {
  const reserved: ReservedTile[] = [];
  for (const npc of npcTiles) reserved.push({ x: npc.x, y: npc.y, kind: "npc" });
  if (map.spawn !== undefined) {
    reserved.push({ x: map.spawn.x, y: map.spawn.y, kind: "spawn" });
  }
  for (const transition of map.transitions ?? []) {
    reserved.push({ x: transition.x, y: transition.y, kind: "transition" });
  }
  for (const interactable of map.interactables ?? []) {
    reserved.push({ x: interactable.x, y: interactable.y, kind: "interactable" });
  }
  return reserved;
}

/** Is (x, y) within `radius` tiles (Chebyshev) of any reserved tile? */
export function isReservedNear(
  reserved: readonly ReservedTile[],
  x: number,
  y: number,
  radius = RESERVED_RADIUS,
): boolean {
  return reserved.some(
    (tile) => Math.abs(tile.x - x) <= radius && Math.abs(tile.y - y) <= radius,
  );
}

/**
 * Class of one composition cell, resolving its west-neighbour adoption.
 *
 * The class is a seeded hash of the cell coordinate, then smoothed: at
 * `BORROW_ODDS` a cell adopts the class of the cell to its west, which is what
 * turns independent cells into runs of open ground and runs of thicket.
 *
 * Adoption reads the neighbour's *resolved* class, not its own roll: a chain of
 * cells that each re-rolled would decorrelate the run instead of extending it,
 * which is exactly how the first attempt ended up no more banded than chance.
 * Resolution is left-to-right per row and memoised, so a chain costs one walk
 * per cell and can never recurse without end.
 */
function cellClass(
  map: MapData,
  cx: number,
  cy: number,
  hash01: HashFn,
  memo: Map<string, DensityClass>,
): DensityClass {
  const key = `${cx},${cy}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let resolved: DensityClass;
  // The boundary is handled per tile by `buildDensityGrid`, because a cell
  // straddling the band would otherwise leave undefended forest at the map edge.
  if (cx <= 0) {
    resolved = rollClass(hash01(cx, cy, 0x5eed));
  } else if (hash01(cx, cy, 0x9d21) < BORROW_ODDS) {
    resolved = cellClass(map, cx - 1, cy, hash01, memo);
  } else {
    resolved = rollClass(hash01(cx, cy, 0x5eed));
  }

  memo.set(key, resolved);
  return resolved;
}

/** Share of cells that adopt their west neighbour's class, forming regions. */
const BORROW_ODDS = 0.6;

/** Map a roll in [0, 1) onto a class, with open and dense as the tails. */
function rollClass(roll: number): DensityClass {
  if (roll < 0.22) return "open";
  if (roll < 0.5) return "light";
  if (roll < 0.8) return "normal";
  return "dense";
}

/** Deterministic coordinate hash — injected so the planner stays RNG-free. */
export type HashFn = (x: number, y: number, salt: number) => number;

/**
 * The authored class at a tile, or `null` where no region covers it.
 *
 * Regions are paint, in file order: the last region covering a tile wins, so a
 * designer can lay a thicket and then carve a clearing out of it. A tile centre
 * is tested against the region's shape, so a region reads the same way at any
 * radius rather than shifting half a tile.
 */
export function regionClassAt(
  composition: ZoneComposition,
  x: number,
  y: number,
): DensityClass | null {
  let found: DensityClass | null = null;
  for (const region of composition.regions) {
    const dx = (x + 0.5 - region.center.x) / (region.radius.x || Number.EPSILON);
    const dy = (y + 0.5 - region.center.y) / (region.radius.y || Number.EPSILON);
    const inside =
      region.shape === "rect"
        ? Math.abs(dx) <= 1 && Math.abs(dy) <= 1
        : dx * dx + dy * dy <= 1;
    if (inside) found = region.class;
  }
  return found;
}

/**
 * Density map for a zone: `density[y][x]`, a multiplier on the base odds.
 *
 * Priority, in order: a reserved tile is cleared (safety), the boundary band is
 * the zone's treeline rule (the world's edge is not left to chance), then an
 * authored region if one covers the tile (intent), and finally the seeded cell
 * roll (variation where nothing was authored).
 */
export function buildDensityGrid(
  map: MapData,
  hash01: HashFn,
  reserved: readonly ReservedTile[] = [],
  composition: ZoneComposition = COMPOSITION_DEFAULTS,
): DensityClass[][] {
  const memo = new Map<string, DensityClass>();
  const grid: DensityClass[][] = [];
  for (let y = 0; y < map.height; y += 1) {
    const row: DensityClass[] = [];
    for (let x = 0; x < map.width; x += 1) {
      // Reserved tiles win outright: decoration must never obscure a tile the
      // player has to act on, not even for the treeline.
      if (isReservedNear(reserved, x, y)) {
        row.push("open");
        continue;
      }
      // Edge band next: the treeline is not a class, it overrides the rest — and
      // it is decided per tile, so no cell boundary can leave a hole in it.
      if (isTreeLineTile(map, x, y, composition.treeline.band)) {
        row.push(composition.treeline.class);
        continue;
      }
      const authored = regionClassAt(composition, x, y);
      if (authored !== null) {
        row.push(authored);
        continue;
      }
      row.push(
        cellClass(
          map,
          Math.floor(x / composition.cellTiles),
          Math.floor(y / composition.cellTiles),
          hash01,
          memo,
        ),
      );
    }
    grid.push(row);
  }
  return grid;
}

/** Is this tile inside the boundary band that carries the treeline? */
export function isTreeLineTile(
  map: MapData,
  x: number,
  y: number,
  band = COMPOSITION_DEFAULTS.treeline.band,
): boolean {
  return (
    x < band || y < band || x >= map.width - band || y >= map.height - band
  );
}

/** Density multiplier for a tile, from a grid built by `buildDensityGrid`. */
export function densityAt(
  grid: readonly (readonly DensityClass[])[],
  x: number,
  y: number,
): number {
  const cls = grid[y]?.[x];
  return cls === undefined ? DENSITY_MULTIPLIER.normal : DENSITY_MULTIPLIER[cls];
}

/**
 * How far a road must continue outward to count as a way in.
 *
 * The plaza's outer ring is one tile of `P` around the paved core, so "a road
 * tile touching pavement" describes the whole rim (measured: 36 candidates all
 * the way round the disc). Requiring the corridor to continue for a few tiles in
 * the outward direction leaves exactly the real mouths — measured on the
 * generated village it keeps 3 of them, because everywhere else the far side of
 * the rim is grass or water.
 */
const APPROACH_CHAIN_TILES = 2;

/** Approach tiles this close to each other are the same mouth. */
export const MOUTH_MERGE_TILES = 4;

/** One way into the plaza, after merging the tiles of a single road mouth. */
export interface PlazaApproach {
  readonly tile: TilePoint;
  readonly outward: { x: number; y: number };
  /** Arc shape for this entrance; absent means `DEFAULT_ARC`. */
  readonly radii?: readonly number[];
  readonly spread?: number;
}

/**
 * The ways into a paved plaza: road tiles that touch the paving and lead away
 * from it, merged into one entry per mouth.
 *
 * The caller supplies the plaza predicate and centre because it already owns the
 * paved classification — this module deliberately knows nothing about art or
 * surface materials.
 */
export function plazaApproaches(
  map: MapData,
  isPaved: (x: number, y: number) => boolean,
  centre: TilePoint,
): PlazaApproach[] {
  const candidates: { tile: TilePoint; outward: { x: number; y: number } }[] = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (!isPaved(x, y)) continue;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        if (isPaved(nx, ny)) continue;
        if (map.rows[ny]?.[nx] !== "P") continue;
        const ox = x - centre.x;
        const oy = y - centre.y;
        const len = Math.hypot(ox, oy) || 1;
        const outward = { x: ox / len, y: oy / len };
        // Round to a compass step and require the corridor to keep going.
        const ux = Math.round(outward.x);
        const uy = Math.round(outward.y);
        let chain = 0;
        for (let step = 1; step <= APPROACH_CHAIN_TILES; step += 1) {
          if (map.rows[ny + uy * step]?.[nx + ux * step] === "P") chain += 1;
        }
        if (chain < APPROACH_CHAIN_TILES) continue;
        candidates.push({ tile: { x: nx, y: ny }, outward });
      }
    }
  }

  // Merge tiles of the same mouth (a wide gate is several tiles across).
  const mouths: { tiles: TilePoint[]; outward: { x: number; y: number }[] }[] = [];
  for (const candidate of candidates) {
    const mouth = mouths.find((group) =>
      group.tiles.some(
        (tile) =>
          Math.abs(tile.x - candidate.tile.x) <= MOUTH_MERGE_TILES &&
          Math.abs(tile.y - candidate.tile.y) <= MOUTH_MERGE_TILES,
      ),
    );
    if (mouth === undefined) {
      mouths.push({ tiles: [candidate.tile], outward: [candidate.outward] });
    } else {
      mouth.tiles.push(candidate.tile);
      mouth.outward.push(candidate.outward);
    }
  }

  return mouths.map((mouth) => {
    const sx = mouth.tiles.reduce((sum, tile) => sum + tile.x, 0) / mouth.tiles.length;
    const sy = mouth.tiles.reduce((sum, tile) => sum + tile.y, 0) / mouth.tiles.length;
    const ox = mouth.outward.reduce((sum, dir) => sum + dir.x, 0) / mouth.outward.length;
    const oy = mouth.outward.reduce((sum, dir) => sum + dir.y, 0) / mouth.outward.length;
    const len = Math.hypot(ox, oy) || 1;
    return {
      tile: { x: Math.round(sx), y: Math.round(sy) },
      outward: { x: ox / len, y: oy / len },
    };
  });
}

/**
 * Tiles in one framing cluster: an arc of planting just outside an approach.
 *
 * The arc's shape comes from the entrance when it authors one, so a designer can
 * widen or tighten a specific doorway without moving the planner.
 */
export function clusterTiles(
  approach: PlazaApproach,
  isBlocked: (x: number, y: number) => boolean = () => false,
): TilePoint[] {
  const tiles: TilePoint[] = [];
  const seen = new Set<string>();
  const radii = approach.radii ?? DEFAULT_ARC.radii;
  const spread = approach.spread ?? DEFAULT_ARC.spread;
  for (const radius of radii) {
    for (const offset of [-spread, 0, spread]) {
      const angle = Math.atan2(approach.outward.y, approach.outward.x) + offset;
      const x = Math.round(approach.tile.x + Math.cos(angle) * radius);
      const y = Math.round(approach.tile.y + Math.sin(angle) * radius);
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isBlocked(x, y)) continue;
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/**
 * Framing clusters for every way into the plaza.
 *
 * `isBlocked` filters out tiles the planting may not occupy — pavement, water, or
 * anywhere reserved for a player-facing tile — so the plan carries only tiles the
 * renderer can actually use.
 */
export function buildFramingClusters(
  approaches: readonly PlazaApproach[],
  isBlocked: (x: number, y: number) => boolean = () => false,
): FramingCluster[] {
  return approaches.map((approach) => ({ tiles: clusterTiles(approach, isBlocked) }));
}

/**
 * The ways into a zone that get framed planting.
 *
 * Authored entrances when the zone has them, otherwise the map's own road
 * mouths — which is why a zone with a plaza needs to author nothing, and a zone
 * without one (Happy Valley: a single lane, no paving) can still frame its
 * arrival. Deriving from the map is the safer default: the roads are the truth,
 * and an authored plan that no longer matches them is rejected by
 * `validateComposition`. Returns the approaches in file order for authored
 * entrances, so a plan's ordering is meaningful.
 */
export function compositionApproaches(
  composition: ZoneComposition,
  map: MapData,
  isPaved: (x: number, y: number) => boolean,
  centre: TilePoint,
): PlazaApproach[] {
  if (composition.entrances === null) return plazaApproaches(map, isPaved, centre);
  return composition.entrances.map((entrance) => ({
    tile: entrance.tile,
    outward: normalise(entrance.outward),
    radii: entrance.radii,
    spread: entrance.spread,
  }));
}

/** A unit vector, so an authored `outward` need not be written normalised. */
function normalise(vector: TilePoint): { x: number; y: number } {
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) return { x: 0, y: 1 };
  return { x: vector.x / length, y: vector.y / length };
}

/** One parsed plan plus everything wrong with it; `errors` empty means usable. */
export interface CompositionParseResult {
  readonly composition: ZoneComposition;
  readonly errors: string[];
}

/**
 * Read a zone composition plan out of JSON, filling in the shared defaults.
 *
 * Strict on purpose, and it collects every problem rather than throwing on the
 * first: this is authored content, and a designer editing a plan wants the whole
 * list. Anything it rejects falls back to the default, so a broken file degrades
 * to the previous behaviour instead of taking the zone's terrain down.
 */
export function parseComposition(
  raw: unknown,
  expectedZone?: string,
): CompositionParseResult {
  const errors: string[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { composition: { ...COMPOSITION_DEFAULTS, zone: expectedZone ?? "*" }, errors: ["plan must be a JSON object"] };
  }
  const source = raw as Record<string, unknown>;
  // Mutable working copies: the spec's fields are readonly by design, and the
  // parse assembles the finished plan only once every field has been read.
  const bands: Record<DensityClass, number> = { ...COMPOSITION_DEFAULTS.bands };
  const scatter: Record<keyof CompositionScatter, number> = {
    ...COMPOSITION_DEFAULTS.scatter,
  };
  const treeline: { band: number; class: DensityClass } = {
    ...COMPOSITION_DEFAULTS.treeline,
  };
  const blockingCover: { minHeightTiles: number } = {
    ...COMPOSITION_DEFAULTS.blockingCover,
  };
  let cellTiles = COMPOSITION_DEFAULTS.cellTiles;
  let regions: CompositionRegion[] = [];
  let entrances: CompositionEntrance[] | null = null;

  if (source.version !== undefined && source.version !== COMPOSITION_DEFAULTS.version) {
    errors.push(
      `version ${String(source.version)} is not the supported version ${COMPOSITION_DEFAULTS.version}`,
    );
  }
  if (expectedZone !== undefined && source.zone !== undefined && source.zone !== expectedZone) {
    errors.push(`plan says zone "${String(source.zone)}" but the file is for "${expectedZone}"`);
  }

  cellTiles = numberField(source, "cellTiles", cellTiles, errors);
  const treelineSource = objectField(source, "treeline", errors);
  treeline.band = numberField(treelineSource, "band", treeline.band, errors);
  treeline.class = classField(treelineSource, "class", treeline.class, errors);

  const bandsSource = objectField(source, "bands", errors);
  for (const cls of DENSITY_CLASSES) {
    bands[cls] = numberField(bandsSource, cls, bands[cls], errors);
  }

  const scatterSource = objectField(source, "scatter", errors);
  for (const key of Object.keys(scatter) as (keyof CompositionScatter)[]) {
    scatter[key] = numberField(scatterSource, key, scatter[key], errors);
  }

  const coverSource = objectField(source, "blockingCover", errors);
  blockingCover.minHeightTiles = numberField(
    coverSource,
    "minHeightTiles",
    blockingCover.minHeightTiles,
    errors,
  );

  if (source.regions !== undefined) {
    if (!Array.isArray(source.regions)) {
      errors.push("regions must be an array");
    } else {
      regions = source.regions.map((entry, index) => parseRegion(entry, index, errors));
    }
  }

  // `null` (or absent) means "derive the entrances from the map"; an explicit
  // empty array means "this zone frames nothing", which is a real choice.
  if (source.entrances === null || source.entrances === undefined) {
    entrances = null;
  } else if (!Array.isArray(source.entrances)) {
    errors.push("entrances must be an array or null");
  } else {
    entrances = source.entrances.map((entry, index) => parseEntrance(entry, index, errors));
  }

  return {
    composition: {
      version: COMPOSITION_DEFAULTS.version,
      zone: expectedZone ?? COMPOSITION_DEFAULTS.zone,
      cellTiles,
      treeline,
      bands,
      regions,
      entrances,
      scatter,
      blockingCover,
    },
    errors,
  };
}

function numberField(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  errors: string[],
): number {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${key} must be a finite number, got ${JSON.stringify(value)}`);
    return fallback;
  }
  return value;
}

function classField(
  source: Record<string, unknown>,
  key: string,
  fallback: DensityClass,
  errors: string[],
): DensityClass {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !(DENSITY_CLASSES as readonly string[]).includes(value)) {
    errors.push(`${key} must be one of ${DENSITY_CLASSES.join(", ")}, got ${JSON.stringify(value)}`);
    return fallback;
  }
  return value as DensityClass;
}

function objectField(
  source: Record<string, unknown>,
  key: string,
  errors: string[],
): Record<string, unknown> {
  const value = source[key];
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${key} must be an object`);
    return {};
  }
  return value as Record<string, unknown>;
}

function pointField(
  source: Record<string, unknown>,
  key: string,
  where: string,
  errors: string[],
): TilePoint {
  const value = source[key];
  const point = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const x = numberField(point, "x", Number.NaN, errors);
  const y = numberField(point, "y", Number.NaN, errors);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    errors.push(`${where}.${key} must be { x, y } tile coordinates`);
    return { x: 0, y: 0 };
  }
  return { x, y };
}

function parseRegion(
  entry: unknown,
  index: number,
  errors: string[],
): CompositionRegion {
  const where = `regions[${index}]`;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${where} must be an object`);
    return { class: "normal", shape: "ellipse", center: { x: 0, y: 0 }, radius: { x: 1, y: 1 } };
  }
  const source = entry as Record<string, unknown>;
  const shape = source.shape ?? "ellipse";
  if (shape !== "ellipse" && shape !== "rect") {
    errors.push(`${where}.shape must be "ellipse" or "rect", got ${JSON.stringify(shape)}`);
  }
  const region: CompositionRegion = {
    class: classField(source, "class", "normal", errors),
    shape: shape === "rect" ? "rect" : "ellipse",
    center: pointField(source, "center", where, errors),
    radius: pointField(source, "radius", where, errors),
  };
  if (region.radius.x <= 0 || region.radius.y <= 0) {
    errors.push(`${where}.radius must be positive in both directions`);
  }
  if (typeof source.note === "string") return { ...region, note: source.note };
  return region;
}

function parseEntrance(
  entry: unknown,
  index: number,
  errors: string[],
): CompositionEntrance {
  const where = `entrances[${index}]`;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${where} must be an object`);
    return { tile: { x: 0, y: 0 }, outward: { x: 0, y: 1 } };
  }
  const source = entry as Record<string, unknown>;
  const entrance: CompositionEntrance = {
    tile: pointField(source, "tile", where, errors),
    outward: pointField(source, "outward", where, errors),
  };
  if (entrance.outward.x === 0 && entrance.outward.y === 0) {
    errors.push(`${where}.outward must not be { 0, 0 } — it is which way the route leaves`);
  }
  const radii = source.radii;
  if (radii !== undefined) {
    if (!Array.isArray(radii) || radii.some((r) => typeof r !== "number" || !(r > 0))) {
      errors.push(`${where}.radii must be an array of positive numbers`);
    } else {
      return withEntranceExtras(entrance, radii as number[], source, errors);
    }
  }
  return withEntranceExtras(entrance, undefined, source, errors);
}

function withEntranceExtras(
  entrance: CompositionEntrance,
  radii: number[] | undefined,
  source: Record<string, unknown>,
  errors: string[],
): CompositionEntrance {
  const spread = source.spread;
  if (spread !== undefined && (typeof spread !== "number" || !(spread > 0))) {
    errors.push(`${entrance.tile.x},${entrance.tile.y}: spread must be a positive number`);
  }
  return {
    ...entrance,
    ...(radii === undefined ? {} : { radii }),
    ...(typeof spread === "number" && spread > 0 ? { spread } : {}),
    ...(typeof source.note === "string" ? { note: source.note } : {}),
  };
}

/**
 * Check a plan against the map it is meant to compose.
 *
 * These are the failures a designer actually hits when a map is regenerated
 * underneath a hand-written plan: a region that no longer touches the map, a
 * band that is no longer ordered, an entrance that has stopped being a way in.
 * The check that a plan is *wired* correctly (does every covered blocking tile
 * end up with art) needs the art, so it lives with the zone's materials.
 */
export function validateComposition(
  composition: ZoneComposition,
  map: MapData,
  options: { isPath?: (x: number, y: number) => boolean } = {},
): string[] {
  const errors: string[] = [];
  if (composition.cellTiles < 1) errors.push("cellTiles must be at least 1");
  if (composition.treeline.band < 0) errors.push("treeline.band must not be negative");
  if (composition.treeline.band * 2 >= Math.min(map.width, map.height)) {
    errors.push(
      `treeline.band ${composition.treeline.band} covers the whole ${map.width}x${map.height} map`,
    );
  }

  const bands = DENSITY_CLASSES.map((cls) => composition.bands[cls]);
  if (bands.some((value) => value < 0)) {
    errors.push("bands must not be negative");
  } else if (bands.some((value, index) => index > 0 && value < bands[index - 1]!)) {
    errors.push(
      `bands must not decrease from open to dense, got ${DENSITY_CLASSES.map((cls) => `${cls} ${composition.bands[cls]}`).join(", ")}`,
    );
  }

  for (const [index, region] of composition.regions.entries()) {
    const where = `regions[${index}] (${region.class} at ${region.center.x},${region.center.y})`;
    const left = region.center.x - region.radius.x;
    const right = region.center.x + region.radius.x;
    const top = region.center.y - region.radius.y;
    const bottom = region.center.y + region.radius.y;
    if (right < 0 || bottom < 0 || left > map.width || top > map.height) {
      errors.push(`${where} does not overlap the ${map.width}x${map.height} map`);
    }
  }

  const isPath = options.isPath;
  for (const [index, entrance] of (composition.entrances ?? []).entries()) {
    const where = `entrances[${index}] (${entrance.tile.x},${entrance.tile.y})`;
    if (
      entrance.tile.x < 0 ||
      entrance.tile.y < 0 ||
      entrance.tile.x >= map.width ||
      entrance.tile.y >= map.height
    ) {
      errors.push(`${where} is outside the ${map.width}x${map.height} map`);
      continue;
    }
    if (isPath === undefined) continue;
    // An entrance is a way in, so there must be a route within reach of it. When
    // a map is regenerated this is what catches an arc planted in a field.
    let route = false;
    for (let dy = -2; dy <= 2 && !route; dy += 1) {
      for (let dx = -2; dx <= 2 && !route; dx += 1) {
        if (isPath(entrance.tile.x + dx, entrance.tile.y + dy)) route = true;
      }
    }
    if (!route) errors.push(`${where} has no road or paving within 2 tiles — it is not a way in`);
  }

  return errors;
}
