/**
 * Merged quad geometry for the static world.
 *
 * One geometry per material keeps a zone with ~200 props at a handful of draw
 * calls while still giving every piece its own placement, size, orientation,
 * UV rectangle and RGBA tint.
 */
import * as THREE from "three";

/** One textured quad, in world units. */
export interface QuadSpec {
  /** Quad centre. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  /** Rotation about the world's up axis, in radians. */
  readonly yaw?: number;
  /** Rotation about the quad's own X axis, in radians; -PI/2 lays it flat. */
  readonly pitch?: number;
  /** Rotation within the quad's own plane, in radians (the sprite's rotation). */
  readonly roll?: number;
  /** Source rectangle in UV space (three's convention: V grows upward). */
  readonly uv: { u0: number; v0: number; u1: number; v1: number };
  /** Corner colours and alpha, each 0-1. */
  readonly rgba?: readonly [number, number, number, number];
  /** Optional tint applied to the UVs' right/left edge, used for mirrored art. */
  readonly flipU?: boolean;
  readonly flipV?: boolean;
}

/** A flat quad lying on the ground plane, facing up. */
export const FLAT_PITCH = -Math.PI / 2;

/** A single quad's full-art UV rectangle. */
export function fullUv(): QuadSpec["uv"] {
  return { u0: 0, v0: 0, u1: 1, v1: 1 };
}

const WHITE: readonly [number, number, number, number] = [1, 1, 1, 1];

/** Build one merged, indexed geometry from a list of quads. */
export function buildQuadGeometry(quads: readonly QuadSpec[]): THREE.BufferGeometry {
  const positions = new Float32Array(quads.length * 12);
  const uvs = new Float32Array(quads.length * 8);
  const colors = new Float32Array(quads.length * 16);
  const indices = new Uint32Array(quads.length * 6);
  const corner = new THREE.Vector3();

  quads.forEach((quad, index) => {
    const pitch = quad.pitch ?? 0;
    const yaw = quad.yaw ?? 0;
    const roll = quad.roll ?? 0;
    const halfWidth = quad.width / 2;
    const halfHeight = quad.height / 2;
    // Local corners run clockwise from the texture's top-left so the art is
    // never upside down: (-w, +h), (+w, +h), (+w, -h), (-w, -h).
    const local: readonly [number, number][] = [
      [-halfWidth, halfHeight],
      [halfWidth, halfHeight],
      [halfWidth, -halfHeight],
      [-halfWidth, -halfHeight],
    ];
    const rgba = quad.rgba ?? WHITE;
    // Mirrored art is UV-mirrored rather than geometry-mirrored: a negative
    // scale would flip the winding and drop the quad out of the depth buffer.
    const u0 = quad.flipU === true ? quad.uv.u1 : quad.uv.u0;
    const u1 = quad.flipU === true ? quad.uv.u0 : quad.uv.u1;
    const v0 = quad.flipV === true ? quad.uv.v1 : quad.uv.v0;
    const v1 = quad.flipV === true ? quad.uv.v0 : quad.uv.v1;
    const cornersUv: readonly [number, number][] = [
      [u0, v1],
      [u1, v1],
      [u1, v0],
      [u0, v0],
    ];

    for (let i = 0; i < 4; i += 1) {
      const [lx, ly] = local[i] as [number, number];
      const [u, v] = cornersUv[i] as [number, number];
      corner.set(lx, ly, 0);
      corner.applyAxisAngle(new THREE.Vector3(0, 0, 1), roll);
      corner.applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
      corner.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const p = index * 12 + i * 3;
      positions[p] = corner.x + quad.x;
      positions[p + 1] = corner.y + quad.y;
      positions[p + 2] = corner.z + quad.z;
      const t = index * 8 + i * 2;
      uvs[t] = u;
      uvs[t + 1] = v;
      const c = index * 16 + i * 4;
      colors[c] = rgba[0];
      colors[c + 1] = rgba[1];
      colors[c + 2] = rgba[2];
      colors[c + 3] = rgba[3];
    }

    // Counter-clockwise seen from the front (+Z before rotation), which is what
    // three's default front-face culling expects: TL -> BR -> TR, then TL -> BL -> BR.
    const base = index * 4;
    const target = index * 6;
    indices[target] = base;
    indices[target + 1] = base + 2;
    indices[target + 2] = base + 1;
    indices[target + 3] = base;
    indices[target + 4] = base + 3;
    indices[target + 5] = base + 2;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
