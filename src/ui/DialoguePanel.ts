export interface DialogueRequest {
  speaker: string;
  lines: string[];
  /**
   * Optional action menu revealed once the lines are read. The panel stays
   * open on the last line instead of closing, and each option hands its id
   * back through `onSelect` ("quest" | "shop" | "exit").
   */
  menu?: DialogueMenuOption[];
  onSelect?: (id: string) => void;
}

/** One conversational action a villager offers (the Quest/Shop/Exit menu). */
export interface DialogueMenuOption {
  /** Stable action id handed to the scene's handler. */
  id: string;
  label: string;
}

/**
 * DOM-over-Canvas dialogue panel (BuildPlan: all menus/dialogue live in
 * HTML/CSS). Renders one line at a time; advances on click/tap or Enter,
 * and E/Space are fed in by the OverworldScene (single owner of those keys).
 * Esc closes early. Focus moves into the panel on open and back out on close
 * so keyboard navigation stays usable.
 *
 * With a menu attached the panel becomes a tiny conversation hub: the lines
 * read out, the last line stays, and the Quest/Shop/Exit row appears under it
 * — the villager menu every conversation ends in.
 */
export class DialoguePanel {
  private readonly root: HTMLDivElement;
  private readonly speakerEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly menuEl: HTMLDivElement;
  private readonly closeBtn: HTMLButtonElement;

  private lines: string[] = [];
  private index = 0;
  private onClose: (() => void) | null = null;
  private isOpenState = false;
  private menuOptions: DialogueMenuOption[] = [];
  private menuShown = false;
  private onSelect: ((id: string) => void) | null = null;

  /** The overlay this panel mounts into; created once by index.html. */
  private static readonly OVERLAY_ID = "ui-overlay";

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "dialogue-panel hidden";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-live", "polite");
    this.root.tabIndex = -1;

    this.speakerEl = document.createElement("div");
    this.speakerEl.className = "dialogue-speaker";
    this.root.appendChild(this.speakerEl);

    this.textEl = document.createElement("div");
    this.textEl.className = "dialogue-text";
    this.root.appendChild(this.textEl);

    this.hintEl = document.createElement("div");
    this.hintEl.className = "dialogue-hint";
    this.root.appendChild(this.hintEl);

    this.menuEl = document.createElement("div");
    this.menuEl.className = "dialogue-menu";
    this.menuEl.hidden = true;
    this.root.appendChild(this.menuEl);

    this.closeBtn = document.createElement("button");
    this.closeBtn.className = "dialogue-close";
    this.closeBtn.setAttribute("aria-label", "Close dialogue");
    this.closeBtn.textContent = "✕";
    this.root.appendChild(this.closeBtn);

    const overlay = document.getElementById(DialoguePanel.OVERLAY_ID);
    if (!overlay) {
      console.error(`DialoguePanel: #${DialoguePanel.OVERLAY_ID} not found in index.html`);
      return;
    }
    overlay.appendChild(this.root);

    this.root.addEventListener("click", () => this.advance());
    this.closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close();
    });
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.advance();
      if (e.key === "Escape") this.close();
    });
  }

  /** Opens the panel with the given speaker/lines. Returns false if already open. */
  open(request: DialogueRequest, onClose: () => void): boolean {
    if (this.isOpenState) return false;
    this.speakerEl.textContent = request.speaker;
    // Own copy: setIntroLine() edits lines in place, and callers pass shared JSON.
    this.lines = [...request.lines];
    this.index = 0;
    this.onClose = onClose;
    this.isOpenState = true;
    this.menuOptions = request.menu ?? [];
    this.onSelect = request.onSelect ?? null;
    this.root.classList.remove("hidden");
    this.renderLine();
    // Move keyboard focus into the panel (restored on close).
    this.root.focus();
    return true;
  }

  /**
   * Replace the conversation while the panel is open — the menu's follow-up
   * beat (a shop answer, a nothing-to-deliver notice) or the quest milestone
   * that lands while the villager is still on screen. No-op when closed.
   */
  present(request: DialogueRequest): boolean {
    if (!this.isOpenState) return false;
    this.speakerEl.textContent = request.speaker;
    this.lines = [...request.lines];
    this.index = 0;
    this.menuOptions = request.menu ?? [];
    this.onSelect = request.onSelect ?? null;
    this.renderLine();
    return true;
  }

  /**
   * Swap the intro line in place while the reader is still on it — the AI
   * line arrives after the panel opens (the canned intro is the fallback that
   * must never block). Once the reader has advanced, the moment has passed.
   */
  setIntroLine(line: string): void {
    if (!this.isOpenState || line.trim() === "") return;
    if (this.index !== 0 || this.lines.length === 0) return;
    this.lines[0] = line;
    this.renderLine();
  }

  /** Advances to the next line, or rests on the menu after the final one. */
  advance(): void {
    if (!this.isOpenState) return;
    if (this.index < this.lines.length - 1) {
      this.index += 1;
      this.renderLine();
      return;
    }
    // With a menu attached the last line is the resting state — the panel is
    // closed by choosing Exit (or any action that closes it), not by clicking
    // through it.
    if (this.menuOptions.length === 0) this.close();
  }

  /** Closes the panel and notifies the scene. */
  close(): void {
    if (!this.isOpenState) return;
    this.isOpenState = false;
    this.root.classList.add("hidden");
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
    // Return focus to the game canvas so keyboard navigation resumes there.
    // Direct child, not a descendant: the HUD layer holds the minimap's own
    // canvas earlier in the DOM, and focusing that would silently swallow the
    // keyboard focus the player expects back on the world. Duck-typed focus:
    // the panel also runs in test DOMs without HTMLElement.
    const canvas = document.querySelector("#game-container > canvas");
    if (canvas !== null && typeof (canvas as HTMLElement).focus === "function") {
      (canvas as HTMLElement).focus();
    }
  }

  isOpen(): boolean {
    return this.isOpenState;
  }

  private renderLine(): void {
    this.textEl.textContent = this.lines[this.index];
    const isLast = this.index === this.lines.length - 1;
    const withMenu = isLast && this.menuOptions.length > 0;
    if (withMenu) {
      this.hintEl.textContent = "Choose an option";
    } else {
      this.hintEl.textContent = isLast
        ? "Click / tap / Enter to close"
        : "Click / tap / Enter to continue";
    }
    this.renderMenu(withMenu);
  }

  /**
   * Rebuild the action row. Focused on arrival (and kept focused across
   * re-renders, e.g. when the AI intro line swaps in) so Enter picks an option.
   */
  private renderMenu(show: boolean): void {
    const heldFocus = this.menuEl.contains(document.activeElement);
    const becameVisible = show && !this.menuShown;
    this.menuShown = show;
    if (!show) {
      this.menuEl.replaceChildren();
      this.menuEl.hidden = true;
      return;
    }
    this.menuEl.replaceChildren();
    for (const option of this.menuOptions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dialogue-option";
      button.textContent = option.label;
      button.addEventListener("click", (event) => {
        // A menu choice is not "advance the dialogue".
        event.stopPropagation();
        this.onSelect?.(option.id);
      });
      this.menuEl.appendChild(button);
    }
    this.menuEl.hidden = false;
    if (becameVisible || heldFocus) {
      // Duck-typed focus: the panel also runs in test DOMs without HTMLElement.
      const first = this.menuEl.firstElementChild;
      if (first !== null && typeof (first as HTMLElement).focus === "function") {
        (first as HTMLElement).focus();
      }
    }
  }
}
