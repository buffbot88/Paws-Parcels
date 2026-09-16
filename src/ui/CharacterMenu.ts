import type { CharacterListItem } from "./LoginOverlay.ts";

/** Callbacks the HUD menu wires back to main.ts. */
export interface CharacterMenuOptions {
  account: { id: number; username: string; display_name: string; role: string };
  characters: CharacterListItem[];
  selectedId: number | null;
  onSwitch: (characterId: number) => void;
  onCreate: () => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
}

/**
 * In-game courier HUD: a small top-left button that opens a popover to switch
 * couriers, create a new one, or sign out. DOM-over-Canvas like the status chip.
 */
export class CharacterMenu {
  private root: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;
  private panel: HTMLElement | null = null;
  private opts: CharacterMenuOptions | null = null;
  private isOpen = false;

  /** Show the button for the current session. */
  mount(opts: CharacterMenuOptions): void {
    this.opts = opts;
    this.ensureRoot();
    this.render();
  }

  /** Remove the button (game teardown). */
  unmount(): void {
    document.removeEventListener("pointerdown", this.handleOutsideClick);
    this.root?.remove();
    this.root = null;
    this.button = null;
    this.panel = null;
    this.opts = null;
    this.isOpen = false;
  }

  private ensureRoot(): void {
    if (this.root !== null) return;
    const root = document.createElement("div");
    root.className = "character-menu";
    document.getElementById("hud-overlays")?.appendChild(root);
    if (this.root === null) this.root = root;
    this.root = root;
  }

  private render(): void {
    const root = this.root;
    if (root === null) return;
    root.textContent = "";
    this.button = null;
    this.panel = null;
    this.isOpen = false;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-menu__button";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Courier menu");

    const paw = document.createElement("span");
    paw.className = "character-menu__paw";
    paw.setAttribute("aria-hidden", "true");
    paw.textContent = "🐾";

    const name = document.createElement("span");
    name.className = "character-menu__name";
    name.textContent = this.currentCharacter()?.name ?? "Courier";

    const caret = document.createElement("span");
    caret.className = "character-menu__caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "▾";

    button.append(paw, name, caret);
    button.addEventListener("click", () => this.toggle());
    root.appendChild(button);
    this.button = button;

    const panel = document.createElement("div");
    panel.className = "character-menu__panel";
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", "Courier actions");
    panel.setAttribute("hidden", "");
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
    });
    root.appendChild(panel);
    this.panel = panel;

    const header = document.createElement("p");
    header.className = "character-menu__account";
    header.textContent = this.opts?.account?.display_name ?? "";
    panel.appendChild(header);

    for (const character of this.opts?.characters ?? []) {
      panel.appendChild(this.courierRow(character));
    }

    const profile = document.createElement("button");
    profile.type = "button";
    profile.className = "character-menu__action";
    profile.textContent = "◈ Character, bag & skills";
    profile.addEventListener("click", () => {
      this.close();
      this.opts?.onOpenProfile();
    });
    panel.appendChild(profile);

    const divider = document.createElement("div");
    divider.className = "character-menu__divider";
    panel.appendChild(divider);

    const create = document.createElement("button");
    create.type = "button";
    create.className = "character-menu__action";
    create.textContent = "＋ Create a new courier";
    create.addEventListener("click", () => {
      this.close();
      this.opts?.onCreate();
    });
    panel.appendChild(create);

    const reportBug = document.createElement("a");
    reportBug.className = "character-menu__action character-menu__action--link";
    reportBug.setAttribute("role", "menuitem");
    reportBug.href = "https://agpstudios.org/support";
    reportBug.target = "_blank";
    reportBug.rel = "noopener noreferrer";
    reportBug.textContent = "Report bug";
    reportBug.addEventListener("click", () => this.close());
    panel.appendChild(reportBug);

    const signOut = document.createElement("button");
    signOut.type = "button";
    signOut.className = "character-menu__action character-menu__action--danger";
    signOut.textContent = "Sign out";
    signOut.addEventListener("click", () => {
      this.close();
      this.opts?.onSignOut();
    });
    panel.appendChild(signOut);
  }

  private courierRow(character: CharacterListItem): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "character-menu__courier";
    btn.setAttribute("role", "menuitem");
    const isCurrent = character.id === this.opts?.selectedId;
    if (isCurrent) btn.classList.add("character-menu__courier--current");
    btn.disabled = isCurrent;

    const badge = document.createElement("span");
    badge.className = "character-menu__badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = "🐾";

    const info = document.createElement("span");
    info.className = "character-menu__courier-info";

    const nameEl = document.createElement("span");
    nameEl.className = "character-menu__courier-name";
    nameEl.textContent = character.name;

    const meta = document.createElement("span");
    meta.className = "character-menu__courier-meta";
    meta.textContent = isCurrent
      ? "Delivering now"
      : `Level ${character.level} · Switch`;

    info.append(nameEl, meta);
    btn.append(badge, info);

    if (!isCurrent) {
      btn.addEventListener("click", () => {
        this.close();
        this.opts?.onSwitch(character.id);
      });
    }
    return btn;
  }

  private currentCharacter(): CharacterListItem | undefined {
    return (
      this.opts?.characters.find((c) => c.id === this.opts?.selectedId) ??
      this.opts?.characters[0]
    );
  }

  private toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private open(): void {
    const panel = this.panel;
    const button = this.button;
    if (panel === null || button === null) return;
    this.isOpen = true;
    panel.removeAttribute("hidden");
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", this.handleOutsideClick);
    const firstItem = panel.querySelector<HTMLButtonElement>("[role=menuitem]");
    (firstItem ?? panel).focus();
  }

  private close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel?.setAttribute("hidden", "");
    this.button?.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.handleOutsideClick);
    this.button?.focus();
  }

  /** Clicking anywhere outside the popover dismisses it. */
  private handleOutsideClick = (event: PointerEvent): void => {
    const root = this.root;
    if (root === null) return;
    const target = event.target as Node | null;
    if (target !== null && root.contains(target)) return;
    this.close();
  };
}
