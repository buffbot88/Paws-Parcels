import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

// The instance checks the model files exist before spawning — stub that.
vi.mock("node:fs", () => ({ existsSync: () => true }));

import { ModelInstance } from "../../server/src/ai/ModelInstance.ts";

type FakeChild = EventEmitter & {
  stderr: EventEmitter;
  exitCode: number | null;
  signalCode: number | null;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => {
    child.exitCode = 0;
    child.emit("exit");
    return true;
  });
  return child;
}

function makeInstance(opts: {
  fetchHealth?: (port: number) => Promise<boolean>;
  spawn?: () => FakeChild;
  idleMs?: number;
  warmupTimeoutMs?: number;
  log?: (m: string) => void;
}): { instance: ModelInstance; child: FakeChild; spawnArgs: string[][] } {
  const child = opts.spawn?.() ?? fakeChild();
  const spawnArgs: string[][] = [];
  const instance = new ModelInstance({
    port: 3101,
    modelPath: "/models/test.gguf",
    mmprojPath: "/models/mmproj-test.gguf",
    idleMs: opts.idleMs ?? 600_000,
    warmupTimeoutMs: opts.warmupTimeoutMs ?? 90_000,
    spawn: (_cmd, args) => {
      spawnArgs.push(args);
      return child as unknown as ChildProcessWithoutNullStreams;
    },
    fetchHealth: opts.fetchHealth ?? (async () => true),
    log: opts.log,
  });
  return { instance, child, spawnArgs };
}

afterEach(() => {
  // The idle-shutdown tests use fake timers; restore so later tests that
  // await real sleeps (health polling) don't hang.
  vi.useRealTimers();
});

describe("ModelInstance", () => {
  it("starts, polls health, and becomes ready", async () => {
    let polls = 0;
    const { instance, child, spawnArgs } = makeInstance({
      fetchHealth: async () => {
        polls += 1;
        return polls >= 2;
      },
    });
    const ready = await instance.ensureWarm();
    expect(ready).toBe(true);
    expect(instance.status()).toBe("ready");
    expect(spawnArgs[0]).toContain("--port");
    expect(spawnArgs[0]).toContain("3101");
    expect(spawnArgs[0]).toContain("--model");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("returns false when the model never becomes healthy and stops the instance", async () => {
    const { instance, child } = makeInstance({
      fetchHealth: async () => false,
      warmupTimeoutMs: 150,
    });
    const ready = await instance.ensureWarm();
    expect(ready).toBe(false);
    expect(instance.status()).toBe("down");
    expect(child.kill).toHaveBeenCalled();
  });

  it("stays down when the spawn fails", async () => {
    const instance = new ModelInstance({
      port: 3101,
      modelPath: "/models/test.gguf",
      mmprojPath: "/models/mmproj-test.gguf",
      idleMs: 600_000,
      warmupTimeoutMs: 90_000,
      spawn: () => {
        throw new Error("boom");
      },
      fetchHealth: async () => true,
    });
    const ready = await instance.ensureWarm();
    expect(ready).toBe(false);
    expect(instance.status()).toBe("down");
  });

  it("spins the instance down after idleMs without use", async () => {
    vi.useFakeTimers();
    const { instance, child } = makeInstance({ idleMs: 120 });
    await instance.ensureWarm();
    expect(instance.status()).toBe("ready");
    vi.advanceTimersByTime(320);
    expect(child.kill).toHaveBeenCalled();
    expect(instance.status()).toBe("down");
  });

  it("markUsed resets the idle shutdown clock", async () => {
    vi.useFakeTimers();
    const { instance, child } = makeInstance({ idleMs: 120 });
    await instance.ensureWarm();
    vi.advanceTimersByTime(50);
    instance.markUsed(); // resets the clock — spin-down moves to now + 120ms
    // Still within the fresh idle window (deadline now +120ms).
    vi.advanceTimersByTime(100);
    expect(child.kill).not.toHaveBeenCalled();
    // Past the rescheduled deadline — the instance must spin down.
    vi.advanceTimersByTime(120);
    expect(child.kill).toHaveBeenCalled();
  });

  it("stop() terminates a running child and marks down", async () => {
    const { instance, child } = makeInstance({});
    await instance.ensureWarm();
    expect(instance.status()).toBe("ready");
    await instance.stop();
    expect(instance.status()).toBe("down");
    expect(child.kill).toHaveBeenCalled();
    // Stop again is a no-op.
    await instance.stop();
    expect(instance.status()).toBe("down");
  });
});
