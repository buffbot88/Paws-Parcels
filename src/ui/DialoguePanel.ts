export interface DialogueRequest {
  speaker: string;
  lines: string[];
}

/**
 * DOM-over-Canvas dialogue panel (BuildPlan: all menus/dialogue live in
 * HTML/CSS). Renders one line at a time; advances on click/tap or Enter,
 * and E/Space are fed in by the OverworldScene (single owner of those keys).
 * Esc closes early. Focus moves into the panel on open and back out on close
 * so keyboard navigation stays usable.
 */
export class DialoguePanel {
  private readonly root: HTMLDivElement;
  private readonly speakerEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly closeBtn: HTMLButtonElement;

  private lines: string[] = [];
  private index = 0;
  private onClose: (() => void) | null = null;
  private isOpenState = false;

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
    this.lines = request.lines;
    this.index = 0;
    this.onClose = onClose;
    this.isOpenState = true;
    this.root.classList.remove("hidden");
    this.renderLine();
    // Move keyboard focus into the panel (restored on close).
    this.root.focus();
    return true;
  }

  /** Advances to the next line, or closes after the final one. */
  advance(): void {
    if (!this.isOpenState) return;
    if (this.index < this.lines.length - 1) {
      this.index += 1;
      this.renderLine();
    } else {
      this.close();
    }
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
    const canvas = document.querySelector("#game-container canvas");
    if (canvas instanceof HTMLElement) canvas.focus();
  }

  isOpen(): boolean {
    return this.isOpenState;
  }

  private renderLine(): void {
    this.textEl.textContent = this.lines[this.index];
    const isLast = this.index === this.lines.length - 1;
    this.hintEl.textContent = isLast ? "Click / tap / Enter to close" : "Click / tap / Enter to continue";
  }
}
