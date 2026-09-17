import { createIcon } from "./hud/icons.ts";

/**
 * HUD v4 top navigation strip (70–76px): paw medallion + brand, floating
 * zone capsule, account cluster. Extracted from index.html so the bar is a
 * component; the fake Day/clock was dropped (no day system exists server-side).
 */
export class TopBar {
  private readonly zoneLabel: HTMLElement;

  constructor() {
    const existing = document.getElementById("top-navbar");
    if (existing !== null) existing.remove();

    const bar = document.createElement("header");
    bar.id = "top-navbar";
    bar.className = "top-navbar";

    // Left — paw medallion + brand copy.
    const brand = document.createElement("a");
    brand.className = "top-navbar__brand";
    brand.href = "/";
    const paw = document.createElement("span");
    paw.className = "top-navbar__paw";
    paw.setAttribute("aria-hidden", "true");
    paw.appendChild(createIcon("leaf", { size: 18 }));
    const copy = document.createElement("span");
    copy.className = "top-navbar__brand-copy";
    const name = document.createElement("strong");
    name.textContent = "Paws & Parcels";
    const tagline = document.createElement("small");
    tagline.textContent = "SMALL DELIVERIES · BRIGHTER DAYS";
    copy.append(name, tagline);
    brand.append(paw, copy);

    // Center — floating cream capsule with the current zone.
    const world = document.createElement("div");
    world.className = "top-navbar__world";
    world.setAttribute("aria-label", "Current zone");
    const sun = createIcon("sun", { size: 15, className: "top-navbar__sun" });
    this.zoneLabel = document.createElement("span");
    this.zoneLabel.className = "top-navbar__zone";
    this.zoneLabel.textContent = "Clover Village";
    world.append(sun, this.zoneLabel);

    // Right — account cluster (populated by main.ts, same element ids).
    const account = document.createElement("div");
    account.className = "top-navbar__account";
    const avatar = document.createElement("span");
    avatar.className = "top-navbar__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "🐶";
    const accountButton = document.createElement("button");
    accountButton.id = "navbar-account";
    accountButton.type = "button";
    accountButton.hidden = true;
    accountButton.setAttribute("aria-haspopup", "menu");
    accountButton.setAttribute("aria-expanded", "false");
    const accountMenu = document.createElement("div");
    accountMenu.id = "navbar-account-menu";
    accountMenu.className = "navbar-account-menu";
    accountMenu.hidden = true;
    accountMenu.setAttribute("role", "menu");
    const signOut = document.createElement("button");
    signOut.id = "navbar-sign-out";
    signOut.type = "button";
    signOut.hidden = true;
    signOut.className = "top-navbar__sign-out";
    signOut.textContent = "Sign out";
    account.append(avatar, accountButton, accountMenu, signOut);

    bar.append(brand, world, account);
    document.body.prepend(bar);
  }

  /** Reflect the zone the courier is currently in. */
  setZone(zoneName: string): void {
    this.zoneLabel.textContent = zoneName;
  }}
