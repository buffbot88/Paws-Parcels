/**
 * Per-zone atmosphere for the 3D world: distance fog and drifting ambient motes.
 *
 * Both are decoration, so both switch off with `graphicsQuality: "low"`, and the
 * motes also stop for reduced motion. Every mote's path is a pure function of
 * its index and the clock, so nothing is simulated and nothing accumulates.
 */
import * as THREE from "three";
import { ambientPoint, zoneAtmosphere, type AmbientStyle, type ZoneFog } from "../game/atmosphere.ts";

export { ambientPoint, wrapInto, zoneAtmosphere } from "../game/atmosphere.ts";
export type { AmbientStyle, ZoneAtmosphere, ZoneFog } from "../game/atmosphere.ts";

const DOT_TEXTURE_PX = 32;

function createDotTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = DOT_TEXTURE_PX;
  canvas.height = DOT_TEXTURE_PX;
  const context = canvas.getContext("2d");
  if (context !== null) {
    const centre = DOT_TEXTURE_PX / 2;
    const gradient = context.createRadialGradient(centre, centre, 0, centre, centre, centre);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.35, "rgba(255, 255, 255, 0.55)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, DOT_TEXTURE_PX, DOT_TEXTURE_PX);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** One zone's motes: a single additive `THREE.Points`. */
export class AmbientParticles {
  readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.PointsMaterial;
  private readonly texture = createDotTexture();
  private readonly positions: Float32Array;
  private readonly colours: Float32Array;
  private readonly tint: THREE.Color;

  constructor(private readonly style: AmbientStyle) {
    this.positions = new Float32Array(style.count * 3);
    this.colours = new Float32Array(style.count * 3);
    this.tint = new THREE.Color(style.colour);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colours, 3));
    this.material = new THREE.PointsMaterial({
      map: this.texture,
      size: style.sizeTiles,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** Move every mote to where it is at `timeSeconds` around `focus`. */
  update(timeSeconds: number, focus: { readonly x: number; readonly z: number }): void {
    for (let i = 0; i < this.style.count; i += 1) {
      const point = ambientPoint(this.style, i, timeSeconds, focus);
      this.positions[i * 3] = point.x;
      this.positions[i * 3 + 1] = point.y;
      this.positions[i * 3 + 2] = point.z;
      // Additive blending: a darker colour is a fainter mote.
      this.colours[i * 3] = this.tint.r * point.glow;
      this.colours[i * 3 + 1] = this.tint.g * point.glow;
      this.colours[i * 3 + 2] = this.tint.b * point.glow;
    }
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
