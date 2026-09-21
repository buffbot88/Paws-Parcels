export interface DecodedPNG {
  w: number;
  h: number;
  /** Raw RGBA bytes, `w * h * 4` long. */
  px: Buffer;
}

/** Decode an 8-bit non-interlaced PNG (RGBA or RGB) to raw RGBA bytes. */
export function decodePNG(path: string): DecodedPNG;

/** Encode raw RGBA bytes as an 8-bit RGBA PNG. Deterministic for one input. */
export function encodePNG(w: number, h: number, rgba: Buffer): Buffer;
