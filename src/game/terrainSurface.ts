/**
 * Pure terrain planning for the authored ASCII maps.
 *
 * Deliberately free of Phaser and `import.meta.glob` so the node test env can
 * import it (the same split as `cloverVillagePlacements.ts`). `terrainAssets.ts`
 * owns the Phaser glue; this module decides *what goes where*.
 *
 * Why this exists (visual Pass 2 — terrain/path integration): the previous
 * surface treatment was one continuous `tileSprite` of a single meadow texture
 * stretched over the whole map, plus one identical road image per `P` tile and
 * one identical plaza image per rectangle of "plaza". That read as a flat,
 * repeating lawn with tiles laid on top:
 *
 *   - the paved area was a hardcoded **rectangle** (x29-44, y25-35) while the
 *     map generator fills a **circle** of radius 7.6 around (37,28), so the
 *     paving corners stuck out onto grass and the round plaza edge was
 *     under-paved (a 176-tile rectangle drawn over a 134-tile disc, so its
 *     corners paved grass and its round edge was left as road);
 *   - every path tile drew the identical 64px image, so the route visibly
 *     repeated;
 *   - nothing softened the grass/path boundary, so the seam was a machine line.
 *
 * This module replaces all three with decisions derived from the map itself:
 * a paved region detected by local `P` density (so the shape follows the
 * generator, whatever it is), per-tile deterministic variation, and grass
 * fringes laid across the boundary.
 *
 * Everything here is seeded by tile coordinate, so the plan is byte-stable
 * across runs and reviewable in a diff.
 */
import type { MapData } from "./Maps.ts";
import {
  COMPOSITION_DEFAULTS,
  RESERVED_RADIUS,
  buildDensityGrid,
  buildFramingClusters,
  compositionApproaches,
  densityAt,
  isReservedNear,
  type DensityClass,
  type FramingCluster,
  type ReservedTile,
  type ZoneComposition,
} from "./terrainComposition.ts";

/** Which side of a tile the grass lies on (the side a fringe hangs from). */
export type FringeEdge = "n" | "s" | "e" | "w";

/** Tile codes that read as grass underfoot (decoration sits on top of grass). */
export const GRASS_COVER_CODES: ReadonlySet<string> = new Set(["G", "B", "X"]);

/**
 * A `P` tile counts as plaza paving when its 7x7 neighbourhood is this dense.
 *
 * Measured against the generated village: the paved disc's interior scores
 * 43-47 of 49, its rim 32-36, and the 1-3 tile wide roads score 26 or less, so
 * this threshold separates a blob from a corridor without hardcoding the
 * generator's radius or centre.
 */
const PLAZA_WINDOW_RADIUS = 3;
const PLAZA_DENSITY_MIN = 35;

/**
 * A foliage variant's rendered size, in tiles.
 *
 * The planner is deliberately art-agnostic, but the blocking-cover rule needs to
 * know whether a piece is a tree or a tuft: a tuft cannot hide a solid tile, and
 * a wide canopy covers its neighbours. So a zone supplies this alongside the
 * variant count, and `buildTerrainPlan` uses it for that rule alone.
 */
export interface FoliageVariantSize {
  /** Source height divided by the tile size — the size of the art at scale 1. */
  readonly tiles: number;
  readonly widthTiles: number;
}

/**
 * Canopy scale band for the scattered tree layer.
 *
 * Shared with the authored trees (Pass 3 `CLOVER_VILLAGE_PROP_SIZING.tree`,
 * 5.4 tiles at scale 0.42) because it is the same art: the procedural canopy and
 * the hand-placed canopy must not disagree about how tall a tree is. This is art
 * variation, not composition intent, so it stays here rather than in a plan.
 */
const CANOPY_SCALE_MIN = 0.4;
const CANOPY_SCALE_SPREAD = 0.08;

/** Every fringe piece in the kit is a 256px square. */
export const FRINGE_PIECE_PX = 256;
/** One tile of it is cropped out as the usable fringe. */
export const FRINGE_CROP_PX = 48;

/**
 * The tile-sized crop taken from a fringe piece.
 *
 * Each kit piece is a ragged grass strip lying along one outer edge of a 256px
 * square (alpha analysis: the solid band is only ~20px deep, so `edge-s` is
 * solid along y=236..255 and transparent above). Cropping a tile-sized square
 * out of that band keeps the strip at 1:1 scale — drawing the whole 256px piece
 * over a 48px tile would minify it 5.3:1 and average the fuzz into mush.
 *
 * The crop is taken from the band on the *grass* side, so the solid edge of the
 * crop points back at the grass and the ragged tail reaches across the seam.
 *
 * Pure geometry, kept beside the plan so the tests can assert the crop without
 * a browser.
 */
export function fringeFrameRect(edge: FringeEdge): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const mid = (FRINGE_PIECE_PX - FRINGE_CROP_PX) / 2;
  switch (edge) {
    case "n":
      return { x: mid, y: 0, width: FRINGE_CROP_PX, height: FRINGE_CROP_PX };
    case "s":
      return {
        x: mid,
        y: FRINGE_PIECE_PX - FRINGE_CROP_PX,
        width: FRINGE_CROP_PX,
        height: FRINGE_CROP_PX,
      };
    case "w":
      return { x: 0, y: mid, width: FRINGE_CROP_PX, height: FRINGE_CROP_PX };
    case "e":
      return {
        x: FRINGE_PIECE_PX - FRINGE_CROP_PX,
        y: mid,
        width: FRINGE_CROP_PX,
        height: FRINGE_CROP_PX,
      };
  }
}

/** Depths (kept in one place so the surface stack stays readable). */
export const TERRAIN_DEPTH = {
  base: -30,
  patch: -28,
  surface: -20,
  fringe: -18,
  /**
   * Edge darkening (visual Pass 5). Above the fringes so the whole terrain stack
   * is vignetted together, and still far below entities (which sit at 1+).
   */
  edgeDarkening: -17,
} as const;

/**
 * Restrained edge darkening at the map boundary.
 *
 * A stepped fall-off rather than a single rectangle: three bands of decreasing
 * alpha read as a soft gradient without needing a generated gradient texture or
 * a Graphics blend mode that cannot be verified in a headless test. The alphas
 * are deliberately low — this is meant to settle the world's edges, not to
 * frame the screen like a vignette in a photo mode.
 */
export const EDGE_DARKENING = {
  /** Width of each step, in tiles. */
  stepTiles: 1,
  /** Alpha per step, from the boundary inward. */
  stepAlpha: [0.085, 0.05, 0.022] as readonly number[],
} as const;

export interface PatchPlacement {
  tileX: number;
  tileY: number;
  variant: number;
  flipX: boolean;
  flipY: boolean;
  scale: number;
}

export interface SurfacePlacement {
  tileX: number;
  tileY: number;
  /** Deterministic mirror, used to break up an otherwise identical repeat. */
  flipX: boolean;
  flipY: boolean;
}

export interface FringePlacement {
  tileX: number;
  tileY: number;
  edge: FringeEdge;
  variant: number;
  /** Mirror across the fringe's safe axis (see `fringeSafeFlip`). */
  flip: boolean;
}

export interface FoliagePlacement {
  tileX: number;
  tileY: number;
  variant: number;
  scale: number;
  flipX: boolean;
  /**
   * Which decision put this piece here: the density band's scatter, a deliberate
   * framing cluster, or the blocking-cover rule. The audit needs to tell them
   * apart — a cluster may legitimately stand in an open band because it was
   * placed on purpose, and a cover piece deliberately ignores spacing.
   */
  source: "band" | "cluster" | "cover";
}

export interface TerrainPlan {
  /** Open-grass islands scattered across the base surface. */
  patches: PatchPlacement[];
  /** Road tiles (`P` outside the plaza). */
  paths: SurfacePlacement[];
  /** Plaza tiles (`P` inside the dense paved disc). */
  paved: SurfacePlacement[];
  /** Grass fringes laid across each grass/surface boundary. */
  fringes: FringePlacement[];
  /** Forest cover for the blocking `T` mass, plus the framing clusters. */
  foliage: FoliagePlacement[];
  /** The subset of `foliage` placed by the blocking-cover rule, in order. */
  cover: FoliagePlacement[];
  /**
   * Blocking tiles with a piece over them, keyed `x,y`.
   *
   * This is what a renderer needs to decide whether it may stop painting a
   * blocking tile's procedural square: only a tile in here has art standing in
   * for it. Empty when the planner was given no variant sizes, since then it
   * cannot tell what hides what.
   */
  coveredBlockingTiles: Set<string>;
  /**
   * Suppressed blocking tiles no piece covers, so they must keep their square.
   *
   * Not a failure on its own: the cover rule deliberately keeps off reserved
   * tiles, so a solid tile beside an interactable is left to the plain square —
   * which is why the square must not be hidden by tile *code* alone.
   */
  uncoveredBlocking: Array<{ readonly x: number; readonly y: number }>;
  /** Composition band per tile, so the audit can see the deliberate contrast. */
  density: DensityClass[][];
  /** Planting arcs framing each way into the plaza. */
  framingClusters: FramingCluster[];
}

/**
 * Deterministic hash of a tile coordinate to [0, 1).
 * 32-bit integer mixing (a small murmur-style finaliser) — no RNG state, so
 * any tile's value can be recomputed independently and the plan stays stable.
 */
export function hash01(x: number, y: number, salt: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ (salt | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Tile code at a coordinate, or null outside the map. */
export function tileCodeAt(map: MapData, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return map.rows[y]?.[x] ?? null;
}

/** Count of `P` tiles in the square window centred on (x, y). */
export function pathDensity(map: MapData, x: number, y: number, radius: number): number {
  let count = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (tileCodeAt(map, x + dx, y + dy) === "P") count += 1;
    }
  }
  return count;
}

/**
 * A `P` tile thick enough in every direction to be plaza rather than road.
 *
 * This is the plaza's *core*; see `isPavedTile` for why it is not the final
 * answer on its own.
 */
function isPlazaCore(map: MapData, x: number, y: number): boolean {
  if (tileCodeAt(map, x, y) !== "P") return false;
  return pathDensity(map, x, y, PLAZA_WINDOW_RADIUS) >= PLAZA_DENSITY_MIN;
}

/**
 * True when a `P` tile is part of the plaza rather than a road.
 *
 * Derived from the map's own path density, so it tracks the generator's plaza
 * shape (a disc) instead of a hand-maintained rectangle.
 *
 * The core test alone is too strict by exactly one tile: density falls off near
 * the rim, where the 7x7 window overhangs the grass. Measured on the generated
 * village the disc's rim scores 32-36 while roads score 26 or less, so the
 * threshold classifies the outer ring as road and would paint a brown outline
 * around a grey plaza. Growing the core by one tile — but never off `P` — fills
 * the genuine rim while leaving corridors road, so the paving boundary lands
 * where the paving actually is.
 */
export function isPavedTile(map: MapData, x: number, y: number): boolean {
  if (tileCodeAt(map, x, y) !== "P") return false;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (isPlazaCore(map, x + dx, y + dy)) return true;
  }
  return false;
}

/**
 * The axis a fringe may safely be mirrored on.
 *
 * A north/south fringe is a horizontal grass band: mirroring it vertically
 * would flip the grass onto the wrong side of the boundary, so only `flipX` is
 * safe. East/west fringes mirror vertically. This keeps the variation honest —
 * it can only ever re-orient the fuzz, never the side the grass is on.
 */
export function fringeSafeFlip(edge: FringeEdge): "x" | "y" {
  return edge === "n" || edge === "s" ? "x" : "y";
}

/** Tiles that are grass underfoot (including bush/flower decoration). */
function isGrassCover(code: string | null): boolean {
  return code !== null && GRASS_COVER_CODES.has(code);
}

/**
 * Centre of the village square: the centroid of its paved tiles.
 *
 * Used to work out which way each road mouth faces, so the framing clusters sit
 * outside the square on the route rather than inside it.
 */
function plazaCentreOf(map: MapData): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (!isPavedTile(map, x, y)) continue;
      sx += x;
      sy += y;
      count += 1;
    }
  }
  if (count === 0) return { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  return { x: sx / count, y: sy / count };
}

/**
 * Build the full surface plan for a map.
 *
 * The planner picks variants by index and draws nothing, so it stays free of
 * asset knowledge — the zone hands it the art's *sizes* (`foliage`) only because
 * the blocking-cover rule has to tell a tree from a tuft. `reserved` is the set
 * of tiles decoration must keep clear of, and `composition` is the zone's
 * authored plan (see `terrainComposition.ts`), so the whole thing can be
 * exercised in tests without a scene.
 */
export function buildTerrainPlan(
  map: MapData,
  options: {
    /** Rendered size of each forest variant, in order (index = variant). */
    foliage?: readonly FoliageVariantSize[];
    /** Kept for callers that only know how many variants exist. */
    foliageVariants?: number;
    reserved?: readonly ReservedTile[];
    composition?: ZoneComposition;
    /**
     * Blocking codes whose procedural square the zone stops painting, so their
     * art must come from the authored layers. See `blockingCover`.
     */
    coveredBlockingCodes?: readonly string[];
    /** Overrides the composition plan; used by tests to isolate one behaviour. */
    densityGrid?: readonly (readonly DensityClass[])[];
  } = {},
): TerrainPlan {
  const composition = options.composition ?? COMPOSITION_DEFAULTS;
  const foliageVariants = Math.max(1, options.foliage?.length ?? options.foliageVariants ?? 4);
  const foliageSizes = options.foliage;
  const scrub = composition.scatter;
  const coveredCodes = new Set(options.coveredBlockingCodes ?? []);
  const reserved = options.reserved ?? [];
  const patches: PatchPlacement[] = [];
  const paths: SurfacePlacement[] = [];
  const paved: SurfacePlacement[] = [];
  const fringes: FringePlacement[] = [];
  const foliage: FoliagePlacement[] = [];
  /** Anchors of every placed piece, for the spacing floor. */
  const foliagePlaced: Array<{ x: number; y: number }> = [];

  // Composition bands (visual Pass 4): contrast between open ground and thicket,
  // a treeline along the boundary, and planting that frames the approaches,
  // instead of one even scatter over the whole map. The board comes from the
  // zone's plan, so where those bands are is authored content.
  const densityGrid =
    options.densityGrid ?? buildDensityGrid(map, hash01, reserved, composition);

  // Pass 1 — surfaces, their seams, and forest cover. Fringes must be complete
  // before pass 2, which keeps grass islands clear of the path network.
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const code = map.rows[y]?.[x] ?? "G";

      if (code === "P") {
        const placement: SurfacePlacement = {
          tileX: x,
          tileY: y,
          flipX: hash01(x, y, 0x51ed) < 0.5,
          flipY: hash01(x, y, 0x9e37) < 0.5,
        };
        (isPavedTile(map, x, y) ? paved : paths).push(placement);

        // Seam treatment: hang a grass fringe on every side that meets grass,
        // so the paving stops ending on a machine-straight line.
        for (const edge of ["n", "s", "e", "w"] as const) {
          const dx = edge === "w" ? -1 : edge === "e" ? 1 : 0;
          const dy = edge === "n" ? -1 : edge === "s" ? 1 : 0;
          if (!isGrassCover(tileCodeAt(map, x + dx, y + dy))) continue;
          fringes.push({
            tileX: x,
            tileY: y,
            edge,
            variant: hash01(x, y, 0x1b0f + edge.charCodeAt(0)) < 0.5 ? 0 : 1,
            // Applied on the fringe's safe axis by the renderer, so variation
            // can re-orient the fuzz but never the side the grass is on.
            flip: hash01(x, y, 0x7a11) < 0.5,
          });
        }
        continue;
      }

      if (code === "T") {
        // Forest cover. The odds come from the composition band: a dense cell
        // closes into thicket, an open cell leaves a clearing. Spacing is the
        // hard floor — the canopy art is ~5 tiles tall and 2.5 wide, so pieces
        // closer than the zone's canopy spacing would stack into one blob.
        if (hash01(x, y, 0x2f6d) > scrub.canopyDensity * densityAt(densityGrid, x, y)) {
          continue;
        }
        if (isReservedNear(reserved, x, y)) continue;
        if (
          foliagePlaced.some((p) => Math.hypot(p.x - x, p.y - y) < scrub.canopySpacing)
        ) {
          continue;
        }
        foliagePlaced.push({ x, y });
        foliage.push({
          tileX: x,
          tileY: y,
          variant: Math.floor(hash01(x, y, 0x53c1) * foliageVariants) % foliageVariants,
          // Canopy scale follows the same band as the authored trees (Pass 3):
          // the two layers are the same art and must not disagree about how tall
          // a tree is.
          scale: CANOPY_SCALE_MIN + hash01(x, y, 0x6b43) * CANOPY_SCALE_SPREAD,
          flipX: hash01(x, y, 0x11a7) < 0.5,
          source: "band",
        });
      }
    }
  }

  // Pass 2 — grass islands, clear of the path network and of each other.
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (!isGrassCover(map.rows[y]?.[x] ?? null)) continue;
      if (hash01(x, y, 0x4c27) > scrub.patchDensity * densityAt(densityGrid, x, y)) continue;
      if (isReservedNear(reserved, x, y)) continue;
      if (nearAny(fringes, x, y, scrub.patchClearance)) continue;
      if (patches.some((p) => Math.hypot(p.tileX - x, p.tileY - y) < scrub.patchSpacing)) {
        continue;
      }
      patches.push({
        tileX: x,
        tileY: y,
        variant: Math.floor(hash01(x, y, 0x2ea9) * 2) % 2,
        flipX: hash01(x, y, 0x6f1d) < 0.5,
        flipY: hash01(x, y, 0x39b5) < 0.5,
        scale: 0.42 + hash01(x, y, 0x5ac3) * 0.3,
      });
    }
  }

  // Pass 3 — framing clusters at the zone's entrances (visual Pass 4). Planting
  // arcs across each way in, so the entrances read as composed rather than as
  // wherever the scatter happened to fall. A zone with authored entrances uses
  // those; otherwise they are derived from the map's own road mouths.
  const plazaCentre = plazaCentreOf(map);
  const approaches = compositionApproaches(
    composition,
    map,
    (x, y) => isPavedTile(map, x, y),
    plazaCentre,
  );
  const framingClusters = buildFramingClusters(
    approaches,
    (x, y) => {
      const code = tileCodeAt(map, x, y);
      if (code === null || code === "P" || code === "~") return true;
      return isReservedNear(reserved, x, y, RESERVED_RADIUS + 1);
    },
  );
  for (const cluster of framingClusters) {
    for (const tile of cluster.tiles) {
      // Deliberate planting outranks scatter: a band piece too close to an
      // entrance arc is dropped, not the arc. The other way round lets the dice
      // erase the one part of the scatter that was composed on purpose.
      for (let i = foliage.length - 1; i >= 0; i -= 1) {
        const piece = foliage[i]!;
        if (piece.source !== "band") continue;
        if (Math.hypot(piece.tileX - tile.x, piece.tileY - tile.y) >= scrub.canopySpacing) continue;
        foliage.splice(i, 1);
        const placedAt = foliagePlaced.findIndex(
          (p) => p.x === piece.tileX && p.y === piece.tileY,
        );
        if (placedAt >= 0) foliagePlaced.splice(placedAt, 1);
      }
      if (
        foliagePlaced.some(
          (p) => Math.hypot(p.x - tile.x, p.y - tile.y) < scrub.clusterSpacing,
        )
      ) {
        continue;
      }
      foliagePlaced.push({ x: tile.x, y: tile.y });
      foliage.push({
        tileX: tile.x,
        tileY: tile.y,
        variant: Math.floor(hash01(tile.x, tile.y, 0x70a3) * foliageVariants) % foliageVariants,
        scale: CANOPY_SCALE_MIN + hash01(tile.x, tile.y, 0x3ec9) * CANOPY_SCALE_SPREAD,
        flipX: hash01(tile.x, tile.y, 0x5b71) < 0.5,
        source: "cluster",
      });
    }
  }

  // Pass 4 — blocking cover (visual Pass 2 follow-up). A zone that suppresses a
  // blocking tile's procedural square is promising its art comes from the
  // authored layers, and the spacing floor above cannot promise that: it drops
  // roughly every other tile, which is how 468 solid tiles in the generated
  // village ended up with nothing over them and the courier walked into nothing.
  // So the rule is per tile and it outranks spacing: a blocked tile must either
  // keep its procedural square or have art tall enough to hide it.
  const coveredBlocking = countCoveredBlocking(map, foliage, foliageSizes, coveredCodes);
  const cover: FoliagePlacement[] = [];
  if (coveredCodes.size > 0 && foliageSizes !== undefined) {
    const eligible = eligibleCoverVariants(foliageSizes, composition.blockingCover.minHeightTiles);
    if (eligible.length === 0) {
      // No variant can hide a solid tile. Painting one on top would be a worse
      // lie than leaving the tile bare, and `uncoveredBlocking` reports it.
    } else {
      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          const code = map.rows[y]?.[x];
          if (code === undefined || !coveredCodes.has(code)) continue;
          if (isReservedNear(reserved, x, y)) continue;
          if (coveredBlocking.isCovered(x, y)) continue;
          const variant = eligible[Math.floor(hash01(x, y, 0x9f3d) * eligible.length) % eligible.length]!;
          const piece: FoliagePlacement = {
            tileX: x,
            tileY: y,
            variant,
            scale: CANOPY_SCALE_MIN + hash01(x, y, 0x4d17) * CANOPY_SCALE_SPREAD,
            flipX: hash01(x, y, 0x2c8b) < 0.5,
            source: "cover",
          };
          foliage.push(piece);
          cover.push(piece);
          coveredBlocking.mark(piece, foliageSizes[variant]);
        }
      }
    }
  }
  const uncoveredBlocking = coveredBlocking.uncovered();

  return {
    patches,
    paths,
    paved,
    fringes,
    foliage,
    cover,
    coveredBlockingTiles: coveredBlocking.tiles(),
    uncoveredBlocking,
    density: densityGrid as DensityClass[][],
    framingClusters,
  };
}

/**
 * Which variants can stand in for a suppressed blocking tile.
 *
 * A tuft cannot hide a solid square, so the cover pass may only choose a piece
 * at least `minHeightTiles` tall. When nothing qualifies the caller reports it
 * rather than planting something inadequate.
 */
function eligibleCoverVariants(
  sizes: readonly FoliageVariantSize[],
  minHeightTiles: number,
): number[] {
  const eligible: number[] = [];
  for (const [index, size] of sizes.entries()) {
    // Judged at the smallest scale the scatter can use, so a variant that only
    // qualifies at its tallest is not chosen for a job it can miss.
    if (size.tiles * CANOPY_SCALE_MIN >= minHeightTiles) eligible.push(index);
  }
  return eligible;
}

/**
 * Tracks which suppressed blocking tiles the placed art actually covers.
 *
 * Coverage is the piece's rendered silhouette, not its anchor: a wide canopy
 * legitimately hides the tiles beside it, and counting that is what keeps the
 * cover pass from piling a tree on every tile of a thicket.
 *
 * A tile counts as hidden when its *centre* is inside the silhouette, which is
 * the same test `tests/data/terrain-composition.test.ts` audits the plan with.
 * The first version of this marked a piece's whole bounding box, so the planner
 * believed 300-odd tiles were hidden that the audit could see were not — the
 * wrong way round, since the planner is the one that has to fill the holes.
 */
function countCoveredBlocking(
  map: MapData,
  foliage: readonly FoliagePlacement[],
  sizes: readonly FoliageVariantSize[] | undefined,
  coveredCodes: ReadonlySet<string>,
): {
  isCovered: (x: number, y: number) => boolean;
  mark: (piece: FoliagePlacement, size: FoliageVariantSize) => void;
  tiles: () => Set<string>;
  uncovered: () => Array<{ readonly x: number; readonly y: number }>;
} {
  const covered = new Set<string>();
  const mark = (piece: FoliagePlacement, size: FoliageVariantSize | undefined): void => {
    if (size === undefined) {
      covered.add(`${piece.tileX},${piece.tileY}`);
      return;
    }
    const base = piece.tileY + 1;
    const top = base - size.tiles * piece.scale;
    const halfWidth = (size.widthTiles * piece.scale) / 2;
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(map.height, Math.ceil(base)); y += 1) {
      if (y + 0.5 < top || y + 0.5 > base) continue;
      for (let x = Math.max(0, Math.floor(piece.tileX - halfWidth)); x < Math.min(map.width, Math.ceil(piece.tileX + halfWidth)); x += 1) {
        if (Math.abs(x + 0.5 - piece.tileX) > halfWidth) continue;
        covered.add(`${x},${y}`);
      }
    }
  };
  if (sizes !== undefined) {
    for (const piece of foliage) mark(piece, sizes[piece.variant]);
  } else {
    for (const piece of foliage) mark(piece, undefined);
  }

  const uncovered = () => {
    const bare: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const code = map.rows[y]?.[x];
        if (code === undefined || !coveredCodes.has(code)) continue;
        if (covered.has(`${x},${y}`)) continue;
        bare.push({ x, y });
      }
    }
    return bare;
  };

  return {
    isCovered: (x, y) => covered.has(`${x},${y}`),
    mark,
    tiles: () => covered,
    uncovered,
  };
}

/** Is (x, y) within `distance` tiles of any fringe anchor? */
function nearAny(
  fringes: readonly FringePlacement[],
  x: number,
  y: number,
  distance: number,
): boolean {
  for (const fringe of fringes) {
    if (Math.abs(fringe.tileX - x) <= distance && Math.abs(fringe.tileY - y) <= distance) {
      return true;
    }
  }
  return false;
}
