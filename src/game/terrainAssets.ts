/**
 * Shared terrain renderer (visual Pass 2).
 *
 * One implementation for every zone. Clover Village previously had its own
 * `addCloverVillageGround` and Happy Valley a near-identical
 * `addHappyValleyGround`: both drew one continuous grass `tileSprite`, then one
 * identical image per path tile. That duplication is what let the two zones
 * drift, and neither softened the grass/path seam or varied the surface.
 *
 * This module owns the drawing; `terrainSurface.ts` owns the decisions (pure
 * and node-testable). A zone supplies a `TerrainMaterials` set, and features it
 * has no art for simply do not appear — so the valley keeps its own pack while
 * sharing the code path.
 *
 * Depth stack (see TERRAIN_DEPTH): base, then grass islands, then the road and
 * paved surfaces, then the grass fringes that cross the seam. Forest cover is
 * depth-sorted against entities instead, because the courier must be able to
 * pass in front of a tree.
 *
 * ## Material choices, and where they came from
 *
 * Measured against the approved reference illustration (`design/CloverVillage.png`):
 *   - reference dominant greens cluster at #29462a..#4c6b3b (dark olive);
 *   - the kit's `land_1` base averages #478122, the previously wired
 *     `meadow.png` averages #6ea948 — markedly lighter and yellower, and
 *     nothing in the reference is near it. The base therefore moves to the kit.
 *   - reference greys average #a0a19a, and the wired `plaza.png` averages
 *     #a3aaab — a near match. The four seamless 256px paving families average
 *     #4f6b56..#67765d, far darker, so the plaza KEEPS its current stone
 *     material rather than switching to them.
 *   - the kit's `road_5` averages #ad7d5e against the wired road's #aa7b5d, so
 *     the path fill swaps over with no visible palette change.
 */
import Phaser from "phaser";
import { TILE_SIZE } from "./GameConfig.ts";
import { worldDepth } from "./WorldDepth.ts";
import type { MapData } from "./Maps.ts";
import {
  EDGE_DARKENING,
  TERRAIN_DEPTH,
  buildTerrainPlan,
  fringeFrameRect,
  fringeSafeFlip,
  type FringeEdge,
} from "./terrainSurface.ts";
import type { ReservedTile, ZoneComposition } from "./terrainComposition.ts";
import type { TerrainPlan } from "./terrainSurface.ts";

/** Tone of the edge fall-off: the world's own dark green, not neutral grey. */
const EDGE_DARKENING_COLOR = 0x1b2a1a;

/** Boundary-side keys of the grass fringe kit. */
export type FringeMaterials = Readonly<Record<FringeEdge, readonly string[]>>;

/**
 * Everything `buildTerrainPlan` needs from a zone's materials and options.
 *
 * Exported so the scene can build the very same plan for the tilemap pass
 * without repeating the wiring — one plan, one answer.
 */
export function terrainPlanInput(
  materials: TerrainMaterials,
  options: {
    reserved?: readonly ReservedTile[];
    composition?: ZoneComposition;
    sizing?: Readonly<Record<string, { w: number; h: number }>>;
  } = {},
): Parameters<typeof buildTerrainPlan>[1] {
  const foliageSizes = (materials.foliage ?? []).map((key) => {
    const spec = options.sizing?.[key];
    if (spec === undefined) return { tiles: 0, widthTiles: 0 };
    return { tiles: spec.h / TILE_SIZE, widthTiles: spec.w / TILE_SIZE };
  });
  return {
    foliage: foliageSizes.length > 0 ? foliageSizes : undefined,
    foliageVariants: materials.foliage?.length ?? 1,
    reserved: options.reserved ?? [],
    composition: options.composition,
    coveredBlockingCodes: materials.coveredBlockingCodes,
  };
}

export interface TerrainMaterials {
  /** Opaque continuous ground surface, drawn under everything else. */
  base: string;
  /** Grass island shape scattered over the base (from the same art family). */
  patch?: string;
  /** Road fill. Must be a centre/fill tile — see `road_5` below. */
  path: string;
  /** Paved plaza surface; falls back to `path` when a zone has none. */
  plaza?: string;
  /** Grass fringes per boundary side, two variants each. */
  fringes?: FringeMaterials;
  /** Forest cover variants for the blocking `T` mass. */
  foliage?: readonly string[];
  /**
   * Blocking tile codes whose visible art is now supplied by authored layers,
   * so the procedural tile map must stop painting its flat square over them.
   * Collision is unaffected — it stays authoritative in the ASCII map.
   */
  coveredBlockingCodes?: readonly string[];
}

const FRINGE_FRAME = "fringe";
/**
 * How much of the crop's solid band is left on the grass side of the boundary.
 * Everything else is pushed across the seam, so the fringe is a grass lip lying
 * on the paving rather than a strip that only ever covers grass it already
 * covered — which would soften nothing.
 */
const FRINGE_GRASS_INSET_PX = 4;
/** Offset from the boundary to the fringe sprite's centre line. */
const FRINGE_CENTRE_OFFSET_PX = TILE_SIZE / 2 - FRINGE_GRASS_INSET_PX;

/**
 * Register the tile-sized fringe crop as a named frame on each kit texture.
 *
 * Frames rather than `setCrop`: a frame is the art's real bounds, so origin,
 * rotation and depth math behave exactly like every other texture in the game
 * (the same approach as the quest-item sheet cut-outs). Idempotent.
 */
export function registerFringeFrames(scene: Phaser.Scene, materials: TerrainMaterials): void {
  const fringes = materials.fringes;
  if (fringes === undefined) return;
  for (const [edge, keys] of Object.entries(fringes) as [FringeEdge, readonly string[]][]) {
    const rect = fringeFrameRect(edge);
    for (const key of keys) {
      if (!scene.textures.exists(key)) continue;
      const texture = scene.textures.get(key);
      if (texture.has(FRINGE_FRAME)) continue;
      texture.add(FRINGE_FRAME, 0, rect.x, rect.y, rect.width, rect.height);
    }
  }
}

/**
 * Build the authored surface for a map and return everything created, so the
 * scene can destroy it on shutdown.
 */
export function addTerrainSurface(
  scene: Phaser.Scene,
  map: MapData,
  materials: TerrainMaterials,
  options: {
    reserved?: readonly ReservedTile[];
    /** The zone's authored composition plan (see terrainComposition.ts). */
    composition?: ZoneComposition;
    /** Sizing table for this zone, so a variant's rendered size is known. */
    sizing?: Readonly<Record<string, { w: number; h: number }>>;
    /**
     * A plan the caller already built (see `buildTerrainPlan`).
     *
     * The scene builds it before the tilemap so the tilemap can ask the truth
     * about which blocking tiles have art over them; building it twice would
     * waste the work and let the two answers drift.
     */
    plan?: TerrainPlan;
  } = {},
): Phaser.GameObjects.GameObject[] {
  if (!scene.textures.exists(materials.base)) return [];
  registerFringeFrames(scene, materials);

  const added: Phaser.GameObjects.GameObject[] = [];
  const worldWidth = map.width * TILE_SIZE;
  const worldHeight = map.height * TILE_SIZE;

  // One continuous ground surface. The base art is a verified seamless repeat,
  // so a single tile sprite has no internal seams and costs one draw.
  added.push(
    scene.add
      .tileSprite(worldWidth / 2, worldHeight / 2, worldWidth, worldHeight, materials.base)
      .setDepth(TERRAIN_DEPTH.base),
  );

  // `reserved` keeps decoration off the tiles players act on (NPCs, the spawn,
  // transitions, interactables), `composition` is the zone's authored plan, and
  // the foliage sizes let the planner tell a tree from a tuft — needed because a
  // zone that suppresses a blocking tile's procedural square is promising the art
  // covers it, and only the planner's cover rule can keep that promise.
  const plan =
    options.plan ??
    buildTerrainPlan(map, {
      ...terrainPlanInput(materials, options),
    });

  // Grass islands: same art family as the base, so they read as organic
  // variation in the lawn instead of a second, competing texture.
  if (materials.patch !== undefined && scene.textures.exists(materials.patch)) {
    for (const patch of plan.patches) {
      added.push(
        scene.add
          .image(
            patch.tileX * TILE_SIZE + TILE_SIZE / 2,
            patch.tileY * TILE_SIZE + TILE_SIZE / 2,
            materials.patch,
          )
          .setScale(patch.scale)
          .setFlipX(patch.flipX)
          .setFlipY(patch.flipY)
          .setDepth(TERRAIN_DEPTH.patch),
      );
    }
  }

  // Roads and the paved plaza. Both fills are seamless centre tiles, so an
  // identical image per tile already forms a continuous surface; the seeded
  // mirror breaks the one-tile-forever repetition without inventing the compass
  // topology the road kit has not verified.
  const pathKey = scene.textures.exists(materials.path) ? materials.path : null;
  const plazaKey =
    materials.plaza !== undefined && scene.textures.exists(materials.plaza)
      ? materials.plaza
      : pathKey;
  for (const surface of plan.paths) {
    if (pathKey === null) break;
    added.push(
      scene.add
        .image(
          surface.tileX * TILE_SIZE + TILE_SIZE / 2,
          surface.tileY * TILE_SIZE + TILE_SIZE / 2,
          pathKey,
        )
        .setDisplaySize(TILE_SIZE, TILE_SIZE)
        .setFlipX(surface.flipX)
        .setFlipY(surface.flipY)
        .setDepth(TERRAIN_DEPTH.surface),
    );
  }
  for (const surface of plan.paved) {
    if (plazaKey === null) break;
    added.push(
      scene.add
        .image(
          surface.tileX * TILE_SIZE + TILE_SIZE / 2,
          surface.tileY * TILE_SIZE + TILE_SIZE / 2,
          plazaKey,
        )
        .setDisplaySize(TILE_SIZE, TILE_SIZE)
        .setFlipX(surface.flipX)
        .setFlipY(surface.flipY)
        .setDepth(TERRAIN_DEPTH.surface),
    );
  }

  // Grass fringes across the seam: the whole point is that the paving stops
  // ending on a straight machine line.
  const fringes = materials.fringes;
  if (fringes !== undefined) {
    for (const fringe of plan.fringes) {
      const keys = fringes[fringe.edge];
      const key = keys[Math.min(fringe.variant, keys.length - 1)];
      if (key === undefined || !scene.textures.exists(key)) continue;
      const centreX = fringe.tileX * TILE_SIZE + TILE_SIZE / 2;
      const centreY = fringe.tileY * TILE_SIZE + TILE_SIZE / 2;
      // Anchored so the crop's grass band just crosses the boundary: its solid
      // edge keeps a few pixels on the grass side, and the ragged tail (the
      // rest of the 48px crop) lies across the paving.
      const off = FRINGE_CENTRE_OFFSET_PX;
      const x =
        fringe.edge === "w"
          ? fringe.tileX * TILE_SIZE + off
          : fringe.edge === "e"
            ? (fringe.tileX + 1) * TILE_SIZE - off
            : centreX;
      const y =
        fringe.edge === "n"
          ? fringe.tileY * TILE_SIZE + off
          : fringe.edge === "s"
            ? (fringe.tileY + 1) * TILE_SIZE - off
            : centreY;
      const image = scene.add.image(x, y, key, FRINGE_FRAME).setDepth(TERRAIN_DEPTH.fringe);
      // Mirroring is only ever applied on the axis that cannot move the grass
      // to the wrong side of the boundary.
      if (fringe.flip) {
        if (fringeSafeFlip(fringe.edge) === "x") image.setFlipX(true);
        else image.setFlipY(true);
      }
      added.push(image);
    }
  }

  // Restrained edge darkening: a stepped fall-off inward from each boundary, so
  // the map's edges settle instead of ending on a hard line of tiles.
  for (const [step, alpha] of EDGE_DARKENING.stepAlpha.entries()) {
    const inset = (step + 0.5) * EDGE_DARKENING.stepTiles * TILE_SIZE;
    const thickness = EDGE_DARKENING.stepTiles * TILE_SIZE;
    const spans = [
      { x: worldWidth / 2, y: inset, width: worldWidth, height: thickness },
      { x: worldWidth / 2, y: worldHeight - inset, width: worldWidth, height: thickness },
      { x: inset, y: worldHeight / 2, width: thickness, height: worldHeight },
      { x: worldWidth - inset, y: worldHeight / 2, width: thickness, height: worldHeight },
    ];
    for (const span of spans) {
      added.push(
        scene.add
          .rectangle(span.x, span.y, span.width, span.height, EDGE_DARKENING_COLOR, alpha)
          .setDepth(TERRAIN_DEPTH.edgeDarkening),
      );
    }
  }

  // Forest cover for the blocking tree mass. Depth-sorted with the world rather
  // than parked on the terrain stack, so the courier passes in front of trees
  // to the south of them and behind trees to the north.
  const foliage = materials.foliage;
  if (foliage !== undefined && foliage.length > 0) {
    for (const piece of plan.foliage) {
      const key = foliage[Math.min(piece.variant, foliage.length - 1)];
      if (key === undefined || !scene.textures.exists(key)) continue;
      const baseY = piece.tileY * TILE_SIZE + TILE_SIZE;
      added.push(
        scene.add
          .image(piece.tileX * TILE_SIZE + TILE_SIZE / 2, baseY, key)
          .setOrigin(0.5, 1)
          .setScale(piece.scale)
          .setFlipX(piece.flipX)
          .setDepth(worldDepth(baseY)),
      );
    }
  }

  return added;
}
