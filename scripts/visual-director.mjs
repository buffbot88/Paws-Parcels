#!/usr/bin/env node
/**
 * Dry-run visual director for the local 450M VL.
 *
 * Usage:
 *   node --import tsx scripts/visual-director.mjs \
 *     --image scripts/tiles-review.png
 *   node --import tsx scripts/visual-director.mjs \
 *     --image scene.jpg --metadata scene.json --out tmp/visual-review.json
 *
 * This command only writes a report under the project's tmp/ or reports/
 * directory; it never edits game, map, asset, or palette source files.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, lstatSync, realpathSync } from "node:fs";
import { extname, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelInstance } from "../server/src/ai/ModelInstance.ts";
import { GameBrain } from "../server/src/ai/GameBrain.ts";
import { jpegDimensions } from "../server/src/ai/image.ts";
import { reviewVisualScene } from "../server/src/ai/VisualDirector.ts";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_IMAGE_DIMENSION = 4096;
const args = process.argv.slice(2);
const imagePath = flagValue("--image");
const metadataPath = flagValue("--metadata");
const outputPath = flagValue("--out") ?? "tmp/visual-review.json";

let ai = {};
try {
  const config = JSON.parse(readFileSync(new URL("../server_config.json", import.meta.url), "utf8"));
  ai = config.ai ?? {};
} catch {
  // Defaults below make the command explain model unavailability cleanly.
}

const PORT = ai.port ?? 3101;
const MODEL_PATH = ai.modelPath ?? "/home/opc/AshatPlatform/models/LFM2.5-VL-450M-Q8_0.gguf";
const MMPROJ_PATH = ai.mmprojPath ?? "/home/opc/AshatPlatform/models/mmproj-LFM2.5-VL-450m-Q8_0.gguf";

function flagValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function defaultMetadata() {
  return {
    zoneId: "zone-clover-village",
    zoneName: "Clover Village",
    map: { width: 75, height: 75 },
    camera: { zoom: 0.8 },
    notes: [
      "This is a generated tile/layout preview rather than a live browser capture.",
      "Review palette harmony, readability, and professional 2.5D presentation conservatively.",
    ],
  };
}

function mimeFor(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  throw new Error(`Unsupported image type ${extension}; use PNG or JPEG.`);
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(12, 16).equals(Buffer.from("IHDR"))) return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readVerifiedImage(path) {
  const bytes = readFileSync(path);
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image must be between 1 byte and ${MAX_IMAGE_BYTES} bytes.`);
  }
  const mime = mimeFor(path);
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const jpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  if ((mime === "image/png" && !png) || (mime === "image/jpeg" && !jpeg)) {
    throw new Error(`Image extension does not match its PNG/JPEG signature: ${path}`);
  }
  const dimensions = mime === "image/png"
    ? pngDimensions(bytes)
    : jpegDimensions(bytes.toString("base64"));
  if (
    dimensions === null ||
    dimensions.width > MAX_IMAGE_DIMENSION ||
    dimensions.height > MAX_IMAGE_DIMENSION
  ) {
    throw new Error(`Image dimensions must be valid and at most ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION}.`);
  }
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function safeReportPath(path) {
  const absolute = resolve(PROJECT_ROOT, path);
  const relativePath = relative(PROJECT_ROOT, absolute);
  const topLevel = relativePath.split(/[\\/]/)[0];
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    absolute === PROJECT_ROOT ||
    !["tmp", "reports"].includes(topLevel) ||
    !absolute.endsWith(".json")
  ) {
    throw new Error("--out must be a .json report inside project tmp/ or reports/.");
  }
  const parent = dirname(absolute);
  if (existsSync(parent) && realpathSync(parent) !== parent) {
    throw new Error("--out parent directory may not be a symlink.");
  }
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
    throw new Error("--out may not replace a symlink.");
  }
  return absolute;
}

async function healthOk() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Adapt an already-running endpoint to the GameBrain instance contract. */
function runningInstance() {
  return {
    port: PORT,
    ensureWarm: async () => true,
    markUsed: () => undefined,
  };
}

function unavailableReport() {
  return {
    status: "unavailable",
    overall: 0,
    summary: "The 450M VL instance was unavailable; no visual changes were proposed.",
    issues: [],
    reviewedAt: new Date().toISOString(),
  };
}

async function main() {
  if (imagePath === null) throw new Error("Missing --image <PNG-or-JPEG-path>.");
  const absoluteImagePath = resolve(PROJECT_ROOT, imagePath);
  const absoluteOutputPath = safeReportPath(outputPath);
  if (!existsSync(absoluteImagePath)) throw new Error(`Image not found: ${absoluteImagePath}`);

  const metadata = metadataPath === null
    ? defaultMetadata()
    : JSON.parse(readFileSync(resolve(PROJECT_ROOT, metadataPath), "utf8"));
  const imageDataUrl = readVerifiedImage(absoluteImagePath);
  const alreadyUp = await healthOk();
  const instance = alreadyUp
    ? runningInstance()
    : new ModelInstance({
        port: PORT,
        modelPath: MODEL_PATH,
        mmprojPath: MMPROJ_PATH,
        idleMs: 60_000,
        warmupTimeoutMs: ai.warmupTimeoutMs ?? 90_000,
        log: (message, extra) => console.log(`[visual-director] ${message}`, extra ?? ""),
      });

  try {
    if (!(await instance.ensureWarm())) {
      mkdirSync(dirname(absoluteOutputPath), { recursive: true });
      writeFileSync(absoluteOutputPath, `${JSON.stringify(unavailableReport(), null, 2)}\n`);
      console.log(`[visual-director] wrote unavailable report to ${absoluteOutputPath}`);
      return;
    }
    // Visual review includes an image prompt and is intentionally offline; do
    // not inherit the 4s real-time NPC/combat budget from the game server.
    const visualReviewTimeoutMs = Math.max(60_000, ai.visualReviewTimeoutMs ?? 60_000);
    const brain = new GameBrain(instance, { requestTimeoutMs: visualReviewTimeoutMs });
    const report = await reviewVisualScene(brain, { imageDataUrl, metadata });
    mkdirSync(dirname(absoluteOutputPath), { recursive: true });
    writeFileSync(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[visual-director] wrote dry-run report to ${absoluteOutputPath}`);
  } finally {
    if (!alreadyUp) await instance.stop();
  }
}

if (process.argv[1]?.endsWith("visual-director.mjs")) {
  main().catch((error) => {
    console.error(`[visual-director] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
