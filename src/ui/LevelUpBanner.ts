import { createIcon } from "./hud/icons.ts";
import { hudLayer } from "./hud/layer.ts";
import { describeMoment, type LevelUpMoment } from "./hud/progression.ts";

/** How long one moment stays up before the next (or nothing) takes its place. */
const HOLD_MS = 2600;

/**
 * The celebration banner: a raised card at the top of the world HUD that
 * announces a level-up, a promotion, or both at once.
 *
 * It is deliberately not a toast stack. A delivery can cross more than one
 * level, and the tutorial's closing delivery also promotes the courier — those
 * are one moment, so they share one card, and if two moments ever arrive back
 * to back the second waits rather than overpainting the first.
 *
 * Copy comes from `progression.ts` (pure, unit-tested); this class only owns
 * DOM, timing and the visible/hidden transition. It renders nothing when the
 * HUD layer is missing, so a headless context cannot break a delivery.
 */
export class LevelUpBanner {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly headline: HTMLElement;
  private readonly details: HTMLElement;
  private readonly queue: LevelUpMoment[] = [];
  private timer: number | null = null;
  private showing: LevelUpMoment | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "level-up-banner";
    this.root.className = "level-up-banner";
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    this.root.hidden = true;

    const glyph = document.createElement("span");
    glyph.className = "level-up-banner__glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.appendChild(createIcon("sparkles", { size: 22 }));

    const text = document.createElement("div");
    text.className = "level-up-banner__text";
    this.title = document.createElement("strong");
    this.title.className = "level-up-banner__title";
    this.headline = document.createElement("span");
    this.headline.className = "level-up-banner__headline";
    this.details = document.createElement("div");
    this.details.className = "level-up-banner__details";
    text.append(this.title, this.headline, this.details);

    this.root.append(glyph, text);
    hudLayer()?.appendChild(this.root);
  }

  /** Queue a moment. Returns false when there is nothing to celebrate. */
  show(moment: LevelUpMoment | null): boolean {
    if (moment === null) return false;
    this.queue.push(moment);
    if (this.showing === null) this.present(this.queue.shift() as LevelUpMoment);
    return true;
  }

  /** The moment on screen, or null while hidden. */
  get current(): LevelUpMoment | null {
    return this.showing;
  }

  /** Queued moments not yet on screen. */
  get pending(): number {
    return this.queue.length;
  }

  destroy(): void {
    this.clearTimer();
    this.queue.length = 0;
    this.showing = null;
    this.root.remove();
  }

  private present(moment: LevelUpMoment): void {
    this.showing = moment;
    this.title.textContent = moment.title;
    this.headline.textContent = moment.headline;
    this.details.replaceChildren(
      ...moment.details.map((line) => {
        const row = document.createElement("span");
        row.className = "level-up-banner__detail";
        row.textContent = line;
        return row;
      }),
    );
    // Tone drives the accent (level = gold, rank = deep green, both = both),
    // and the full sentence is exposed to assistive tech as one announcement
    // rather than three separate reads.
    this.root.classList.remove(
      "level-up-banner--level",
      "level-up-banner--rank",
      "level-up-banner--both",
    );
    this.root.classList.add(`level-up-banner--${moment.tone}`);
    this.root.setAttribute("aria-label", describeMoment(moment));
    this.root.hidden = false;
    // Next frame so the transition runs from the hidden state. Guarded: the
    // banner is constructed in contexts (tests, background tabs) that may not
    // schedule frames, and a missing frame must not skip the announcement.
    const schedule = globalThis.requestAnimationFrame;
    if (typeof schedule === "function") {
      schedule(() => this.root.classList.add("level-up-banner--visible"));
    } else {
      this.root.classList.add("level-up-banner--visible");
    }
    this.timer = window.setTimeout(() => this.dismiss(), HOLD_MS);
  }

  private dismiss(): void {
    this.clearTimer();
    this.root.classList.remove("level-up-banner--visible");
    // Hand the slot to the next moment only after the fade-out, so the card
    // never flickers straight from one celebration into another.
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.showing = null;
      this.root.hidden = true;
      const next = this.queue.shift();
      if (next !== undefined) this.present(next);
    }, 220);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
