import { createIcon } from "./hud/icons.ts";
import type { AuthFinishDetail } from "./LoginOverlay.ts";

type Account = AuthFinishDetail["account"];

/** HUD navigation strip with account-menu listener ownership. */
export class TopBar {
  private readonly zoneLabel: HTMLElement;
  private readonly accountButton: HTMLButtonElement;
  private readonly accountMenu: HTMLElement;
  private readonly signOutButton: HTMLButtonElement;
  private account: Account | null = null;
  private accountMenuOpen = false;
  private readonly onSignOut: () => void;
  private readonly onAccountClick = (): void => this.toggleAccountMenu();
  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (target !== null && (this.accountButton.contains(target) || this.accountMenu.contains(target))) return;
    this.closeAccountMenu();
  };
  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.closeAccountMenu();
  };

  constructor(options: { onSignOut: () => void }) {
    this.onSignOut = options.onSignOut;
    const existing = document.getElementById("top-navbar");
    if (existing !== null) existing.remove();

    const bar = document.createElement("header");
    bar.id = "top-navbar";
    bar.className = "top-navbar";

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

    const world = document.createElement("div");
    world.className = "top-navbar__world";
    world.setAttribute("aria-label", "Current zone");
    const sun = createIcon("sun", { size: 15, className: "top-navbar__sun" });
    this.zoneLabel = document.createElement("span");
    this.zoneLabel.className = "top-navbar__zone";
    this.zoneLabel.textContent = "Clover Village";
    world.append(sun, this.zoneLabel);

    const account = document.createElement("div");
    account.className = "top-navbar__account";
    const avatar = document.createElement("span");
    avatar.className = "top-navbar__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "🐶";
    this.accountButton = document.createElement("button");
    this.accountButton.id = "navbar-account";
    this.accountButton.type = "button";
    this.accountButton.hidden = true;
    this.accountButton.setAttribute("aria-haspopup", "menu");
    this.accountButton.setAttribute("aria-expanded", "false");
    this.accountButton.addEventListener("click", this.onAccountClick);
    this.accountMenu = document.createElement("div");
    this.accountMenu.id = "navbar-account-menu";
    this.accountMenu.className = "navbar-account-menu";
    this.accountMenu.hidden = true;
    this.accountMenu.setAttribute("role", "menu");
    this.signOutButton = document.createElement("button");
    this.signOutButton.id = "navbar-sign-out";
    this.signOutButton.type = "button";
    this.signOutButton.hidden = true;
    this.signOutButton.className = "top-navbar__sign-out";
    this.signOutButton.textContent = "Sign out";
    this.signOutButton.addEventListener("click", this.onSignOut);
    account.append(avatar, this.accountButton, this.accountMenu, this.signOutButton);

    bar.append(brand, world, account);
    document.body.prepend(bar);
  }

  /** Configure the account controls without accumulating document listeners. */
  setAccount(account: Account): void {
    this.account = account;
    this.accountButton.textContent = `${account.display_name}${account.role === "Admin" ? " ▾" : ""}`;
    this.accountButton.hidden = false;
    this.signOutButton.hidden = false;
    this.accountMenu.replaceChildren();
    if (account.role === "Admin") {
      const adminLink = document.createElement("a");
      adminLink.href = "/admin.html";
      adminLink.className = "navbar-account-menu__link";
      adminLink.setAttribute("role", "menuitem");
      adminLink.textContent = "⚙ Admin Control Panel";
      adminLink.addEventListener("click", () => this.closeAccountMenu());
      this.accountMenu.appendChild(adminLink);
    }
    this.accountMenu.hidden = account.role !== "Admin";
    this.accountButton.setAttribute("aria-expanded", "false");
    this.accountButton.setAttribute("aria-haspopup", account.role === "Admin" ? "menu" : "false");
    this.closeAccountMenu();
  }

  /** Hide and clear account controls when the session ends. */
  clearAccount(): void {
    this.account = null;
    this.closeAccountMenu();
    this.accountButton.hidden = true;
    this.accountButton.textContent = "";
    this.signOutButton.hidden = true;
    this.accountMenu.replaceChildren();
  }

  /** Reflect the zone the courier is currently in. */
  setZone(zoneName: string): void {
    this.zoneLabel.textContent = zoneName;
  }

  /** Remove DOM and all listeners owned by the top bar. */
  destroy(): void {
    this.accountButton.removeEventListener("click", this.onAccountClick);
    this.signOutButton.removeEventListener("click", this.onSignOut);
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    document.removeEventListener("keydown", this.onDocumentKeyDown);
    document.getElementById("top-navbar")?.remove();
  }

  private toggleAccountMenu(): void {
    if (this.account?.role !== "Admin") return;
    if (this.accountMenuOpen) this.closeAccountMenu();
    else {
      this.accountMenuOpen = true;
      this.accountMenu.hidden = false;
      this.accountButton.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", this.onDocumentPointerDown);
      document.addEventListener("keydown", this.onDocumentKeyDown);
    }
  }

  private closeAccountMenu(): void {
    this.accountMenuOpen = false;
    this.accountMenu.hidden = true;
    this.accountButton.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    document.removeEventListener("keydown", this.onDocumentKeyDown);
  }
}
