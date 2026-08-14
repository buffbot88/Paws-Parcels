/**
 * Power-managed llama-server lifecycle (AI game engine).
 *
 * Owns ONE llama-server instance for the game — deliberately separate from
 * the ASHAT Hub's always-on pair (ports 3001/3002, managed by alpha-server;
 * those are never touched). The instance is spawned on demand, polled until
 * its /health endpoint is ready, and spun down after `idleMs` without any
 * request. Never blocks: every public method returns promptly; callers treat
 * "not ready" as "use the deterministic fallback".
 *
 * The spawn + health probe are injectable so tests can drive the state
 * machine without launching a real model process.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";

export type ModelStatus = "down" | "starting" | "ready";

export interface ModelInstanceOptions {
  port: number;
  modelPath: string;
  mmprojPath: string;
  idleMs: number;
  warmupTimeoutMs: number;
  /** Injectable process launcher (tests). Returns the child process. */
  spawn?: (
    command: string,
    args: string[],
  ) => ChildProcessWithoutNullStreams;
  /** Injectable health probe (tests). */
  fetchHealth?: (port: number) => Promise<boolean>;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

const HEALTH_POLL_MS = 500;
const STOP_GRACE_MS = 5_000;

export class ModelInstance {
  private readonly modelPath: string;
  private readonly mmprojPath: string;
  private readonly idleMs: number;
  private readonly warmupTimeoutMs: number;
  private readonly spawnFn: NonNullable<ModelInstanceOptions["spawn"]>;
  private readonly fetchHealth: NonNullable<ModelInstanceOptions["fetchHealth"]>;
  private readonly log: NonNullable<ModelInstanceOptions["log"]>;

  private readonly portValue: number;
  private child: ChildProcessWithoutNullStreams | null = null;
  private state: ModelStatus = "down";
  /** Last wall-clock ms a request used the model (drives idle shutdown). */
  private lastUsedAt = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private startingPromise: Promise<boolean> | null = null;
  /** When the last warm-up attempt failed — retries are throttled. */
  private failedAt = 0;
  private stderrTail = "";

  constructor(opts: ModelInstanceOptions) {
    this.portValue = opts.port;
    this.modelPath = opts.modelPath;
    this.mmprojPath = opts.mmprojPath;
    this.idleMs = opts.idleMs;
    this.warmupTimeoutMs = opts.warmupTimeoutMs;
    this.spawnFn = opts.spawn ?? defaultSpawn;
    this.fetchHealth = opts.fetchHealth ?? defaultFetchHealth;
    this.log = opts.log ?? (() => undefined);
  }

  status(): ModelStatus {
    return this.state;
  }

  /** The port the instance serves on (for the OpenAI-compatible client). */
  get port(): number {
    return this.portValue;
  }

  /**
   * Make sure the instance is up and ready. Resolves true when a request can
   * proceed (started and healthy within the warm-up budget); false when the
   * instance is unavailable — callers fall back to deterministic AI. Safe to
   * call from many places at once: concurrent callers share one startup.
   */
  ensureWarm(): Promise<boolean> {
    this.markUsed();
    if (this.state === "ready") return Promise.resolve(true);
    if (this.startingPromise !== null) return this.startingPromise;
    // A recently failed attempt is answered "cold" immediately so callers
    // fall back fast instead of blocking on a fresh warm-up each time.
    if (Date.now() - this.failedAt < RETRY_AFTER_FAILURE_MS) {
      return Promise.resolve(false);
    }
    this.startingPromise = this.startAndWait();
    return this.startingPromise;
  }

  /** Record model use and (re)start the idle shutdown clock. */
  markUsed(): void {
    this.lastUsedAt = Date.now();
    // Reschedule so the instance only spins down after a full idle window
    // without requests. Only meaningful once ready — startAndWait schedules
    // the timer when startup completes.
    if (this.state === "ready") {
      this.scheduleIdleShutdown();
    }
  }

  /** Stop the instance now (used by tests and graceful shutdown). */
  async stop(): Promise<void> {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.startingPromise = null;
    const child = this.child;
    this.child = null;
    this.state = "down";
    if (child === null) return;
    if (child.exitCode !== null || child.signalCode !== null) return; // already gone

    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, STOP_GRACE_MS);
      child.once("exit", () => {
        clearTimeout(force);
        resolve();
      });
      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(force);
        resolve();
      }
    });
    this.log("AI model instance stopped");
  }

  private async startAndWait(): Promise<boolean> {
    if (this.state === "ready") return true;
    if (this.state === "down" && !this.start()) {
      this.startingPromise = null;
      this.failedAt = Date.now();
      return false;
    }
    // From here the process is starting; a concurrent stop() clears `child`,
    // which the loop below detects and reports as a failed warm-up.
    const deadline = Date.now() + this.warmupTimeoutMs;
    // Poll until healthy or the warm-up budget runs out.
    while (Date.now() < deadline) {
      if (this.child === null || this.child.exitCode !== null) {
        // Process died during startup — report failure.
        this.state = "down";
        this.startingPromise = null;
        this.failedAt = Date.now();
        this.log("AI model instance died during startup", {
          stderr: this.stderrTail.slice(-400),
        });
        return false;
      }
      const healthy = await this.fetchHealth(this.port).catch(() => false);
      if (healthy) {
        this.state = "ready";
        this.failedAt = 0;
        this.scheduleIdleShutdown();
        this.startingPromise = null;
        this.log("AI model instance ready", { port: this.port });
        return true;
      }
      await sleep(HEALTH_POLL_MS);
    }
    this.state = "down";
    this.startingPromise = null;
    this.failedAt = Date.now();
    this.log("AI model instance warm-up timed out", {
      port: this.port,
      timeoutMs: this.warmupTimeoutMs,
      stderr: this.stderrTail.slice(-400),
    });
    void this.stop();
    return false;
  }

  private start(): boolean {
    if (this.state !== "down") return false;
    if (!existsSync(this.modelPath) || !existsSync(this.mmprojPath)) {
      this.log("AI model files missing — AI engine stays off", {
        modelPath: this.modelPath,
        mmprojPath: this.mmprojPath,
      });
      return false;
    }
    this.state = "starting";
    this.stderrTail = "";
    this.log("Starting AI model instance", { port: this.port });
    let child: ChildProcessWithoutNullStreams;
    try {
      // Mirrors the Hub's proven invocation (single thread, mmap+mlock).
      child = this.spawnFn(LLAMA_SERVER, [
        "--host", "127.0.0.1",
        "--port", String(this.port),
        "--model", this.modelPath,
        "--mmproj", this.mmprojPath,
        "--ctx-size", "8192",
        "--threads", "1",
        "--ubatch-size", "2048",
        "--load-mode", "mmap+mlock",
        "--no-webui",
        "--log-disable",
      ]);
    } catch (err) {
      this.state = "down";
      this.log("AI model spawn failed", { error: String(err) });
      return false;
    }
    this.child = child;
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4000);
    });
    child.on("exit", () => {
      if (this.child === child) {
        // Unexpected death (not an intentional stop()).
        this.log("AI model instance exited unexpectedly", {
          stderr: this.stderrTail.slice(-400),
        });
        this.child = null;
        this.state = "down";
      }
    });
    return true;
  }

  private scheduleIdleShutdown(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      // Only idle-shutdown if nothing has used the model since scheduling.
      if (Date.now() - this.lastUsedAt >= this.idleMs) {
        this.log("AI model instance idle — spinning down", { idleMs: this.idleMs });
        void this.stop();
      }
    }, this.idleMs);
    this.idleTimer.unref?.();
  }
}

/** llama-server binary — overridable via env for other hosts. */
const LLAMA_SERVER =
  process.env.LLAMA_SERVER ?? "/home/opc/llama.cpp-src/build/bin/llama-server";

/** Back off re-spawning after a failed warm-up for this long. */
const RETRY_AFTER_FAILURE_MS = 30_000;

function defaultSpawn(
  command: string,
  args: string[],
): ChildProcessWithoutNullStreams {
  return spawn(command, args);
}

async function defaultFetchHealth(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    return body?.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
