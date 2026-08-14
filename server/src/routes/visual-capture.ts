import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { requireAdmin } from "../middleware/auth.ts";
import { errorResponse, jsonResponse } from "../middleware/index.ts";
import { validScenePng } from "../ai/image.ts";
import type { RouteHandler } from "./index.ts";

const MAX_METADATA_BYTES = 120_000;
const MAX_ENTITIES = 500;
const DEFAULT_CAPTURE_DIR = resolve(process.cwd(), "server/data/visual-captures");
const STALE_LOCK_MS = 60 * 60 * 1000;

export interface VisualCaptureDeps {
  captureDir?: string;
  now?: () => Date;
  id?: () => string;
}

/** POST /api/admin/visual-capture — Admin-only server-side review capture. */
export function createVisualCaptureHandler(deps: VisualCaptureDeps = {}): RouteHandler {
  const captureDir = deps.captureDir ?? DEFAULT_CAPTURE_DIR;
  const nowFn = deps.now ?? (() => new Date());
  const idFn = deps.id ?? (() => randomUUID().slice(0, 12));

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const account = await requireAdmin(req, res);
    if (account === null) return;

    const body = (req as unknown as { body?: Record<string, unknown> }).body;
    const imageDataUrl = validScenePng(body?.image);
    if (imageDataUrl === null) {
      errorResponse(res, 400, "INVALID_CAPTURE_IMAGE", "image must be a valid PNG data URL within the capture limits");
      return;
    }

    const metadata = normalizeMetadata(body?.metadata);
    if (metadata === null) {
      errorResponse(res, 400, "INVALID_CAPTURE_METADATA", "metadata is not a valid bounded scene metadata object");
      return;
    }

    const capturedAt = nowFn();
    const stamp = capturedAt.toISOString().replace(/[:.]/g, "-");
    const baseName = `paws-visual-${stamp}-${idFn()}`;
    const imageFile = `${baseName}.png`;
    const metadataFile = `${baseName}.json`;
    const imagePath = join(captureDir, imageFile);
    const metadataPath = join(captureDir, metadataFile);
    const lockPath = join(captureDir, `.${baseName}.lock`);
    const imageTempPath = `${imagePath}.tmp-${randomUUID()}`;
    const metadataTempPath = `${metadataPath}.tmp-${randomUUID()}`;
    let imageCommitted = false;
    let metadataCommitted = false;
    let imageTempCreated = false;
    let metadataTempCreated = false;
    let lockCreated = false;
    try {
      mkdirSync(captureDir, { recursive: true });
      recoverStaleCaptureLocks(captureDir);
      // The exclusive lock closes the race between the collision check and
      // publishing both files, without exposing zero-byte placeholders.
      mkdirSync(lockPath);
      lockCreated = true;
      if (existsSync(imagePath) || existsSync(metadataPath)) {
        const collision = new Error("capture already exists") as NodeJS.ErrnoException;
        collision.code = "EEXIST";
        throw collision;
      }
      writeFileSync(imageTempPath, Buffer.from(imageDataUrl.base64, "base64"), { flag: "wx", mode: 0o600 });
      imageTempCreated = true;
      writeFileSync(
        metadataTempPath,
        `${JSON.stringify({ ...metadata, capturedAt: capturedAt.toISOString(), capturedBy: account.username }, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      metadataTempCreated = true;
      renameSync(imageTempPath, imagePath);
      imageCommitted = true;
      renameSync(metadataTempPath, metadataPath);
      metadataCommitted = true;
    } catch (error) {
      if (imageTempCreated) {
        try { unlinkSync(imageTempPath); } catch { /* best effort cleanup */ }
      }
      if (metadataTempCreated) {
        try { unlinkSync(metadataTempPath); } catch { /* best effort cleanup */ }
      }
      if (imageCommitted) {
        try { unlinkSync(imagePath); } catch { /* best effort cleanup */ }
      }
      if (metadataCommitted) {
        try { unlinkSync(metadataPath); } catch { /* best effort cleanup */ }
      }
      if (lockCreated) {
        try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
      }
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        errorResponse(res, 409, "CAPTURE_EXISTS", "A capture with this id already exists");
      } else {
        errorResponse(res, 500, "CAPTURE_SAVE_FAILED", "Capture could not be saved on the game server");
      }
      return;
    }
    try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* best effort cleanup */ }

    jsonResponse(res, 201, {
      captureId: baseName,
      imageFile,
      metadataFile,
      capturedAt: capturedAt.toISOString(),
    });
  };
}

/** Remove abandoned transactions left by a crashed capture request. */
function recoverStaleCaptureLocks(captureDir: string): void {
  let entries;
  try {
    entries = readdirSync(captureDir, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_LOCK_MS;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(".paws-visual-") || !entry.name.endsWith(".lock")) continue;
    const lockPath = join(captureDir, entry.name);
    try {
      if (statSync(lockPath).mtimeMs > cutoff) continue;
      const baseName = entry.name.slice(1, -5);
      rmSync(lockPath, { recursive: true, force: true });
      for (const extension of [".png", ".json"] as const) {
        try { unlinkSync(join(captureDir, `${baseName}${extension}`)); } catch { /* best effort cleanup */ }
      }
    } catch {
      // A concurrent request may own or have removed this lock already.
    }
  }
}

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (typeof value.zoneId !== "string" || value.zoneId.length < 1 || value.zoneId.length > 80) return null;
  if (!isRecord(value.map) || !boundedInteger(value.map.width, 1, 1000) || !boundedInteger(value.map.height, 1, 1000)) return null;
  if (!isRecord(value.camera) || !boundedNumber(value.camera.zoom, 0.1, 3)) return null;
  if (value.entities !== undefined) {
    if (!Array.isArray(value.entities) || value.entities.length > MAX_ENTITIES) return null;
    for (const entity of value.entities) {
      if (!isRecord(entity) || typeof entity.id !== "string" || entity.id.length > 100) return null;
      if (!boundedNumber(entity.x, -1000, 2000) || !boundedNumber(entity.y, -1000, 2000)) return null;
    }
  }
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length > MAX_METADATA_BYTES) return null;
  } catch {
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
