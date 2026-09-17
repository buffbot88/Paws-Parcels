import { createAvatar, createPanel, createProgressBar } from "./hud/primitives.ts";
import { createIcon } from "./hud/icons.ts";

export interface PlayerStatusData {
  name: string;
  rank: string;
  hp: number;
  maxHp: number;
  stamps: number;
  level: number;
}

/**
 * HUD v4 player card (top-left, ~420×138): portrait, animated HP bar, and
 * real Stamps + level wired from server snapshots (spec §6).
 */
export class PlayerStatusCard {
  private readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly rank: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly hpBar: ReturnType<typeof createProgressBar>;
  private readonly stamps: HTMLElement;
  private readonly level: HTMLElement;
  private hp = 0;
  private maxHp = 0;

  constructor() {
    const panel = createPanel({ className: "player-card", leaf: true });
    this.root = panel.root;
    this.root.id = "player-hp";

    const portrait = createAvatar("🐾");
    portrait.classList.add("player-card__portrait");

    const details = document.createElement("div");
    details.className = "player-card__details";

    const identity = document.createElement("div");
    identity.className = "player-card__identity";
    this.name = document.createElement("strong");
    this.name.className = "player-card__name";
    this.rank = document.createElement("span");
    this.rank.className = "player-card__rank";
    identity.append(this.name, this.rank);

    const health = document.createElement("div");
    health.className = "player-card__health";
    const heart = createIcon("heart", { size: 13, className: "player-card__heart" });
    this.hpBar = createProgressBar(0);
    this.hpText = document.createElement("span");
    this.hpText.className = "player-card__hp-text";
    this.hpText.textContent = "–";
    health.append(heart, this.hpBar.root, this.hpText);

    const stats = document.createElement("div");
    stats.className = "player-card__stats";
    const stampsCell = document.createElement("span");
    stampsCell.className = "player-card__stat";
    const stampsIcon = createIcon("coins", { size: 13 });
    const stampsValue = document.createElement("b");
    stampsValue.textContent = "0";
    stampsCell.append(stampsIcon, stampsValue);
    const levelCell = document.createElement("span");
    levelCell.className = "player-card__stat";
    const levelIcon = createIcon("sparkles", { size: 13 });
    const levelValue = document.createElement("b");
    levelValue.textContent = "Lv. 1";
    levelCell.append(levelIcon, levelValue);
    this.stamps = stampsValue;
    this.level = levelValue;

    stats.append(stampsCell, levelCell);
    details.append(identity, health, stats);
    panel.body.appendChild(portrait);
    panel.body.appendChild(details);
    // body is a column; make the card a row via the player-card class.
    panel.body.style.flexDirection = "row";
    panel.body.style.alignItems = "center";
    document.getElementById("game-container")?.appendChild(this.root);
    this.renderHp();
  }

  /** Server-confirmed identity + economy state (profile/quest snapshots). */
  setStatus(data: Partial<PlayerStatusData>): void {
    if (data.name !== undefined) this.name.textContent = data.name;
    if (data.rank !== undefined) this.rank.textContent = data.rank;
    if (data.stamps !== undefined) this.stamps.textContent = data.stamps.toLocaleString();
    if (data.level !== undefined) this.level.textContent = `Lv. ${data.level}`;
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

  destroy(): void {
    this.root.remove();
  }

  private renderHp(): void {
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    this.hpBar.setRatio(ratio, `Health ${this.hp} of ${this.maxHp}`);
    this.hpText.textContent = this.maxHp > 0 ? `${this.hp} / ${this.maxHp}` : "–";
  }
}
