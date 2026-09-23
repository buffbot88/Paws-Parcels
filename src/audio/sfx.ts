/**
 * Courier sound effects — synthesised, not sampled.
 *
 * The project ships no audio assets (`reference/assets` holds art only), and
 * adding authored sound files is a content decision rather than a HUD one. A
 * short WebAudio figure gives the celebration its audio without introducing
 * files: the notes are a plain C-major arpeggio, so the chime is ours.
 *
 * Rules this module keeps:
 *   - Nothing is created until the first sound is asked for. Constructing an
 *     AudioContext at import time trips browser autoplay policy and would run
 *     in the Node test environment, where there is no `window`.
 *   - Muting is a local, non-authoritative preference (`localStorage`), like
 *     the HUD's other display settings — never server state.
 *   - Every call is a no-op when the platform has no WebAudio, so a missing
 *     context can never break a delivery.
 */

export type ProgressionSfx = "level" | "rank" | "both";

type AudioContextLike = {
  currentTime: number;
  state?: string;
  destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  resume?(): Promise<void>;
};

/** Persisted, local-only preference key. */
const MUTE_KEY = "paws.audio.muted";

/** Peak gain per note — a HUD chime, not a soundtrack. */
const PEAK_GAIN = 0.14;

const listeners = new Set<(muted: boolean) => void>();
let context: AudioContextLike | null = null;
let unavailable = false;

function readMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === "1";
  } catch {
    // Storage can be blocked (private mode / sandboxed frame) — sound stays on.
    return false;
  }
}

let muted = readMuted();

function writeMuted(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    /* preference is best-effort */
  }
}

function audioContext(): AudioContextLike | null {
  if (context !== null || unavailable) return context;
  const ctor =
    (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext ??
    (globalThis as { webkitAudioContext?: new () => AudioContextLike }).webkitAudioContext;
  if (ctor === undefined) {
    unavailable = true;
    return null;
  }
  try {
    context = new ctor();
  } catch {
    unavailable = true;
    return null;
  }
  return context;
}

/** One enveloped note. Offsets are seconds from now. */
function note(
  ctx: AudioContextLike,
  frequency: number,
  startOffset: number,
  duration: number,
  type: OscillatorType,
): void {
  const at = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, at);
  // Fast attack, gentle decay: a bell rather than a beep.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.05);
}

/** Rising triads; the promotion adds the octave and a shimmer on top. */
const FIGURES: Readonly<Record<ProgressionSfx, readonly number[]>> = {
  level: [523.25, 659.25, 783.99], // C5 E5 G5
  rank: [659.25, 783.99, 1046.5], // E5 G5 C6
  both: [523.25, 659.25, 783.99, 1046.5], // C5 E5 G5 C6
};

export const sfx = {
  isMuted(): boolean {
    return muted;
  },

  setMuted(value: boolean): void {
    if (muted === value) return;
    muted = value;
    writeMuted(value);
    for (const listener of listeners) listener(muted);
  },

  toggleMuted(): boolean {
    sfx.setMuted(!muted);
    return muted;
  },

  /** Notify on mute changes (the top bar's sound toggle). */
  subscribe(listener: (muted: boolean) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Play the level-up / promotion figure. Silent when muted or unsupported. */
  playProgression(tone: ProgressionSfx): void {
    if (muted) return;
    const ctx = audioContext();
    if (ctx === null) return;
    // A context that is still suspended (first gesture of the session) is
    // resumed rather than dropped, but we never await it — a delivery must not
    // wait on audio.
    if (ctx.state === "suspended") void ctx.resume?.().catch(() => undefined);
    const notes = FIGURES[tone];
    notes.forEach((frequency, index) => {
      note(ctx, frequency, index * 0.11, 0.5, "triangle");
    });
    if (tone !== "level") note(ctx, 1567.98, 0.44, 0.7, "sine"); // G6 sparkle
  },
};
