/**
 * The cast, drawn as upright billboards in the 3D world.
 *
 * Nothing about an entity's simulation changes: the renderer reads the sprite the
 * scene already moves and animates, and stands a camera-facing quad where that
 * sprite is, sized from the art's own frame and the entity's scale.
 */
import * as THREE from "three";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { CAMERA_3D } from "./camera3d.ts";
import { buildQuadGeometry, FLAT_PITCH, fullUv } from "./geometry3d.ts";
import { createShadowTexture, shadowQuadFor } from "./shadow3d.ts";
import { Texture3DCache, frameUvRect } from "./texture3d.ts";

/** One entity as the 3D renderer needs it: where it stands, and what it shows. */
export interface EntityBillboard {
  /** Stable identity — the entity object itself, so re-use and removal are exact. */
  readonly id: object;
  /** Centre of the tile the entity stands on, in tiles. */
  readonly x: number;
  readonly z: number;
  /** How far the art's centre sits above the entity's feet, in tiles. */
  readonly centreAboveFeetTiles: number;
  /** Source image behind the current frame. */
  readonly imageKey: string;
  /** The current frame's art rectangle and its source dimensions, in pixels. */
  readonly frame: {
    cutX: number;
    cutY: number;
    cutWidth: number;
    cutHeight: number;
    sourceWidth: number;
    sourceHeight: number;
  };
  /** Rendered size of the current frame at the entity's scale, in tiles. */
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly flipX: boolean;
  /** Multiplicative colour, which the placeholder monster art relies on. */
  readonly tint: number;
  /** Ground contact width in pixels, for the shared shadow recipe. */
  readonly footprintPx: number;
  /** Hidden entities draw nothing and cast nothing. */
  readonly visible: boolean;
}

interface Billboard {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshBasicMaterial;
  readonly shadow: THREE.Mesh;
  readonly shadowMaterial: THREE.MeshBasicMaterial;
  uvKey: string;
}

const BILLBOARD_YAW = (CAMERA_3D.yawDeg * Math.PI) / 180;

/** Draws and updates the moving cast. */
export class CharacterBillboards {
  private readonly root = new THREE.Group();
  private readonly live = new Map<object, Billboard>();
  private readonly shadowTexture: THREE.Texture;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly cache: Texture3DCache,
  ) {
    this.shadowTexture = createShadowTexture();
    this.scene.add(this.root);
  }

  /** Create, move, re-frame and retire billboards so they match the scene. */
  sync(entities: readonly EntityBillboard[]): void {
    const seen = new Set<object>();
    for (const entity of entities) {
      seen.add(entity.id);
      let billboard = this.live.get(entity.id);
      if (billboard === undefined) {
        billboard = this.create(entity);
        this.live.set(entity.id, billboard);
      }
      this.update(billboard, entity);
    }
    for (const [id, billboard] of this.live) {
      if (seen.has(id)) continue;
      this.retire(billboard);
      this.live.delete(id);
    }
  }

  /** Free every billboard's GPU resources. */
  dispose(): void {
    for (const billboard of this.live.values()) this.retire(billboard);
    this.live.clear();
    this.scene.remove(this.root);
    this.shadowTexture.dispose();
  }

  private create(entity: EntityBillboard): Billboard {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      map: this.cache.get(entity.imageKey),
      transparent: true,
      alphaTest: 0.02,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = BILLBOARD_YAW;
    material.color.setHex(entity.tint);
    // One unit quad at the origin: position and size arrive per frame, and the
    // shadow geometry is scaled into the recipe's ellipse.
    const shadowGeometry = buildQuadGeometry([
      { x: 0, y: 0, z: 0, width: 1, height: 1, pitch: FLAT_PITCH, uv: fullUv() },
    ]);
    const shadowMaterial = new THREE.MeshBasicMaterial({
      map: this.shadowTexture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 25,
    });
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    this.root.add(mesh, shadow);
    return { mesh, geometry, material, shadow, shadowMaterial, uvKey: "" };
  }

  private update(billboard: Billboard, entity: EntityBillboard): void {
    const { mesh, shadow, material, shadowMaterial } = billboard;
    if (entity.visible !== mesh.visible) {
      mesh.visible = entity.visible;
      shadow.visible = entity.visible;
    }
    if (!entity.visible) return;

    mesh.scale.set(entity.widthTiles, entity.heightTiles, 1);
    mesh.position.set(
      entity.x,
      entity.centreAboveFeetTiles + entity.heightTiles / 2,
      entity.z,
    );

    const frameKey = `${entity.imageKey}:${entity.frame.cutX},${entity.frame.cutY},${entity.frame.cutWidth},${entity.frame.cutHeight}:${entity.flipX ? 1 : 0}`;
    if (billboard.uvKey !== frameKey) {
      const texture = this.cache.get(entity.imageKey);
      if (texture !== null && material.map !== texture) {
        material.map = texture;
        material.needsUpdate = true;
      }
      const uv = frameUvRect({
        cutX: entity.frame.cutX,
        cutY: entity.frame.cutY,
        cutWidth: entity.frame.cutWidth,
        cutHeight: entity.frame.cutHeight,
        source: { width: entity.frame.sourceWidth, height: entity.frame.sourceHeight },
      });
      // PlaneGeometry's corner order is top-left, top-right, bottom-left,
      // bottom-right, so the art lands upright on the quad.
      const u0 = entity.flipX ? uv.u1 : uv.u0;
      const u1 = entity.flipX ? uv.u0 : uv.u1;
      const uvAttribute = billboard.geometry.getAttribute("uv") as THREE.BufferAttribute;
      (
        [
          [u0, uv.v1],
          [u1, uv.v1],
          [u0, uv.v0],
          [u1, uv.v0],
        ] as const
      ).forEach(([u, v], index) => uvAttribute.setXY(index, u, v));
      uvAttribute.needsUpdate = true;
      billboard.uvKey = frameKey;
    }

    const shadowQuad = shadowQuadFor(entity.x, entity.z, entity.footprintPx, TILE_SIZE);
    const tint = shadowQuad.rgba ?? [0.15, 0.23, 0.16, 0.24];
    shadow.position.set(shadowQuad.x, shadowQuad.y, shadowQuad.z);
    shadow.scale.set(shadowQuad.width, shadowQuad.height, 1);
    shadowMaterial.color.setRGB(tint[0], tint[1], tint[2]);
    shadowMaterial.opacity = tint[3];
  }

  private retire(billboard: Billboard): void {
    this.root.remove(billboard.mesh, billboard.shadow);
    billboard.geometry.dispose();
    billboard.material.dispose();
    billboard.shadow.geometry.dispose();
    billboard.shadowMaterial.dispose();
  }
}

/** Convert a pixel measurement from the 2D renderer into tiles. */
export function pixelsToTiles(px: number): number {
  return px / TILE_SIZE;
}
