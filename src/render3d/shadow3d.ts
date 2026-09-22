/**
 * Cast shadows for the 3D world.
 *
 * Same recipe as the 2D renderer (`shadowRecipe`), laid on the ground as a radial
 * pool of darkness, so a trunk and a facade still cast shadows of their own
 * weight and the two renderers agree where the light is.
 */
import * as THREE from "three";
import { shadowRecipe } from "../game/lighting.ts";
import { FLAT_PITCH, fullUv, type QuadSpec } from "./geometry3d.ts";

const SHADOW_TEXTURE_PX = 64;

/** The radial pool of darkness every shadow quad samples. */
export function createShadowTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = SHADOW_TEXTURE_PX;
  canvas.height = SHADOW_TEXTURE_PX;
  const context = canvas.getContext("2d");
  if (context !== null) {
    const centre = SHADOW_TEXTURE_PX / 2;
    const gradient = context.createRadialGradient(centre, centre, 0, centre, centre, centre);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.62, "rgba(255, 255, 255, 0.78)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(centre, centre, centre, centre, 0, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Sample the shared shadow colour, in linear 0-1 components. */
export function shadowColour(hex: number): [number, number, number] {
  const colour = new THREE.Color(hex);
  return [colour.r, colour.g, colour.b];
}

/**
 * A flat shadow quad for a piece standing its base line at `(x, z)` in tiles.
 *
 * Sizes and offsets come from the shared lighting recipe, so a wider ground
 * contact casts a wider, softer shadow here exactly as it does in 2D.
 */
export function shadowQuadFor(
  x: number,
  z: number,
  footprintWidthPx: number,
  tilePx: number,
): QuadSpec {
  const recipe = shadowRecipe(footprintWidthPx);
  const colour = shadowColour(recipe.color);
  return {
    x: x + recipe.offsetXPx / tilePx,
    y: 0.012,
    z: z + recipe.offsetYPx / tilePx,
    width: recipe.widthPx / tilePx,
    height: recipe.heightPx / tilePx,
    pitch: FLAT_PITCH,
    uv: fullUv(),
    rgba: [colour[0], colour[1], colour[2], recipe.alpha],
  };
}
