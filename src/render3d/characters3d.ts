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
import { hpBarRects, labelRect, type TagAnchor } from "./labels3d.ts";
import { createShadowTexture, shadowQuadFor } from "./shadow3d.ts";
import { Texture3DCache, frameUvRect } from "./texture3d.ts";

/** Health bar colours, matching the sprite renderer's own track. */
const HP_BAR_TRACK_COLOUR = 0x2b2016;
const HP_BAR_FILL_COLOUR = 0x66bb66;

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
  /** Opacity 0-1, for a figure fading out (a defeated monster's puff). */
  readonly alpha: number;
  /** Idle or walk bob: height above the ground, in tiles. Never moves the shadow. */
  readonly liftTiles: number;
  /** Ground contact width in pixels, for the shared shadow recipe. */
  readonly footprintPx: number;
  /** Hidden entities draw nothing and cast nothing. */
  readonly visible: boolean;
  /**
   * The entity's own name tag, as the canvas its text renders into.
   *
   * Uploaded rather than re-typeset: the tag is authored once in the entity
   * classes, and the 3D frame shows the same words, in the same style, at the
   * same size, as the sprite renderer does.
   */
  readonly tag: EntityTag | null;
  /** How high the tag floats above the entity's feet, in tiles (positive up). */
  readonly tagAboveFeetTiles: number;
  /** An NPC's quest marker ("!", "✓"), drawn like the tag but above it; null when none. */
  readonly marker: EntityTag | null;
  /** How high the marker's centre floats above the feet, bob included, in tiles. */
  readonly markerAboveFeetTiles: number;
  /** A monster's health share (0-1), or null for anything without a bar. */
  readonly hpRatio: number | null;
  /** The health bar's tint, from the sprite renderer's own rectangle. */
  readonly hpColour: number;
}

/** A name tag's source: its rendered canvas and its size in that canvas. */
export interface EntityTag {
  readonly canvas: HTMLCanvasElement;
  /** Identity of the current contents, so a texture upload only happens once. */
  readonly key: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly alpha: number;
}

interface Billboard {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshBasicMaterial;
  readonly shadow: THREE.Mesh;
  readonly shadowMaterial: THREE.MeshBasicMaterial;
  uvKey: string;
  tint: number;
  /** Built the first time the entity has a tag, marker or bar, then kept. */
  tag: TagMeshes | null;
  marker: TagMeshes | null;
  hp: HpMeshes | null;
}

/** One mesh carrying an entity's name tag, free to be absent. */
interface TagMeshes {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  texture: THREE.CanvasTexture;
  /** Canvas and contents behind the current texture, so it re-uploads on change. */
  source: HTMLCanvasElement;
  key: string;
}

/** A monster's health bar: the track and the filled portion of it. */
interface HpMeshes {
  readonly track: THREE.Mesh;
  readonly fill: THREE.Mesh;
  readonly trackMaterial: THREE.MeshBasicMaterial;
  readonly fillMaterial: THREE.MeshBasicMaterial;
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
    return {
      mesh,
      geometry,
      material,
      shadow,
      shadowMaterial,
      uvKey: "",
      tint: entity.tint,
      tag: null,
      marker: null,
      hp: null,
    };
  }

  /**
   * A tag (or marker) mesh, built on first use.
   *
   * A unit quad with the tag's canvas as its texture, drawn without writing
   * depth (a tag must never occlude the world) but with depth *testing* on, so a
   * canopy in front of a villager still hides their name.
   */
  private buildTag(tag: EntityTag): TagMeshes {
    const texture = new THREE.CanvasTexture(tag.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.rotation.y = BILLBOARD_YAW;
    mesh.renderOrder = 5;
    this.root.add(mesh);
    return { mesh, material, texture, source: tag.canvas, key: tag.key };
  }

  /** The health bar's two quads, built on first use, tinted once per change. */
  private ensureHp(billboard: Billboard): HpMeshes {
    if (billboard.hp !== null) return billboard.hp;
    const quad = (colour: number): THREE.Mesh => {
      const material = new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.rotation.y = BILLBOARD_YAW;
      mesh.renderOrder = 6;
      this.root.add(mesh);
      return mesh;
    };
    const track = quad(HP_BAR_TRACK_COLOUR);
    const fill = quad(HP_BAR_FILL_COLOUR);
    const built: HpMeshes = {
      track,
      fill,
      trackMaterial: track.material as THREE.MeshBasicMaterial,
      fillMaterial: fill.material as THREE.MeshBasicMaterial,
    };
    billboard.hp = built;
    return built;
  }

  private update(billboard: Billboard, entity: EntityBillboard): void {
    const { mesh, shadow, material, shadowMaterial } = billboard;
    if (entity.visible !== mesh.visible) {
      mesh.visible = entity.visible;
      shadow.visible = entity.visible;
    }
    if (!entity.visible) {
      // A hidden entity's tag and bar go with it: a defeated monster with a
      // floating name over empty ground is worse than no label at all.
      if (billboard.tag !== null) billboard.tag.mesh.visible = false;
      if (billboard.marker !== null) billboard.marker.mesh.visible = false;
      if (billboard.hp !== null) {
        billboard.hp.track.visible = false;
        billboard.hp.fill.visible = false;
      }
      return;
    }
    billboard.tag = this.updateTag(billboard.tag, entity.tag, anchorOf(entity), entity.alpha);
    billboard.marker = this.updateTag(
      billboard.marker,
      entity.marker,
      { ...anchorOf(entity), tagAboveFeetTiles: entity.markerAboveFeetTiles },
      entity.alpha,
    );
    this.updateHp(billboard, entity);

    mesh.scale.set(entity.widthTiles, entity.heightTiles, 1);
    mesh.position.set(
      entity.x,
      entity.centreAboveFeetTiles + entity.heightTiles / 2 + entity.liftTiles,
      entity.z,
    );
    // Tints change after creation (a monster's hit flash), so follow them.
    if (billboard.tint !== entity.tint) {
      material.color.setHex(entity.tint);
      billboard.tint = entity.tint;
    }
    material.opacity = entity.alpha;

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
    shadowMaterial.opacity = tint[3] * entity.alpha;
  }

  /** Draw a name tag or marker, uploading its canvas only when it changes; returns the (kept) meshes. */
  private updateTag(current: TagMeshes | null, tag: EntityTag | null, anchor: TagAnchor, entityAlpha: number): TagMeshes | null {
    if (tag === null) {
      if (current !== null) current.mesh.visible = false;
      return current;
    }
    const meshes = current ?? this.buildTag(tag);
    if (meshes.source !== tag.canvas || meshes.key !== tag.key) {
      meshes.texture.dispose();
      const texture = new THREE.CanvasTexture(tag.canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      meshes.texture = texture;
      meshes.material.map = texture;
      meshes.material.needsUpdate = true;
      meshes.source = tag.canvas;
      meshes.key = tag.key;
    }
    const rect = labelRect(anchor, tag.widthPx, tag.heightPx);
    meshes.mesh.visible = true;
    meshes.material.opacity = tag.alpha * entityAlpha;
    meshes.mesh.scale.set(rect.width, rect.height, 1);
    meshes.mesh.position.set(rect.x, rect.y, rect.z);
    return meshes;
  }

  /** Draw a monster's health bar from the share the client already mirrors. */
  private updateHp(billboard: Billboard, entity: EntityBillboard): void {
    const ratio = entity.hpRatio;
    if (ratio === null) {
      if (billboard.hp !== null) {
        billboard.hp.track.visible = false;
        billboard.hp.fill.visible = false;
      }
      return;
    }
    const meshes = this.ensureHp(billboard);
    const rects = hpBarRects(anchorOf(entity), ratio);
    // The sprite renderer owns the colour ramp (green, amber, red), so the 3D
    // bar reads the same as the 2D one at the same share.
    meshes.fillMaterial.color.setHex(entity.hpColour);
    meshes.trackMaterial.opacity = entity.alpha;
    meshes.fillMaterial.opacity = entity.alpha;
    meshes.track.visible = true;
    meshes.track.scale.set(rects.track.width, rects.track.height, 1);
    meshes.track.position.set(rects.track.x, rects.track.y, rects.track.z);
    meshes.fill.visible = rects.fill.width > 0;
    meshes.fill.scale.set(rects.fill.width, rects.fill.height, 1);
    meshes.fill.position.set(rects.fill.x, rects.fill.y, rects.fill.z);
  }

  private retire(billboard: Billboard): void {
    this.root.remove(billboard.mesh, billboard.shadow);
    billboard.geometry.dispose();
    billboard.material.dispose();
    billboard.shadow.geometry.dispose();
    billboard.shadowMaterial.dispose();
    for (const label of [billboard.tag, billboard.marker]) {
      if (label === null) continue;
      this.root.remove(label.mesh);
      label.mesh.geometry.dispose();
      label.material.dispose();
      label.texture.dispose();
    }
    billboard.tag = null;
    billboard.marker = null;
    if (billboard.hp !== null) {
      for (const bar of [billboard.hp.track, billboard.hp.fill]) {
        this.root.remove(bar);
        bar.geometry.dispose();
        (bar.material as THREE.MeshBasicMaterial).dispose();
      }
      billboard.hp = null;
    }
  }
}

/** The placement anchor a billboard's tag and health bar are measured from. */
function anchorOf(entity: EntityBillboard): TagAnchor {
  return {
    x: entity.x,
    z: entity.z,
    tagAboveFeetTiles: entity.tagAboveFeetTiles,
    tilePx: TILE_SIZE,
  };
}

/** Convert a pixel measurement from the 2D renderer into tiles. */
export function pixelsToTiles(px: number): number {
  return px / TILE_SIZE;
}
