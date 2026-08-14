import { afterEach, describe, expect, it, vi } from "vitest";
import { GameBrain, extractJson } from "../../server/src/ai/GameBrain.ts";
import type { ModelInstance } from "../../server/src/ai/ModelInstance.ts";

function fakeInstance(overrides: { warm?: boolean } = {}): ModelInstance {
  return {
    ensureWarm: vi.fn(async () => overrides.warm ?? true),
    markUsed: vi.fn(),
    port: 9999,
  } as unknown as ModelInstance;
}

function okChatResponse(text: string): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GameBrain", () => {
  it("returns the assistant text from a successful completion", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init: RequestInit) => okChatResponse("  Hello there!  "),
    );
    vi.stubGlobal("fetch", fetchMock);
    const brain = new GameBrain(fakeInstance(), { requestTimeoutMs: 1000 });
    const result = await brain.chat("system", "user", 16);
    expect(result).toBe("Hello there!");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toBe("system");
    expect(body.max_tokens).toBe(16);
  });

  it("returns null when the instance is cold (ensureWarm false)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const brain = new GameBrain(fakeInstance({ warm: false }), {
      requestTimeoutMs: 1000,
    });
    expect(await brain.chat("s", "u", 8)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on timeout", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("aborted")), 80);
          (init.signal as AbortSignal).addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const brain = new GameBrain(fakeInstance(), { requestTimeoutMs: 20 });
    expect(await brain.chat("s", "u", 8)).toBeNull();
  });

  it("parses JSON out of prose via completeJson", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okChatResponse('Sure! {"line":"hi"} there')));
    const brain = new GameBrain(fakeInstance(), { requestTimeoutMs: 1000 });
    expect(await brain.completeJson("s", "u", 32)).toEqual({ line: "hi" });
  });

  it("opens the circuit breaker after repeated failures", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("down");
    });
    vi.stubGlobal("fetch", fetchMock);
    const brain = new GameBrain(fakeInstance(), { requestTimeoutMs: 500 });
    expect(await brain.chat("s", "u", 8)).toBeNull();
    expect(await brain.chat("s", "u", 8)).toBeNull();
    expect(await brain.chat("s", "u", 8)).toBeNull();
    const callsAfterBreaker = fetchMock.mock.calls.length;
    expect(await brain.chat("s", "u", 8)).toBeNull();
    // Breaker open — no further HTTP attempted.
    expect(fetchMock.mock.calls.length).toBe(callsAfterBreaker);
  });

  it("marks the instance used on success", async () => {
    const instance = fakeInstance();
    vi.stubGlobal("fetch", vi.fn(async () => okChatResponse("ok")));
    const brain = new GameBrain(instance, { requestTimeoutMs: 1000 });
    await brain.chat("s", "u", 8);
    expect(instance.markUsed).toHaveBeenCalled();
  });
});

describe("extractJson", () => {
  it("extracts a balanced object from prose", () => {
    expect(extractJson('Here: {"a":1,"b":[2,3]} done')).toEqual({ a: 1, b: [2, 3] });
  });

  it("handles strings containing braces", () => {
    expect(extractJson('{"line":"a {b} c"}')).toEqual({ line: "a {b} c" });
  });

  it("returns null without an opening brace or with broken JSON", () => {
    expect(extractJson("no object here")).toBeNull();
    expect(extractJson('{"a": ')).toBeNull();
  });
});
