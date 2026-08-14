/**
 * Scene-snapshot image guards for /api/npc/talk (AI game engine).
 *
 * The client sends a JPEG data URL of the game canvas. The encoded payload is
 * validated by reading the JPEG SOF header dimensions directly — a tiny
 * crafted file cannot decode into a huge bitmap (decompression bomb) and OOM
 * the 1-core model host. Anything unparseable or over-size is rejected and the
 * caller falls back to text-only (no vision) rather than blocking.
 */
import type { Buffer as NodeBuffer } from "node:buffer";

const MAX_SCENE_IMAGE_BYTES = 200_000;
const MAX_SCENE_IMAGE_DIMENSION = 4096;
const MAX_CAPTURE_IMAGE_BYTES = 1_500_000;

/** Accept a JPEG data URL under the byte + dimension caps; else null. */
export function validSceneImage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (match === null) return null;
  const b64 = match[1];
  if (b64.length > MAX_SCENE_IMAGE_BYTES) return null;
  const dims = jpegDimensions(b64);
  if (dims === null) return null;
  if (
    dims.width > MAX_SCENE_IMAGE_DIMENSION ||
    dims.height > MAX_SCENE_IMAGE_DIMENSION
  ) {
    return null;
  }
  return value;
}

/** Accept a PNG data URL for the Admin visual-capture endpoint. */
export function validScenePng(value: unknown): { dataUrl: string; base64: string } | null {
  if (typeof value !== "string") return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (match === null || match[1].length > MAX_CAPTURE_IMAGE_BYTES * 2) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length === 0 || bytes.length > MAX_CAPTURE_IMAGE_BYTES || !bytes.subarray(0, 8).equals(signature)) return null;
  if (bytes.length < 24 || !bytes.subarray(12, 16).equals(Buffer.from("IHDR"))) return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > MAX_SCENE_IMAGE_DIMENSION || height > MAX_SCENE_IMAGE_DIMENSION) return null;
  return { dataUrl: value, base64: match[1] };
}

/** Decode a base64 JPEG payload and read its SOF dimensions, or null. */
export function jpegDimensions(b64: string): { width: number; height: number } | null {
  let buf: Uint8Array;
  try {
    const raw: NodeBuffer = Buffer.from(b64, "base64");
    buf = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  } catch {
    return null;
  }
  return scanJpeg(buf);
}

/** Walk JPEG segments until an SOF marker yields the frame dimensions. */
function scanJpeg(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // SOI
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null; // markers must be 0xFF-prefixed
    let j = i + 1;
    while (j < buf.length && buf[j] === 0xff) j += 1; // fill bytes
    if (j >= buf.length) return null;
    const marker = buf[j];
    const segStart = j + 1;
    // Standalone markers carry no length.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = segStart;
      continue;
    }
    if (segStart + 2 > buf.length) return null;
    const segLen = (buf[segStart] << 8) | buf[segStart + 1];
    if (segLen < 2) return null;
    if (marker === 0xd9) return null; // EOI before any SOF — no frame dims
    if (marker === 0xda) return null; // SOS — entropy data; SOF precedes it
    const isSof =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (segStart + 2 + 5 > buf.length) return null;
      const height = (buf[segStart + 3] << 8) | buf[segStart + 4];
      const width = (buf[segStart + 5] << 8) | buf[segStart + 6];
      if (width === 0 || height === 0) return null;
      return { width, height };
    }
    i = segStart + segLen;
  }
  return null;
}
