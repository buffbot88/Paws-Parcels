#!/usr/bin/env node
/**
 * Ask the game's local ASHAT 450M VL to critique the procedural ground
 * textures. Default mode: one model call per single-tile PNG (scripts/tiles/)
 * with a tiny JSON-scored question — small models read one enlarged tile far
 * better than a busy grid. Pass --question to review the whole grid instead.
 *
 * Reuses the production pipeline (ModelInstance + GameBrain from server/src/ai)
 * and the model paths from server_config.json. An already-healthy llama-server
 * on the AI port is reused and left running; otherwise the script spawns the
 * game-owned instance and stops it when done.
 *
 * Usage:
 *   node scripts/render-tiles.mjs
 *   node --import tsx scripts/ai-tile-review.mjs
 *   node --import tsx scripts/ai-tile-review.mjs --question "what looks muddy?"
 */
import { readFileSync, existsSync } from "node:fs";
import { ModelInstance } from "../server/src/ai/ModelInstance.ts";
import { GameBrain, extractJson } from "../server/src/ai/GameBrain.ts";

// --- config: read the same server_config.json the game uses -----------------
let ai = {};
try {
  const raw = JSON.parse(readFileSync(new URL("../server_config.json", import.meta.url), "utf8"));
  ai = raw.ai ?? {};
} catch {
  /* fall back to defaults below */
}
const PORT = ai.port ?? 3101;
const MODEL_PATH =
  ai.modelPath ?? "/home/opc/AshatPlatform/models/LFM2.5-VL-450M-Q8_0.gguf";
const MMPROJ_PATH =
  ai.mmprojPath ?? "/home/opc/AshatPlatform/models/mmproj-LFM2.5-VL-450m-Q8_0.gguf";
const WARMUP_MS = ai.warmupTimeoutMs ?? 90_000;
/** Review chats are bigger than gameplay calls — give the 1-core model room. */
const REVIEW_TIMEOUT_MS = 150_000;

const args = process.argv.slice(2);
const questionFlag = args.indexOf("--question");
const question =
  questionFlag !== -1 && args[questionFlag + 1] ? args[questionFlag + 1] : null;

/** Tile code -> what the model should know it represents. */
export const TILE_NAMES = [
  ["G", "grass meadow"],
  ["P", "dirt path"],
  ["F", "wooden plank floor (indoor)"],
  ["W", "brick wall"],
  ["~", "water"],
  ["T", "tree canopy"],
  ["B", "bush"],
  ["X", "flower bed"],
];

const DIRECTOR =
  "You are the art director for Paws & Parcels, a cozy 2.5D animal MMORPG with " +
  "a warm, storybook style. You review procedural placeholder ground tiles. " +
  "Be concrete, brief, and honest.";

const TILE_SYSTEM =
  DIRECTOR +
  " Reply with JSON ONLY in this exact shape: " +
  '{"color":"one of green|blue|brown|tan|pink|yellow|gray|white",' +
  '"pattern":"one short sentence on the texture pattern","noise":1-5,"contrast":1-5,' +
  '"verdict":"ok|needs-work","fix":"one concrete change or none"}';

const GRID_SYSTEM =
  DIRECTOR +
  " The image is a 4x2 grid of game tiles shown enlarged. Row 1, left to right: " +
  "grass, dirt path, wooden floor (indoor), brick wall. Row 2, left to right: " +
  "water, tree canopy, bush, flower. Each tile has a darker strip at top and " +
  "bottom for pseudo-depth — treat that as intentional. Give per-tile one-line " +
  "notes on palette harmony, contrast, noise and readability at 48px, then the " +
  "top 3 most impactful concrete changes. Plain text, max 250 words.";

async function healthOk(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return body?.status === "ok";
  } catch {
    return false;
  }
}

// A killed script must not orphan its spawned llama-server on the game's
// port (3101) — the game's own power-managed instance would fail to bind.
export let spawned = false;
export let cleanupDone = false;

export async function cleanup(instance) {
  if (cleanupDone) return;
  cleanupDone = true;
  if (spawned) {
    console.log("[model] stopping the instance (spawned by this script)…");
    await instance.stop();
  }
}

/**
 * Open a review session: reuse a healthy game instance on the AI port, else
 * spawn the game-owned one (stopped via close()). Returns { brain, close }.
 */
export async function openReviewSession() {
  // Retry the health probe briefly: the game's instance may be mid-startup
  // (state "starting", health not yet ok) — spawning now would race it for
  // the port. A short retry usually sees it come up.
  let alreadyUp = false;
  for (let attempt = 0; attempt < 4 && !alreadyUp; attempt++) {
    alreadyUp = await healthOk(PORT);
    if (!alreadyUp && attempt < 3) await new Promise((r) => setTimeout(r, 1000));
  }
  const instance = (globalThis.__reviewInstance = new ModelInstance({
    port: PORT,
    modelPath: MODEL_PATH,
    mmprojPath: MMPROJ_PATH,
    idleMs: 60_000,
    warmupTimeoutMs: WARMUP_MS,
    log: (msg, extra) => console.log(`[model] ${msg}${extra?.port ? ` (port ${extra.port})` : ""}`),
  }));
  spawned = !alreadyUp; // drives cleanup(): only stop what this script started

  console.log(alreadyUp
    ? `[model] reusing the running instance on port ${PORT}`
    : `[model] no instance on port ${PORT} — spawning the game-owned one…`);
  const ready = await instance.ensureWarm();
  if (!ready) {
    console.error("model unavailable (files missing or warm-up failed) — giving up");
    process.exit(2);
  }
  const brain = new GameBrain(instance, { requestTimeoutMs: REVIEW_TIMEOUT_MS });
  return { brain, close: () => cleanup(instance) };
}

/** One JSON-scored VL call per enlarged tile; returns [{ code, name, parsed }]. */
export async function collectTileScores(brain) {
  const results = [];
  for (const [code, name] of TILE_NAMES) {
    const tilePath = new URL(`./tiles/${code}.png`, import.meta.url);
    if (!existsSync(tilePath)) {
      console.log(`  ${code} (${name}): missing ${tilePath.pathname.split("/").pop()} — skip`);
      continue;
    }
    const reply = await brain.chat(
      TILE_SYSTEM,
      [
        { type: "text", text: `This is one 48px game tile (shown enlarged): ${name}. Assess it.` },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64," + readFileSync(tilePath).toString("base64") },
        },
      ],
      320,
    );
    // The 450M often wraps its JSON in prose — reuse the server's tolerant extractor.
    const parsed =
      (reply !== null && (extractJson(reply) ?? extractJson(reply.slice(-600)))) ||
      { raw: reply ?? "(null)" };
    results.push({ code, name, parsed });
  }
  return results;
}

async function main() {
  const { brain, close } = await openReviewSession();

  if (question !== null) {
    // Whole-grid mode (legacy / custom questions).
    const gridPath = new URL("./tiles-review.png", import.meta.url);
    if (!existsSync(gridPath)) {
      console.error("tiles-review.png missing — run `node scripts/render-tiles.mjs` first");
      process.exit(1);
    }
    const reply = await brain.chat(
      GRID_SYSTEM,
      [
        { type: "text", text: `Question: ${question}` },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64," + readFileSync(gridPath).toString("base64") },
        },
      ],
      700,
    );
    console.log("\n────────── VL grid review ──────────\n");
    console.log(reply ?? "model returned nothing usable");
  } else {
    // Per-tile mode: one call per enlarged tile, JSON-scored.
    console.log("\n────────── VL per-tile review ──────────");
    const results = await collectTileScores(brain);
    for (const { code, name, parsed } of results) {
      console.log(
        `  ${code} ${name.padEnd(26)} → ${String(parsed?.color ?? "?").padEnd(6)} · ` +
          `noise ${parsed?.noise ?? "?"}/5 · contrast ${parsed?.contrast ?? "?"}/5 · ` +
          `verdict ${String(parsed?.verdict ?? "?")} · fix: ${String(parsed?.fix ?? "?")}`,
      );
    }
    console.log("\n─────────────────────────────────────");
  }

  await close();
}

process.on("SIGINT", () => {
  void (async () => {
    const instance = globalThis.__reviewInstance;
    if (instance) await cleanup(instance);
    process.exit(130);
  })();
});
process.on("SIGTERM", () => {
  void (async () => {
    const instance = globalThis.__reviewInstance;
    if (instance) await cleanup(instance);
    process.exit(143);
  })();
});

// CLI only — the tuner imports this module without starting a review.
if (process.argv[1] && process.argv[1].endsWith("ai-tile-review.mjs")) {
  main().catch((err) => {
    console.error("review failed:", err);
    process.exit(1);
  });
}
