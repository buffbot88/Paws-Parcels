import { createIcon } from "./hud/icons.ts";
import { sfx } from "../audio/sfx.ts";
import type { AuthFinishDetail, CharacterListItem } from "./LoginOverlay.ts";

type Account = AuthFinishDetail["account"];

/** Courier actions the in-game account menu exposes back to main.ts. */
export interface CourierMenuOptions {
  characters: CharacterListItem[];
  selectedId: number | null;
  onSwitch: (characterId: number) => void;
  onCreate: () => void;
  onOpenProfile: () => void;
}

/**
 * HUD navigation strip.
 *
 * The top bar owns the *only* account surface in the game: one dropdown
 * hanging off the account button that holds the courier roster and every
 * account action. Before this, a second floating "courier menu" pill rendered
 * at viewport top-left (outside the game window) and landed on top of the
 * brand — two widgets, two shapes, one set of actions.
 */
export class TopBar {
  private readonly zoneLabel: HTMLElement;
  private readonly accountLabel: HTMLElement;
  private readonly accountButton: HTMLButtonElement;
  private readonly accountMenu: HTMLElement;
  private readonly signOutButton: HTMLButtonElement;
  private account: Account | null = null;
  private couriers: CourierMenuOptions | null = null;
  private accountMenuOpen = false;
  private readonly onSignOut: () => void;
  /** Unsubscribe handles for the sound toggle's mute subscription. */
  private readonly soundListeners: (() => void)[] = [];
  private readonly onAccountClick = (): void => this.toggleAccountMenu();
  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (target !== null && (this.accountButton.contains(target) || this.accountMenu.contains(target))) return;
    this.closeMenu();
  };
  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.closeMenu();
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

    // The avatar + button + dropdown share one positioned wrapper so the menu
    // hangs off the account button itself rather than the whole account row
    // (which also holds Sign out).
    const identity = document.createElement("div");
    identity.className = "top-navbar__identity";
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
    this.accountLabel = document.createElement("span");
    this.accountLabel.className = "top-navbar__account-label";
    const caret = document.createElement("span");
    caret.className = "top-navbar__account-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "▾";
    this.accountButton.append(this.accountLabel, caret);
    this.accountMenu = document.createElement("div");
    this.accountMenu.id = "navbar-account-menu";
    this.accountMenu.className = "navbar-account-menu";
    this.accountMenu.hidden = true;
    this.accountMenu.setAttribute("role", "menu");
    this.accountMenu.setAttribute("aria-label", "Account and couriers");
    identity.append(avatar, this.accountButton, this.accountMenu);

    this.signOutButton = document.createElement("button");
    this.signOutButton.id = "navbar-sign-out";
    this.signOutButton.type = "button";
    this.signOutButton.hidden = true;
    this.signOutButton.className = "top-navbar__sign-out";
    this.signOutButton.textContent = "Sign out";
    this.signOutButton.addEventListener("click", this.onSignOut);

    const account = document.createElement("div");
    account.className = "top-navbar__account";
    account.append(identity, this.signOutButton);

    bar.append(brand, world, account, this.createSoundToggle());
    document.body.prepend(bar);
  }

  /**
   * The one sound control in the game: the HUD chime is the only audio there
   * is, so muting it needs a control that is always reachable and never covers
   * the world. State lives in the audio bus (a local preference), and the
   * button subscribes to it so it stays correct if anything else mutes.
   *
   * Icon-only by design — the speaker glyph itself reads as "sound", so the
   * label would be redundant; state carries in the on/off glyphs and the
   * desaturated muted treatment, with accessible names for screen readers.
   */
  private createSoundToggle(): HTMLElement {
    const toggle = document.createElement("button");
    toggle.id = "navbar-sound";
    toggle.type = "button";
    toggle.className = "top-navbar__sound";
    const render = (muted: boolean): void => {
      toggle.replaceChildren(createIcon(muted ? "volume-x" : "volume-2", { size: 16 }));
      toggle.title = muted ? "Sound effects are off" : "Sound effects are on";
      toggle.setAttribute("aria-pressed", String(!muted));
      toggle.setAttribute("aria-label", muted ? "Turn sound effects on" : "Turn sound effects off");
    };
    render(sfx.isMuted());
    this.soundListeners.push(sfx.subscribe(render));
    toggle.addEventListener("click", () => sfx.toggleMuted());
    return toggle;
  }

  /** Configure the account controls without accumulating document listeners. */
  setAccount(account: Account): void {
    this.account = account;
    this.accountLabel.textContent = account.display_name;
    this.accountButton.hidden = false;
    this.signOutButton.hidden = false;
    this.renderAccountMenu();
    this.closeMenu();
  }

  /** Hand the menu the courier roster and the actions those rows perform. */
  setCouriers(options: CourierMenuOptions): void {
    this.couriers = options;
    this.renderAccountMenu();
  }

  /** Hide and clear account controls when the session ends. */
  clearAccount(): void {
    this.account = null;
    this.couriers = null;
    this.closeMenu();
    this.accountButton.hidden = true;
    this.accountLabel.textContent = "";
    this.signOutButton.hidden = true;
    this.accountMenu.replaceChildren();
  }

  /** Reflect the zone the courier is currently in. */
  setZone(zoneName: string): void {
    this.zoneLabel.textContent = zoneName;
  }

  /** Dismiss the dropdown (used when a modal desk takes over the screen). */
  closeMenu(): void {
    this.accountMenuOpen = false;
    this.accountMenu.hidden = true;
    this.accountButton.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    document.removeEventListener("keydown", this.onDocumentKeyDown);
  }

  /** Remove DOM and all listeners owned by the top bar. */
  destroy(): void {
    for (const unsubscribe of this.soundListeners.splice(0)) unsubscribe();
    this.accountButton.removeEventListener("click", this.onAccountClick);
    this.signOutButton.removeEventListener("click", this.onSignOut);
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    document.removeEventListener("keydown", this.onDocumentKeyDown);
    document.getElementById("top-navbar")?.remove();
  }

  private toggleAccountMenu(): void {
    if (this.account === null) return;
    if (this.accountMenuOpen) {
      this.closeMenu();
      return;
    }
    this.accountMenuOpen = true;
    this.accountMenu.hidden = false;
    this.accountButton.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", this.onDocumentPointerDown);
    document.addEventListener("keydown", this.onDocumentKeyDown);
    this.accountMenu.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }

  /**
   * Rebuild the dropdown from the current account and roster. The panel is
   * rendered closed; `toggleAccountMenu` is the only thing that reveals it, so
   * a re-render can never leave it orphaned open.
   */
  private renderAccountMenu(): void {
    this.accountMenu.replaceChildren();
    const account = this.account;
    if (account === null) {
      this.accountMenu.hidden = true;
      return;
    }

    const header = document.createElement("p");
    header.className = "navbar-account-menu__account";
    header.textContent = `${account.display_name} · ${account.role === "Admin" ? "Admin" : "Courier"}`;
    this.accountMenu.appendChild(header);

    for (const character of this.couriers?.characters ?? []) {
      this.accountMenu.appendChild(this.courierRow(character));
    }

    if (this.couriers !== null) {
      this.accountMenu.appendChild(this.divider());
      this.accountMenu.appendChild(
        this.menuAction("◈ Character, bag & skills", () => {
          this.closeMenu();
          this.couriers?.onOpenProfile();
        }),
      );
      this.accountMenu.appendChild(
        this.menuAction("＋ Create a new courier", () => {
          this.closeMenu();
          this.couriers?.onCreate();
        }),
      );
    }

    const reportBug = document.createElement("a");
    reportBug.className = "navbar-account-menu__action navbar-account-menu__action--link";
    reportBug.setAttribute("role", "menuitem");
    reportBug.href = "https://agpstudios.org/support";
    reportBug.target = "_blank";
    reportBug.rel = "noopener noreferrer";
    reportBug.textContent = "Report bug";
    reportBug.addEventListener("click", () => this.closeMenu());
    this.accountMenu.appendChild(reportBug);

    if (account.role === "Admin") {
      const adminLink = document.createElement("a");
      adminLink.href = "/admin.html";
      adminLink.className = "navbar-account-menu__link";
      adminLink.setAttribute("role", "menuitem");
      adminLink.textContent = "⚙ Admin Control Panel";
      adminLink.addEventListener("click", () => this.closeMenu());
      this.accountMenu.appendChild(adminLink);
    }
  }

  private courierRow(character: CharacterListItem): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "navbar-account-menu__courier";
    btn.setAttribute("role", "menuitem");
    const isCurrent = character.id === this.couriers?.selectedId;
    if (isCurrent) btn.classList.add("navbar-account-menu__courier--current");
    btn.disabled = isCurrent;

    const badge = document.createElement("span");
    badge.className = "navbar-account-menu__badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = "🐾";

    const info = document.createElement("span");
    info.className = "navbar-account-menu__courier-info";

    const nameEl = document.createElement("span");
    nameEl.className = "navbar-account-menu__courier-name";
    nameEl.textContent = character.name;

    const meta = document.createElement("span");
    meta.className = "navbar-account-menu__courier-meta";
    meta.textContent = isCurrent ? "Delivering now" : `Level ${character.level} · Switch`;

    info.append(nameEl, meta);
    btn.append(badge, info);

    if (!isCurrent) {
      btn.addEventListener("click", () => {
        this.closeMenu();
        this.couriers?.onSwitch(character.id);
      });
    }
    return btn;
  }

  private menuAction(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "navbar-account-menu__action";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  private divider(): HTMLDivElement {
    const divider = document.createElement("div");
    divider.className = "navbar-account-menu__divider";
    return divider;
  }
}
