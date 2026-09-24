/**
 * Combat feedback in the 3D world: floating damage numbers and class attack bursts.
 *
 * The sprite renderer draws both as Phaser objects under a camera the 3D mode
 * hides, so this redraws them as pooled camera-facing quads. The live instance
 * registers itself, which is how `NetworkSystem` finds it without scene wiring.
 */
import * as THREE from "three";
import { TILE_SIZE } from "../game/tileGrid.ts";
import { CAMERA_3D } from "./camera3d.ts";
import type { Texture3DCache } from "./texture3d.ts";
import { getSettings } from "../ui/settings.ts";
import {
  activeWorldEffects,
  damageNumberStyle,
  setActiveWorldEffects,
  type DamageOutcome,
} from "./worldEffectsHandle.ts";

export { damageNumberStyle, activeWorldEffects, type DamageOutcome };

/** How long a damage number lives, matching the 2D tween. */
export const DAMAGE_NUMBER_SECONDS = 0.7;
/** How far it rises, matching the 2D tween's 26px. */
export const DAMAGE_NUMBER_RISE_TILES = 26 / TILE_SIZE;

/**
 * A damage number `ageSeconds` after it appeared: an ease-out rise, a late fade,
 * and a brief pop in size. `done` once it has fully faded.
 */
export function damageNumberCurve(
  ageSeconds: number,
  riseTiles = DAMAGE_NUMBER_RISE_TILES,
): { rise: number; alpha: number; scale: number; done: boolean } {
  const p = Math.max(0, Math.min(1, ageSeconds / DAMAGE_NUMBER_SECONDS));
  return {
    rise: riseTiles * (1 - (1 - p) ** 2),
    alpha: 1 - p * p,
    scale: 1 + 0.3 * Math.max(0, 1 - p / 0.15),
    done: ageSeconds >= DAMAGE_NUMBER_SECONDS,
  };
}

/** A class's attack animation: its frame texture keys and the 2D sprite scale. */
export interface AttackEffectArt {
  readonly keys: readonly string[];
  readonly scale: number;
}

/** The 2D effect's frame rate. */
const ATTACK_EFFECT_FPS = 18;
/** Numbers are drawn at twice their world pixels, so they stay crisp. */
const NUMBER_CANVAS = { width: 160, height: 56, density: 2 } as const;
const POOL_SIZE = 12;
/** Numbers start above the name tag and health bar, which sit just over the head. */
const NUMBER_ABOVE_HEAD_TILES = 0.45;
const BILLBOARD_YAW = (CAMERA_3D.yawDeg * Math.PI) / 180;
/** Nudge toward the camera so a burst never shares its target's plane. */
const EFFECT_LIFT_TILES = 0.08;

interface Floater {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly texture: THREE.CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  age: number;
  baseY: number;
  rise: number;
  sizeScale: number;
}

interface Burst {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  keys: readonly string[];
  age: number;
}

/** Pools and steps the transient combat quads. */
export class WorldEffects3D {
  private readonly root = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly floaters: Floater[] = [];
  private readonly bursts: Burst[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly cache: Texture3DCache,
  ) {
    this.scene.add(this.root);
    setActiveWorldEffects(this);
  }

  /** Float a damage number up from above a figure `headTiles` tall. */
  damageNumber(x: number, z: number, headTiles: number, damage: number, outcome: DamageOutcome): void {
    const floater = this.claim(this.floaters, () => this.createFloater());
    const style = damageNumberStyle(damage, outcome);
    const context = floater.canvas.getContext("2d");
    if (context !== null) {
      const { width, height, density } = NUMBER_CANVAS;
      context.clearRect(0, 0, width, height);
      context.font = `bold ${style.fontPx * density}px Georgia, serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineJoin = "round";
      context.lineWidth = 3 * density;
      context.strokeStyle = "#2b2b2b";
      context.strokeText(style.label, width / 2, height / 2);
      context.fillStyle = style.colour;
      context.fillText(style.label, width / 2, height / 2);
      floater.texture.needsUpdate = true;
    }
    floater.age = 0;
    floater.baseY = headTiles + NUMBER_ABOVE_HEAD_TILES;
    // Reduced motion: the number fades in place instead of rising.
    floater.rise = getSettings().reducedMotion ? 0 : DAMAGE_NUMBER_RISE_TILES;
    floater.sizeScale = outcome === "crit" ? 1.2 : 1;
    floater.mesh.position.set(x, floater.baseY, z + EFFECT_LIFT_TILES);
    floater.mesh.visible = true;
  }

  /** Play a class attack animation centred `centreTiles` above the ground at `(x, z)`. */
  attackEffect(art: AttackEffectArt, x: number, z: number, centreTiles: number): void {
    const first = art.keys[0];
    const size = first === undefined ? null : this.cache.size(first);
    if (first === undefined || size === null || this.cache.get(first) === null) return;
    const burst = this.claim(this.bursts, () => this.createBurst());
    burst.keys = art.keys;
    burst.age = 0;
    this.showFrame(burst, 0);
    burst.mesh.scale.set((size.width * art.scale) / TILE_SIZE, (size.height * art.scale) / TILE_SIZE, 1);
    burst.mesh.position.set(x, centreTiles, z + EFFECT_LIFT_TILES);
    burst.mesh.visible = true;
  }

  /** Advance every live effect by one frame. */
  step(dtSeconds: number): void {
    for (const floater of this.floaters) {
      if (!floater.mesh.visible) continue;
      floater.age += dtSeconds;
      const curve = damageNumberCurve(floater.age, floater.rise);
      if (curve.done) {
        floater.mesh.visible = false;
        continue;
      }
      const scale = curve.scale * floater.sizeScale;
      floater.mesh.position.y = floater.baseY + curve.rise;
      floater.mesh.scale.set(
        (NUMBER_CANVAS.width / NUMBER_CANVAS.density / TILE_SIZE) * scale,
        (NUMBER_CANVAS.height / NUMBER_CANVAS.density / TILE_SIZE) * scale,
        1,
      );
      floater.material.opacity = curve.alpha;
    }
    for (const burst of this.bursts) {
      if (!burst.mesh.visible) continue;
      burst.age += dtSeconds;
      const frame = Math.floor(burst.age * ATTACK_EFFECT_FPS);
      if (frame >= burst.keys.length) burst.mesh.visible = false;
      else this.showFrame(burst, frame);
    }
  }

  dispose(): void {
    if (activeWorldEffects() === this) setActiveWorldEffects(null);
    this.scene.remove(this.root);
    for (const floater of this.floaters) {
      floater.material.dispose();
      floater.texture.dispose();
    }
    for (const burst of this.bursts) burst.material.dispose();
    this.geometry.dispose();
    this.floaters.length = 0;
    this.bursts.length = 0;
  }

  /** A free pool entry, growing to `POOL_SIZE`, then recycling the oldest. */
  private claim<T extends { mesh: THREE.Mesh; age: number }>(pool: T[], create: () => T): T {
    const free = pool.find((entry) => !entry.mesh.visible);
    if (free !== undefined) return free;
    if (pool.length < POOL_SIZE) {
      const created = create();
      pool.push(created);
      return created;
    }
    return pool.reduce((oldest, entry) => (entry.age > oldest.age ? entry : oldest));
  }

  private createFloater(): Floater {
    const canvas = document.createElement("canvas");
    canvas.width = NUMBER_CANVAS.width;
    canvas.height = NUMBER_CANVAS.height;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.rotation.y = BILLBOARD_YAW;
    mesh.renderOrder = 12;
    this.root.add(mesh);
    return { mesh, material, texture, canvas, age: 0, baseY: 0, rise: 0, sizeScale: 1 };
  }

  private createBurst(): Burst {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.rotation.y = BILLBOARD_YAW;
    mesh.renderOrder = 7;
    this.root.add(mesh);
    return { mesh, material, keys: [], age: 0 };
  }

  private showFrame(burst: Burst, frame: number): void {
    const key = burst.keys[frame];
    const texture = key === undefined ? null : this.cache.get(key);
    if (texture !== null && burst.material.map !== texture) {
      burst.material.map = texture;
      burst.material.needsUpdate = true;
    }
  }
}
