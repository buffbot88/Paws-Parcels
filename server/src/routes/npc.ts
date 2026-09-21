/**
 * POST /api/npc/talk — AI-backed NPC dialogue (AI game engine).
 *
 * The client opens the canned dialogue immediately and appends the AI line
 * when it arrives, so this endpoint never gates gameplay. Response contract:
 *   { line: string | null, source: "ai" | "canned" }
 * "canned" (or any error) means the client keeps its local dialogue.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { requireAccount } from "../middleware/auth.ts";
import { errorResponse, jsonResponse } from "../middleware/index.ts";
import type { RouteHandler } from "./index.ts";
import type { BrainUserPart, GameBrain } from "../ai/GameBrain.ts";
import {
  npcDialogueSystemPrompt,
  npcDialogueUserText,
  type NpcDialogueContext,
} from "../ai/prompts.ts";
import { validSceneImage } from "../ai/image.ts";

export interface NpcInfo {
  id: string;
  name: string;
  species: string;
  personality: string;
  role: string;
  homeZone: string;
  homeTile: { x: number; y: number };
}

export interface NpcTalkDeps {
  brain: GameBrain | null;
  npcTalkMinIntervalMs: number;
  maxTokensNpc: number;
  /** Injectable catalog (tests); defaults to the shipped src/data/npcs.json. */
  catalog?: Map<string, NpcInfo>;
  /** Injectable clock (tests). */
  now?: () => number;
}

/**
 * Resolve relative to this module, never process.cwd() — the server must find
 * the NPC catalog no matter where it is launched from (a server started with a
 * different working directory used to answer 404 UNKNOWN_NPC for every NPC).
 */
const NPCS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/data/npcs.json",
);

/** Load the NPC catalog from the client data file (cached at module load). */
function loadNpcCatalog(): Map<string, NpcInfo> {
  const out = new Map<string, NpcInfo>();
  try {
    const path = NPCS_PATH;
    if (!existsSync(path)) return out;
    const raw = JSON.parse(readFileSync(path, "utf8")) as { npcs?: NpcInfo[] };
    for (const npc of raw.npcs ?? []) {
      if (typeof npc.id === "string" && npc.id !== "") out.set(npc.id, npc);
    }
  } catch {
    /* catalog unavailable — endpoint behaves as canned-only */
  }
  return out;
}

export function createNpcTalkHandler(deps: NpcTalkDeps): RouteHandler {
  const catalog = deps.catalog ?? loadNpcCatalog();
  const nowFn = deps.now ?? (() => Date.now());
  const lastTalkAt = new Map<string, number>();

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const account = await requireAccount(req, res);
    if (account === null) return;

    const body = (req as unknown as { body?: Record<string, unknown> }).body;
    const npcId = typeof body?.npcId === "string" ? body.npcId : "";
    if (npcId === "") {
      errorResponse(res, 400, "MISSING_NPC", "npcId is required");
      return;
    }
    const npc = catalog.get(npcId);
    if (npc === undefined) {
      errorResponse(res, 404, "UNKNOWN_NPC", `No NPC \"${npcId}\" in Clover Village`);
      return;
    }

    // With the brain disabled there is no AI work — answer canned without
    // touching the rate limiter (it exists to protect the model host).
    if (deps.brain === null) {
      jsonResponse(res, 200, { line: null, source: "canned" });
      return;
    }

    // Per-account rate limit (protects the 1-core model host).
    const now = nowFn();
    const last = lastTalkAt.get(String(account.id)) ?? 0;
    // `last === 0` means the account has never talked here — always allow.
    if (last !== 0 && now - last < deps.npcTalkMinIntervalMs) {
      errorResponse(
        res,
        429,
        "TOO_MANY_TALKS",
        "The courier is chatting a mile a minute — give it a moment.",
      );
      return;
    }
    lastTalkAt.set(String(account.id), now);
    if (lastTalkAt.size > 512) {
      // Opportunistic prune of stale entries.
      const cutoff = now - deps.npcTalkMinIntervalMs;
      for (const [id, at] of lastTalkAt) {
        if (at < cutoff) lastTalkAt.delete(id);
      }
    }

    const topic = typeof body?.topic === "string" ? body.topic.slice(0, 120) : undefined;
    const playerName =
      typeof body?.playerName === "string" ? body.playerName.slice(0, 40) : "";
    const ctx: NpcDialogueContext = {
      npcId,
      name: npc.name,
      species: npc.species,
      personality: npc.personality,
      role: npc.role,
      playerName: playerName !== "" ? playerName : (account.display_name || "courier"),
      topic,
    };

    const imageUrl = validSceneImage(body?.sceneImage);
    const user: string | BrainUserPart[] = imageUrl === null
      ? npcDialogueUserText(ctx)
      : [
          { type: "text", text: npcDialogueUserText(ctx) },
          { type: "image_url", image_url: { url: imageUrl } },
        ];

    const parsed = await deps.brain.completeJson(
      npcDialogueSystemPrompt(ctx),
      user,
      deps.maxTokensNpc,
    );
    const line = typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>).line
      : null;
    if (typeof line === "string" && line.trim() !== "") {
      jsonResponse(res, 200, { line: line.trim().slice(0, 280), source: "ai" });
      return;
    }
    jsonResponse(res, 200, { line: null, source: "canned" });
  };
}


