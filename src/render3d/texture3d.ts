/**
 * Phaser textures, handed to three as GPU textures.
 *
 * The 3D renderer loads nothing of its own: every image is the one the preloader
 * already decoded, so the two renderers can never disagree about art and there is
 * no second asset pipeline to keep in sync.
 */
import * as THREE from "three";
import type Phaser from "phaser";

interface PhaserFrameLike {
  readonly cutX: number;
  readonly cutY: number;
  readonly cutWidth: number;
  readonly cutHeight: number;
  readonly source: { readonly width: number; readonly height: number };
}

/** A frame's art rectangle in three's UV space (V grows upward). */
export function frameUvRect(frame: PhaserFrameLike): QuadUv {
  const width = frame.source.width;
  const height = frame.source.height;
  const u0 = frame.cutX / width;
  const u1 = (frame.cutX + frame.cutWidth) / width;
  const v0 = 1 - (frame.cutY + frame.cutHeight) / height;
  const v1 = 1 - frame.cutY / height;
  return { u0, v0, u1, v1 };
}

/** A rectangle in UV space. */
export interface QuadUv {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/** Art dimensions of the texture behind a key, in source pixels. */
export interface TextureSize {
  readonly width: number;
  readonly height: number;
}

function sourceImageOf(texture: Phaser.Textures.Texture): CanvasImageSource | null {
  const sources = texture.source as unknown as { image?: CanvasImageSource }[];
  const image = sources[0]?.image;
  if (image !== undefined) return image;
  const fallback = (texture as unknown as { getSourceImage?: () => CanvasImageSource }).getSourceImage?.();
  return fallback ?? null;
}

/** Converts Phaser textures into cached three textures. */
export class Texture3DCache {
  private readonly entries = new Map<string, THREE.Texture | null>();

  constructor(private readonly textures: Phaser.Textures.TextureManager) {}

  /** The three texture for a Phaser texture key, or null when it has no art. */
  get(key: string): THREE.Texture | null {
    if (this.entries.has(key)) return this.entries.get(key) ?? null;
    const texture = this.textures.exists(key) ? this.textures.get(key) : null;
    const image = texture === null ? null : sourceImageOf(texture);
    if (image === null) {
      this.entries.set(key, null);
      return null;
    }
    const three = new THREE.Texture(image as unknown as HTMLImageElement);
    three.colorSpace = THREE.SRGBColorSpace;
    three.magFilter = THREE.LinearFilter;
    three.minFilter = THREE.LinearMipmapLinearFilter;
    three.generateMipmaps = true;
    three.wrapS = THREE.ClampToEdgeWrapping;
    three.wrapT = THREE.ClampToEdgeWrapping;
    three.needsUpdate = true;
    this.entries.set(key, three);
    return three;
  }

  /** A named frame's art rectangle in UV space, with its size in source pixels. */
  frame(key: string, frameName: string): { uv: QuadUv; width: number; height: number } | null {
    if (!this.textures.exists(key)) return null;
    const texture = this.textures.get(key);
    if (!texture.has(frameName)) return null;
    const frame = texture.get(frameName) as unknown as PhaserFrameLike;
    return { uv: frameUvRect(frame), width: frame.cutWidth, height: frame.cutHeight };
  }

  /** Art dimensions behind a Phaser texture key, in source pixels. */
  size(key: string): TextureSize | null {
    if (!this.textures.exists(key)) return null;
    const texture = this.textures.get(key);
    const source = (texture as unknown as { source?: { width: number; height: number }[] }).source?.[0];
    if (source === undefined) return null;
    return { width: source.width, height: source.height };
  }

  /** Whether a key's art repeats, which the far ground plane needs. */
  repeat(key: string): THREE.Texture | null {
    const texture = this.get(key);
    if (texture === null) return null;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  /** Free every converted texture's GPU memory. */
  dispose(): void {
    for (const texture of this.entries.values()) texture?.dispose();
    this.entries.clear();
  }
}
