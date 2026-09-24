import { BLOCKING_SURFACES, isTextField, matchesKey } from "../systems/keybindings.ts";

export interface HudModalOptions {
  className: string;
  eyebrow: string;
  title: string;
  /** Binding id (keybindings.ts) that toggles the dialog, if any. */
  toggleKey?: string;
  /** Called just before the dialog is shown, to render fresh content. */
  onOpen?: () => void;
}

/** Shared dialog shell for the quest log, keyboard help and settings: backdrop, card, Escape, focus return. */
export class HudModal {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly options: HudModalOptions) {
    const root = document.createElement("section");
    root.className = `hud-modal ${options.className}`;
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", options.title);

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "hud-modal__backdrop";
    backdrop.tabIndex = -1;
    backdrop.setAttribute("aria-label", `Close ${options.title.toLowerCase()}`);
    backdrop.addEventListener("click", () => this.close());

    const card = document.createElement("article");
    card.className = "hud-modal__card";
    const header = document.createElement("header");
    header.className = "hud-modal__header";
    const heading = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.className = "hud-modal__eyebrow";
    eyebrow.textContent = options.eyebrow;
    const title = document.createElement("h2");
    title.className = "hud-modal__title";
    title.textContent = options.title;
    heading.append(eyebrow, title);
    this.closeButton = document.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.className = "hud-modal__close";
    this.closeButton.textContent = "×";
    this.closeButton.setAttribute("aria-label", `Close ${options.title.toLowerCase()}`);
    this.closeButton.addEventListener("click", () => this.close());
    header.append(heading, this.closeButton);

    this.body = document.createElement("div");
    this.body.className = "hud-modal__body";
    card.append(header, this.body);
    root.append(backdrop, card);
    document.getElementById("hud-overlays")?.appendChild(root);
    this.root = root;
    document.addEventListener("keydown", this.handleKeyDown, true);
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Show the dialog unless dialogue, the desk or another panel is already up; returns whether it opened. */
  open(): boolean {
    if (this.isOpen()) return true;
    if (document.querySelector(BLOCKING_SURFACES) !== null) return false;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.options.onOpen?.();
    this.root.hidden = false;
    this.closeButton.focus();
    return true;
  }

  close(): void {
    if (!this.isOpen()) return;
    this.root.hidden = true;
    if (this.returnFocus?.isConnected === true) this.returnFocus.focus();
    this.returnFocus = null;
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  destroy(): void {
    document.removeEventListener("keydown", this.handleKeyDown, true);
    this.root.remove();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const toggleKey = this.options.toggleKey;
    const toggles =
      toggleKey !== undefined &&
      matchesKey(event, toggleKey) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !isTextField(event.target);
    if (this.isOpen()) {
      // Capture phase: close only this dialog, not a panel underneath it.
      if (event.key !== "Escape" && !toggles) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (toggles && this.open()) event.preventDefault();
  };
}
