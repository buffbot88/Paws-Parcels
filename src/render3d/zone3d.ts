/**
 * The static world, built in 3D from the same authored data the 2D renderer uses.
 *
 * Ground, roads, paving, fringes, forest cover and every set piece come from the
 * terrain plan and the placement tables, so a zone is authored once and the two
 * renderers cannot disagree about where anything is.
 */
import * as THREE from "three";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { EDGE_DARKENING, fringeFrameRect, fringeSafeFlip } from "../game/terrainSurface.ts";
import type { TerrainPlan } from "../game/terrainSurface.ts";
import type { TerrainMaterials } from "../game/terrainAssets.ts";
import type { MapData } from "../game/Maps.ts";
import { footprintWidthPx, type PropSizing } from "../game/propSizing.ts";
import { CAMERA_3D } from "./camera3d.ts";
import { FLAT_PITCH, buildQuadGeometry, fullUv, type QuadSpec } from "./geometry3d.ts";
import { billboardRoll, depthLiftTiles, rollPivotOffset } from "./parity3d.ts";
import { createShadowTexture, shadowQuadFor } from "./shadow3d.ts";
import { Texture3DCache, frameUvRect, type QuadUv } from "./texture3d.ts";

/** A placement in a zone's authored table, in the shape both zones share. */
export interface PlacedPiece {
  readonly texture: string;
  readonly frame?: string;
  readonly tileX: number;
  readonly baseTileY: number;
  readonly scale: number;
  readonly rotation?: number;
  readonly flipX?: boolean;
  /**
   * The 2D draw-order nudge, authored for a piece that belongs to a bigger one
   * (a shop sign, the parcels on the Post Office step). In 3D it becomes the
   * separation toward the camera — see `parity3d.ts` for why dropping it is a
   * visible defect rather than a simplification.
   */
  readonly depthOffset?: number;
}

/** Everything a zone needs drawn, and nothing about how it is simulated. */
export interface Zone3DInput {
  readonly map: MapData;
  readonly materials: TerrainMaterials;
  readonly plan: TerrainPlan;
  readonly placements: readonly PlacedPiece[];
  readonly sizing: Readonly<Record<string, PropSizing>>;
}

/** The built zone: one object to add, one call to free it. */
export interface Zone3D {
  readonly group: THREE.Group;
  dispose(): void;
}

/** Ground-plane heights in tiles, backed by polygon offset, so nothing z-fights. */
const GROUND_Y = {
  base: 0,
  patch: 0.01,
  surface: 0.02,
  fringe: 0.03,
  edge: 0.04,
} as const;

/** Foliage art stands on the tile's bottom edge, as it does in 2D. */
const FOLIAGE_BASE_OFFSET_TILES = 1;

/** Pixels of the fringe crop left on the grass side of the boundary (2D parity). */
const FRINGE_GRASS_INSET_PX = 4;
const FRINGE_CENTRE_OFFSET_TILES = (TILE_SIZE / 2 - FRINGE_GRASS_INSET_PX) / TILE_SIZE;

/** Boundary darkening colour, matching the 2D renderer's own dark green. */
const EDGE_DARKENING_COLOUR = new THREE.Color(0x1b2a1a);

/** The shade a piece with no sizing row falls back to, exactly as 2D does. */
const DEFAULT_FOOTPRINT_PX = 40;

/** Art size in tiles for a placement, from its own scale and the source pixels. */
function pieceSize(
  cache: Texture3DCache,
  piece: PlacedPiece,
): { width: number; height: number; uv: QuadUv } | null {
  const frame = piece.frame;
  if (frame !== undefined) {
    const cut = cache.frame(piece.texture, frame);
    if (cut === null) return null;
    return {
      width: (cut.width * piece.scale) / TILE_SIZE,
      height: (cut.height * piece.scale) / TILE_SIZE,
      uv: cut.uv,
    };
  }
  const size = cache.size(piece.texture);
  if (size === null || size.width === 0 || size.height === 0) return null;
  return {
    width: (size.width * piece.scale) / TILE_SIZE,
    height: (size.height * piece.scale) / TILE_SIZE,
    uv: fullUv(),
  };
}

/** A merged batch of quads sharing one material. */
class Batch {
  private readonly quads: QuadSpec[] = [];

  constructor(
    private readonly group: THREE.Group,
    private readonly material: THREE.Material,
    private readonly geometryOwner: { geometries: THREE.BufferGeometry[] },
  ) {}

  add(quad: QuadSpec): void {
    this.quads.push(quad);
  }

  flush(): void {
    if (this.quads.length === 0) return;
    const geometry = buildQuadGeometry(this.quads);
    this.geometryOwner.geometries.push(geometry);
    this.group.add(new THREE.Mesh(geometry, this.material));
  }
}

/** Billboards face a fixed camera, so their yaw is a constant. */
const BILLBOARD_YAW = (CAMERA_3D.yawDeg * Math.PI) / 180;

/** Upright cutout art: alpha-tested, depth-writing, so the courier can pass behind it. */
function cutoutMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: true,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
}

function flatMaterial(map: THREE.Texture | null, units: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    alphaTest: map === null ? 0 : 0.02,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: units,
  });
}

/** Build a zone's static world. */
export function buildZone3D(cache: Texture3DCache, input: Zone3DInput): Zone3D {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const owned = { geometries };
  const { map, materials: terrain, plan } = input;
  const worldWidth = map.width;
  const worldHeight = map.height;
  const track = <T extends THREE.Material>(material: T): T => {
    materials.push(material);
    return material;
  };

  // --- Ground -------------------------------------------------------------
  const baseTexture = cache.repeat(terrain.base);
  if (baseTexture !== null) {
    baseTexture.repeat.set(worldWidth, worldHeight);
    const geometry = buildQuadGeometry([
      {
        x: worldWidth / 2,
        y: GROUND_Y.base,
        z: worldHeight / 2,
        width: worldWidth,
        height: worldHeight,
        pitch: FLAT_PITCH,
        uv: fullUv(),
      },
    ]);
    geometries.push(geometry);
    group.add(new THREE.Mesh(geometry, track(new THREE.MeshBasicMaterial({ map: baseTexture }))));
  }

  // Grass islands, roads, paving and fringes: flat art laid on the base.
  const patchKey = terrain.patch;
  if (patchKey !== undefined) {
    const patchSize = cache.size(patchKey);
    const patchTexture = cache.get(patchKey);
    if (patchSize !== null && patchTexture !== null) {
      const batch = new Batch(group, track(flatMaterial(patchTexture, 1)), owned);
      for (const patch of plan.patches) {
        batch.add({
          x: patch.tileX + 0.5,
          y: GROUND_Y.patch,
          z: patch.tileY + 0.5,
          width: (patchSize.width * patch.scale) / TILE_SIZE,
          height: (patchSize.height * patch.scale) / TILE_SIZE,
          pitch: FLAT_PITCH,
          uv: fullUv(),
          flipU: patch.flipX,
          flipV: patch.flipY,
        });
      }
      batch.flush();
    }
  }

  const pathTexture = cache.get(terrain.path);
  if (pathTexture !== null) {
    const batch = new Batch(group, track(flatMaterial(pathTexture, 2)), owned);
    for (const surface of plan.paths) {
      batch.add({
        x: surface.tileX + 0.5,
        y: GROUND_Y.surface,
        z: surface.tileY + 0.5,
        width: 1,
        height: 1,
        pitch: FLAT_PITCH,
        uv: fullUv(),
        flipU: surface.flipX,
        flipV: surface.flipY,
      });
    }
    batch.flush();
  }

  const plazaTexture =
    terrain.plaza === undefined ? pathTexture : cache.get(terrain.plaza) ?? pathTexture;
  if (plazaTexture !== null) {
    const batch = new Batch(group, track(flatMaterial(plazaTexture, 3)), owned);
    for (const surface of plan.paved) {
      batch.add({
        x: surface.tileX + 0.5,
        y: GROUND_Y.surface,
        z: surface.tileY + 0.5,
        width: 1,
        height: 1,
        pitch: FLAT_PITCH,
        uv: fullUv(),
        flipU: surface.flipX,
        flipV: surface.flipY,
      });
    }
    batch.flush();
  }

  const fringes = terrain.fringes;
  if (fringes !== undefined) {
    for (const edge of ["n", "s", "e", "w"] as const) {
      const rect = fringeFrameRect(edge);
      const keys = fringes[edge];
      for (let variant = 0; variant < keys.length; variant += 1) {
        const key = keys[variant];
        if (key === undefined) continue;
        const texture = cache.get(key);
        const size = cache.size(key);
        if (texture === null || size === null) continue;
        const uv = frameUvRect({
          cutX: rect.x,
          cutY: rect.y,
          cutWidth: rect.width,
          cutHeight: rect.height,
          source: { width: size.width, height: size.height },
        });
        const batch = new Batch(group, track(flatMaterial(texture, 4)), owned);
        for (const fringe of plan.fringes) {
          if (fringe.edge !== edge || fringe.variant !== variant) continue;
          const x = edge === "w"
            ? fringe.tileX + FRINGE_CENTRE_OFFSET_TILES
            : edge === "e"
              ? fringe.tileX + 1 - FRINGE_CENTRE_OFFSET_TILES
              : fringe.tileX + 0.5;
          const z = edge === "n"
            ? fringe.tileY + FRINGE_CENTRE_OFFSET_TILES
            : edge === "s"
              ? fringe.tileY + 1 - FRINGE_CENTRE_OFFSET_TILES
              : fringe.tileY + 0.5;
          batch.add({
            x,
            y: GROUND_Y.fringe,
            z,
            width: 1,
            height: 1,
            pitch: FLAT_PITCH,
            uv,
            flipU: fringe.flip && fringeSafeFlip(edge) === "x",
            flipV: fringe.flip && fringeSafeFlip(edge) === "y",
          });
        }
        batch.flush();
      }
    }
  }

  // Boundary darkening: the same three stepped bands the 2D renderer draws.
  const edgeMaterial = track(
    new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 5,
    }),
  );
  const edgeBatch = new Batch(group, edgeMaterial, owned);
  EDGE_DARKENING.stepAlpha.forEach((alpha, step) => {
    const inset = (step + 0.5) * EDGE_DARKENING.stepTiles;
    const thickness = EDGE_DARKENING.stepTiles;
    const bands = [
      { x: worldWidth / 2, z: inset, width: worldWidth, height: thickness },
      { x: worldWidth / 2, z: worldHeight - inset, width: worldWidth, height: thickness },
      { x: inset, z: worldHeight / 2, width: thickness, height: worldHeight },
      { x: worldWidth - inset, z: worldHeight / 2, width: thickness, height: worldHeight },
    ];
    for (const band of bands) {
      edgeBatch.add({
        x: band.x,
        y: GROUND_Y.edge,
        z: band.z,
        width: band.width,
        height: band.height,
        pitch: FLAT_PITCH,
        uv: fullUv(),
        rgba: [EDGE_DARKENING_COLOUR.r, EDGE_DARKENING_COLOUR.g, EDGE_DARKENING_COLOUR.b, alpha],
      });
    }
  });
  edgeBatch.flush();

  // --- Forest cover -------------------------------------------------------
  const foliage = terrain.foliage;
  if (foliage !== undefined) {
    const byVariant = new Map<number, QuadSpec[]>();
    for (const piece of plan.foliage) {
      const key = foliage[Math.min(piece.variant, foliage.length - 1)];
      if (key === undefined) continue;
      const size = cache.size(key);
      if (size === null) continue;
      const height = (size.height * piece.scale) / TILE_SIZE;
      const quads = byVariant.get(piece.variant) ?? [];
      quads.push({
        x: piece.tileX + 0.5,
        y: height / 2,
        z: piece.tileY + FOLIAGE_BASE_OFFSET_TILES,
        width: (size.width * piece.scale) / TILE_SIZE,
        height,
        yaw: BILLBOARD_YAW,
        uv: fullUv(),
        flipU: piece.flipX,
      });
      byVariant.set(piece.variant, quads);
    }
    for (const [variant, quads] of byVariant) {
      const key = foliage[Math.min(variant, foliage.length - 1)];
      const texture = key === undefined ? null : cache.get(key);
      if (texture === null) continue;
      const batch = new Batch(group, track(cutoutMaterial(texture)), owned);
      for (const quad of quads) batch.add(quad);
      batch.flush();
    }
  }

  // --- Set pieces and their shadows ---------------------------------------
  const shadowTexture = createShadowTexture();
  const shadowMaterial = track(
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 20,
    }),
  );
  const shadowBatch = new Batch(group, shadowMaterial, owned);
  const byTexture = new Map<string, QuadSpec[]>();

  for (const piece of input.placements) {
    const size = pieceSize(cache, piece);
    if (size === null) continue;
    const quads = byTexture.get(piece.texture) ?? [];
    // The two authored fields that only mean something in a draw-order list:
    // the piece stands `depthOffset` nearer the camera than its host, and a
    // rolled piece pivots on the ground it stands on rather than its centre.
    const pivot = rollPivotOffset(piece.rotation, size.height);
    quads.push({
      x: piece.tileX + pivot.x,
      y: size.height / 2 + pivot.y,
      z: piece.baseTileY + depthLiftTiles(piece),
      width: size.width,
      height: size.height,
      yaw: BILLBOARD_YAW,
      roll: billboardRoll(piece.rotation),
      uv: size.uv,
      flipU: piece.flipX === true,
    });
    byTexture.set(piece.texture, quads);

    const spec = input.sizing[piece.texture];
    const footprint = spec === undefined ? undefined : footprintWidthPx(spec, piece.scale);
    shadowBatch.add(
      shadowQuadFor(piece.tileX, piece.baseTileY, footprint ?? DEFAULT_FOOTPRINT_PX, TILE_SIZE),
    );
  }

  for (const [key, quads] of byTexture) {
    const texture = cache.get(key);
    if (texture === null) continue;
    const batch = new Batch(group, track(cutoutMaterial(texture)), owned);
    for (const quad of quads) batch.add(quad);
    batch.flush();
  }
  shadowBatch.flush();

  return {
    group,
    dispose(): void {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      shadowTexture.dispose();
    },
  };
}
