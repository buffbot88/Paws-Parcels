/**
 * OpenAI-compatible client for the game-owned llama-server instance. Every
 * method resolves to null on any failure (cold start, timeout, bad JSON,
 * circuit open) — the caller falls back to deterministic game logic. Never
 * throws to callers.
 */
import { ModelInstance } from "./ModelInstance.ts";
import { RemoteModelInstance } from "./RemoteModelInstance.ts";

type BrainModel = ModelInstance | RemoteModelInstance;

export interface BrainTextPart {
  type: "text";
  text: string;
}

export interface BrainImagePart {
  type: "image_url";
  image_url: { url: string };
}

export type BrainUserPart = BrainTextPart | BrainImagePart;

export interface GameBrainOptions {
  requestTimeoutMs: number;
  /** Consecutive failures that open the circuit breaker (default 3). */
  breakerThreshold?: number;
  /** How long the breaker stays open (default 60s). */
  breakerCooldownMs?: number;
}

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

export class GameBrain {
  private readonly requestTimeoutMs: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private failureStreak = 0;
  private breakerUntil = 0;

  constructor(
    private readonly instance: BrainModel,
    opts: GameBrainOptions,
    private readonly visionInstance: BrainModel | null = null,
  ) {
    this.requestTimeoutMs = opts.requestTimeoutMs;
    this.breakerThreshold = opts.breakerThreshold ?? BREAKER_THRESHOLD;
    this.breakerCooldownMs = opts.breakerCooldownMs ?? BREAKER_COOLDOWN_MS;
  }

  /**
   * One chat-completion turn. Returns the assistant's text trimmed, or null
   * when the model is unavailable / times out / returns nothing usable.
   */
  async chat(
    system: string,
    user: string | BrainUserPart[],
    maxTokens: number,
  ): Promise<string | null> {
    if (Date.now() < this.breakerUntil) return null;
    const hasImage = Array.isArray(user) && user.some((part) => part.type === "image_url");
    const instance = hasImage && this.visionInstance !== null ? this.visionInstance : this.instance;
    const ready = await instance.ensureWarm();
    if (!ready) return null;
    instance.markUsed();

    const content =
      typeof user === "string" ? user : user.map(partToChatContent);
    const endpoint = "baseUrl" in instance
      ? `${instance.baseUrl}/v1/chat/completions`
      : `http://127.0.0.1:${instance.port}/v1/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "local",
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
          max_tokens: maxTokens,
          temperature: 0.7,
          stream: false,
        }),
      });
      if (!res.ok) {
        this.noteFailure();
        return null;
      }
      const body = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: unknown } }[];
      } | null;
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.trim() === "") {
        this.noteFailure();
        return null;
      }
      this.failureStreak = 0;
      return text.trim();
    } catch {
      this.noteFailure();
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fire-and-forget warm-up so the first real call isn't cold. */
  prewarm(): void {
    void this.instance.ensureWarm();
    if (this.visionInstance !== null) void this.visionInstance.ensureWarm();
  }

  /** Chat expecting a JSON object; returns the parsed value or null. */
  async completeJson(
    system: string,
    user: string | BrainUserPart[],
    maxTokens: number,
  ): Promise<unknown | null> {
    const text = await this.chat(system, user, maxTokens);
    if (text === null) return null;
    return extractJson(text);
  }

  private noteFailure(): void {
    this.failureStreak += 1;
    if (this.failureStreak >= this.breakerThreshold) {
      this.breakerUntil = Date.now() + this.breakerCooldownMs;
      this.failureStreak = 0;
    }
  }
}

function partToChatContent(part: BrainUserPart): unknown {
  if (part.type === "text") return { type: "text", text: part.text };
  return { type: "image_url", image_url: part.image_url };
}

/** Pull the first balanced {...} object out of a model response. */
export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
