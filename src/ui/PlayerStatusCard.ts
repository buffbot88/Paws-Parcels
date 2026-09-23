import { createAvatar, createPanel, createProgressBar } from "./hud/primitives.ts";
import { createIcon } from "./hud/icons.ts";
import { hudLayer } from "./hud/layer.ts";
import type { ClassResource } from "../game/classStats.ts";

export interface PlayerStatusData {
  name: string;
  rank: string;
  hp: number;
  maxHp: number;
  stamps: number;
  level: number;
}

/** How long the level-up / promotion flash stays on the card. */
const FLASH_MS = 1800;
/** How long the reveal transition takes once the card is shown. */
const REVEAL_TRANSITION_MS = 260;
/** How long the rating flash stays on the card when stamps arrive. */
const RATING_FLASH_MS = 1200;

/** How many stamps the courier rating is scored out of. */
export const STAMP_RATING_SLOTS = 5;

/**
 * HUD v4 player card (top-left, compact): portrait, name + level, health bar,
 * the class's primary resource bar, and the five-stamp courier rating.
 *
 * Every value here is server-owned or server-mirrored: name/level/stamps come
 * from the account's character records, hp/maxHp from the socket, and the
 * resource kind + ceiling from `src/data/classes.json` — the same content the
 * server seeds its classes from. The rating is display-only until the server
 * scores it, so it renders greyed.
 *
 * Every row carries a `title`: the card is small enough that icons and bars
 * have to explain themselves on hover.
 */
export class PlayerStatusCard {
  private readonly root: HTMLElement;
  private revealed = false;
  private revealTimer: number | null = null;
  private readonly name: HTMLElement;
  private readonly rank: HTMLElement;
  private readonly level: HTMLElement;
  private readonly hpRow: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly hpBar: ReturnType<typeof createProgressBar>;
  private readonly resourceRow: HTMLElement;
  private readonly resourceBar: ReturnType<typeof createProgressBar>;
  private readonly resourceText: HTMLElement;
  private readonly ratingRow: HTMLElement;
  private readonly ratingSlots: HTMLElement[] = [];
  private hp = 0;
  private maxHp = 0;
  private resource = 0;
  private maxResource = 0;
  private resourceName = "";
  private rating = 0;
  private stamps = 0;
  private flashTimer: number | null = null;
  private ratingFlashTimer: number | null = null;

  constructor() {
    const panel = createPanel({ className: "player-card", leaf: true });
    this.root = panel.root;
    this.root.id = "player-hp";

    const portrait = createAvatar("🐾");
    portrait.classList.add("player-card__portrait");
    portrait.title = "Your courier";

    const details = document.createElement("div");
    details.className = "player-card__details";

    const identity = document.createElement("div");
    identity.className = "player-card__identity";
    this.name = document.createElement("strong");
    this.name.className = "player-card__name";
    this.name.title = "Courier name";
    this.rank = document.createElement("span");
    this.rank.className = "player-card__rank";
    this.level = document.createElement("span");
    this.level.className = "player-card__level";
    this.level.title = "Courier level";
    // Rank and level share the right-hand slot: the card is too narrow for both
    // side by side, and rank is only populated for named ranks.
    identity.append(this.name, this.rank, this.level);

    const health = document.createElement("div");
    this.hpRow = health;
    health.className = "player-card__bar player-card__bar--hp";
    const heart = createIcon("heart", { size: 12, className: "player-card__heart" });
    this.hpBar = createProgressBar(0);
    this.hpText = document.createElement("span");
    this.hpText.className = "player-card__bar-value";
    this.hpText.textContent = "–";
    this.hpBar.root.appendChild(this.hpText);
    health.append(heart, this.hpBar.root);

    this.resourceRow = document.createElement("div");
    this.resourceRow.className = "player-card__bar player-card__bar--resource";
    const droplet = createIcon("droplet", {
      size: 12,
      className: "player-card__resource-icon",
    });
    this.resourceBar = createProgressBar(0);
    this.resourceText = document.createElement("span");
    this.resourceText.className = "player-card__bar-value";
    this.resourceText.textContent = "–";
    this.resourceBar.root.appendChild(this.resourceText);
    this.resourceRow.append(droplet, this.resourceBar.root);

    this.ratingRow = document.createElement("div");
    this.ratingRow.className = "player-card__rating";
    for (let slot = 0; slot < STAMP_RATING_SLOTS; slot += 1) {
      const glyph = document.createElement("span");
      glyph.className = "player-card__stamp";
      glyph.appendChild(createIcon("stamp", { size: 11 }));
      this.ratingSlots.push(glyph);
      this.ratingRow.appendChild(glyph);
    }

    details.append(identity, health, this.resourceRow, this.ratingRow);
    panel.body.appendChild(portrait);
    panel.body.appendChild(details);
    // body is a column; make the card a row via the player-card class.
    panel.body.style.flexDirection = "row";
    panel.body.style.alignItems = "center";
    hudLayer()?.appendChild(this.root);
    // Hidden at mount: the card is created at auth time, while the boot and
    // preloader screens are still on screen. NetworkSystem.revealStatusCard()
    // shows it once the Overworld scene has attached.
    this.root.classList.add("player-card--hidden");
    this.renderHp();
    this.renderResource();
    this.renderRating();
  }

  /** Server-confirmed identity + economy state (profile/quest snapshots). */
  setStatus(data: Partial<PlayerStatusData>): void {
    if (data.name !== undefined) {
      this.name.textContent = data.name;
      this.name.title = `${data.name} — courier name`;
    }
    if (data.rank !== undefined) {
      this.rank.textContent = data.rank;
      this.rank.title = `Courier rank ${data.rank}`;
    }
    if (data.stamps !== undefined) {
      this.stamps = data.stamps;
      this.renderRating();
    }
    if (data.level !== undefined) {
      this.level.textContent = `Lv. ${data.level}`;
      this.level.title = `Courier level ${data.level}`;
    }
    if (data.hp !== undefined) this.hp = data.hp;
    if (data.maxHp !== undefined) this.maxHp = data.maxHp;
    this.renderHp();
  }

  /** Set the player's HP (from the server on join / defeat / combat). */
  setHp(hp: number, maxHp: number): void {
    this.hp = hp;
    this.maxHp = maxHp;
    this.renderHp();
  }

  /**
   * Adopt the class's primary resource — its identity and ceiling, not a live
   * value. Called once from the courier's class.
   */
  setResourceKind(resource: ClassResource): void {
    this.resourceName = resource.label;
    this.maxResource = resource.max;
    this.resource = resource.max;
    this.resourceRow.classList.add(`player-card__bar--${resource.kind}`);
    this.resourceBar.root.classList.add(`player-card__bar-track--${resource.kind}`);
    this.renderResource();
  }

  /**
   * Set the current resource (a server value, once combat spends it). Until
   * then the bar sits at full, which is the steady state for a resource nothing
   * spends: basic attacks are free by design and abilities are not built.
   */
  setResource(current: number, max: number): void {
    this.resource = current;
    this.maxResource = max;
    this.renderResource();
  }

  /** How many of the five rating stamps the courier has earned. */
  setStampRating(earned: number): void {
    this.rating = Math.max(0, Math.min(STAMP_RATING_SLOTS, earned));
    this.renderRating();
  }

  /**
   * Level-up / promotion flash: the card pulses and the level chip pops to the
   * new value, so the moment is visible in the corner a player is already
   * looking at — not only in the banner.
   */
  flashProgression(options: { level: number; rank?: string | null }): void {
    this.level.textContent = `Lv. ${options.level}`;
    this.level.title = `Courier level ${options.level}`;
    if (typeof options.rank === "string" && options.rank !== "") {
      this.rank.textContent = options.rank;
      this.rank.title = `Courier rank ${options.rank}`;
    }
    this.root.classList.add("player-card--celebrate");
    this.level.classList.add("player-card__level--gain");
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = null;
      this.root.classList.remove("player-card--celebrate");
      this.level.classList.remove("player-card__level--gain");
    }, FLASH_MS);
  }

  /** Flash the stamp rating row when a delivery pays out stamps. */
  flashStamps(): void {
    this.ratingRow.classList.add("player-card__rating--gain");
    if (this.ratingFlashTimer !== null) window.clearTimeout(this.ratingFlashTimer);
    this.ratingFlashTimer = window.setTimeout(() => {
      this.ratingFlashTimer = null;
      this.ratingRow.classList.remove("player-card__rating--gain");
    }, RATING_FLASH_MS);
  }

  destroy(): void {
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
    if (this.ratingFlashTimer !== null) window.clearTimeout(this.ratingFlashTimer);
    if (this.revealTimer !== null) window.clearTimeout(this.revealTimer);
    this.root.remove();
  }

  /**
   * Reveal the card over the live world. The card mounts hidden — the auth
   * flow constructs it while the boot/preloader screens are still up — and
   * stays hidden until the Overworld scene attaches, so it never floats over
   * loading screens or a green placeholder canvas.
   *
   * Idempotent: scene restarts call this again and must not replay the
   * transition. The class is removed after the transition so the celebrate
   * animation can always run from a settled state.
   */
  reveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    if (this.revealTimer !== null) window.clearTimeout(this.revealTimer);
    this.root.classList.remove("player-card--hidden");
    this.root.classList.add("player-card--reveal");
    this.revealTimer = window.setTimeout(() => {
      this.revealTimer = null;
      this.root.classList.remove("player-card--reveal");
    }, REVEAL_TRANSITION_MS);
  }

  private renderHp(): void {
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    this.hpBar.setRatio(ratio, `Health ${this.hp} of ${this.maxHp}`);
    this.hpText.textContent = this.maxHp > 0 ? `${this.hp} / ${this.maxHp}` : "–";
    this.hpRow.title = `Health — ${this.hp} of ${this.maxHp}`;
  }

  private renderResource(): void {
    const ratio = this.maxResource > 0 ? this.resource / this.maxResource : 0;
    const label = this.resourceName === "" ? "Class resource" : this.resourceName;
    this.resourceBar.setRatio(ratio, `${label} ${this.resource} of ${this.maxResource}`);
    this.resourceText.textContent =
      this.maxResource > 0 ? `${this.resource} / ${this.maxResource}` : "–";
    this.resourceRow.title = `${label} — refills over time and is spent by abilities (${this.resource} of ${this.maxResource})`;
    this.resourceRow.dataset.resource = label.toLowerCase();
  }

  private renderRating(): void {
    for (let slot = 0; slot < this.ratingSlots.length; slot += 1) {
      this.ratingSlots[slot]!.classList.toggle("player-card__stamp--earned", slot < this.rating);
    }
    this.ratingRow.title = `Courier rating — ${this.rating} of ${STAMP_RATING_SLOTS} stamps earned · stamps held: ${this.stamps.toLocaleString()}`;
  }
}
