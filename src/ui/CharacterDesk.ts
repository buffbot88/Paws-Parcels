/**
 * Phase 2 client hookup — the courier desk (DOM-over-Canvas): select or
 * create a courier before Phaser boots. Built with createElement/textContent
 * so server data can never inject markup.
 */
import {
  clearAuthStorage,
  type AuthFinishDetail,
  type CharacterListItem,
} from "./LoginOverlay.ts";
import { deskStepFor, validateCharacterName } from "./characterFlow.ts";

/** Shape of GET /api/classes entries (server/src/models/CharacterClass.ts). */
export interface ClassOption {
  id: number;
  key: string;
  display_name: string;
  animal: string;
  role: string;
  primary_resource: string;
  resource_max: number;
  resource_regen_per_sec: number;
  base_stats: Record<string, number>;
  description: string | null;
}

/** When the player finished choosing/creating — hands the boot list over. */
export type DeskPlayHandler = (
  characters: CharacterListItem[],
  selectedId: number,
) => void;

/** Options for CharacterDesk.show(). */
export interface CharacterDeskShowOptions {
  /** Open straight into the creation form (in-game "create a courier"). */
  forceCreate?: boolean;
}

/** Placeholder animal faces until the Phase 7 art lands. */
const ANIMAL_EMOJI: Readonly<Record<string, string>> = {
  bear: "🐻",
  cat: "🐱",
  fox: "🦊",
  bunny: "🐰",
  mouse: "🐭",
};

const CLASS_EMOJI_FALLBACK = "🐾";

const LEAF_SVG =
  '<svg class="desk-card__leaf" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6 C 18 12, 14 22, 14 36 C 14 50, 22 58, 32 58 C 42 58, 50 50, 50 36 C 50 22, 46 12, 32 6 Z M 32 10 L 32 56" stroke="#3a5a3a" stroke-width="1.6" fill="rgba(143, 201, 138, 0.55)" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Character creation + select desk. One instance is created by main.ts and
 * reused across boot flows.
 */
export class CharacterDesk {
  private root: HTMLElement | null = null;
  private detail: AuthFinishDetail | null = null;
  private characters: CharacterListItem[] = [];
  private classes: ClassOption[] | null = null;
  private classesFailed = false;
  private selectedClassId: number | null = null;
  private onPlay: DeskPlayHandler | null = null;
  private forceCreate = false;

  /** Show the desk for an authenticated account. */
  show(
    detail: AuthFinishDetail,
    onPlay: DeskPlayHandler,
    opts?: CharacterDeskShowOptions,
  ): void {
    this.detail = detail;
    this.characters = [...detail.characters];
    this.selectedClassId = null;
    this.forceCreate = opts?.forceCreate ?? false;
    this.onPlay = onPlay;
    this.ensureRoot();
    if (this.root) {
      this.root.removeAttribute("hidden");
      this.root.classList.add("character-desk--visible");
    }
    // Warm the class catalog in the background; render() refreshes when ready.
    void this.ensureClasses();
    this.render();
  }

  /** Remove the desk (the game is booting). */
  hide(): void {
    if (this.root === null) return;
    this.root.setAttribute("hidden", "");
    this.root.classList.remove("character-desk--visible");
  }

  // ------------------------------------------------------------- rendering

  private ensureRoot(): void {
    if (this.root !== null) return;
    const root = document.createElement("div");
    root.id = "character-desk";
    root.className = "character-desk";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "desk-title");
    root.setAttribute("hidden", "");
    document.getElementById("game-container")?.appendChild(root);
    this.root = root;
  }

  private render(): void {
    const root = this.root;
    if (root === null) return;
    const step = deskStepFor(this.characters.length).step;
    root.textContent = "";
    if (step === "create" || this.forceCreate) {
      this.renderCreate(root);
    } else if (step === "play") {
      // Safety net (main.ts routes single-character accounts itself): if the
      // desk is ever asked to show with exactly one courier, just play them.
      const only = this.characters[0];
      if (only !== undefined) {
        this.onPlay?.(this.characters, only.id);
        this.hide();
      }
    } else {
      this.renderSelect(root);
    }
  }

  /** Force the create form regardless of character count (from select view). */
  private showCreateView(): void {
    this.forceCreate = true;
    const root = this.root;
    if (root === null) return;
    root.textContent = "";
    this.renderCreate(root);
  }

  private renderSelect(root: HTMLElement): void {
    const backdrop = document.createElement("div");
    backdrop.className = "character-desk__backdrop";

    const card = document.createElement("article");
    card.className = "desk-card";
    card.insertAdjacentHTML("afterbegin", LEAF_SVG);

    const title = document.createElement("h1");
    title.id = "desk-title";
    title.className = "desk-card__title";
    title.textContent = "Choose your courier";

    const subtitle = document.createElement("p");
    subtitle.className = "desk-card__tagline";
    const accountName = this.detail?.account?.display_name ?? "courier";
    subtitle.textContent = `Welcome back, ${accountName}. Who's delivering today?`;

    const list = document.createElement("div");
    list.className = "desk-list";
    for (const character of this.characters) {
      list.appendChild(this.characterOption(character));
    }

    const actions = document.createElement("div");
    actions.className = "desk-actions";

    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "desk-btn desk-btn--ghost";
    createBtn.textContent = "＋ Create a new courier";
    createBtn.addEventListener("click", () => this.showCreateView());

    const signOutBtn = document.createElement("button");
    signOutBtn.type = "button";
    signOutBtn.className = "desk-btn desk-btn--text";
    signOutBtn.textContent = "Sign out";
    signOutBtn.addEventListener("click", () => {
      clearAuthStorage();
      window.location.reload();
    });

    actions.append(createBtn, signOutBtn);
    card.append(title, subtitle, list, actions);
    root.append(backdrop, card);
  }

  private characterOption(character: CharacterListItem): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "char-option";
    btn.addEventListener("click", () => {
      this.onPlay?.(this.characters, character.id);
      this.hide();
    });

    const badge = document.createElement("span");
    badge.className = "char-option__badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = this.classEmoji(character.class_id);

    const info = document.createElement("span");
    info.className = "char-option__info";

    const name = document.createElement("span");
    name.className = "char-option__name";
    name.textContent = character.name;

    const meta = document.createElement("span");
    meta.className = "char-option__meta";
    const cls = this.classById(character.class_id);
    const classLabel = cls ? cls.display_name : "Courier";
    const zoneLabel = this.zoneLabel(character.zone_id);
    meta.textContent = `${classLabel} · Level ${character.level} · ${zoneLabel}`;

    const play = document.createElement("span");
    play.className = "char-option__play";
    play.textContent = "Deliver ▶";

    info.append(name, meta);
    btn.append(badge, info, play);
    return btn;
  }

  private renderCreate(root: HTMLElement): void {
    const backdrop = document.createElement("div");
    backdrop.className = "character-desk__backdrop";

    const card = document.createElement("article");
    card.className = "desk-card";
    card.insertAdjacentHTML("afterbegin", LEAF_SVG);

    const title = document.createElement("h1");
    title.id = "desk-title";
    title.className = "desk-card__title";
    title.textContent = "Welcome to Clover Village!";

    const subtitle = document.createElement("p");
    subtitle.className = "desk-card__tagline";
    subtitle.textContent =
      "Give your first courier a name and pick the role they'll deliver as.";

    const form = document.createElement("form");
    form.className = "desk-form";
    form.setAttribute("novalidate", "");

    // --- name field ---
    const nameField = document.createElement("div");
    nameField.className = "desk-field";

    const nameLabel = document.createElement("label");
    nameLabel.htmlFor = "desk-name";
    nameLabel.className = "desk-field__label";
    nameLabel.textContent = "Courier name";

    const nameInput = document.createElement("input");
    nameInput.id = "desk-name";
    nameInput.name = "name";
    nameInput.type = "text";
    nameInput.maxLength = 50;
    nameInput.autocomplete = "off";
    nameInput.placeholder = "e.g. Maple Meadowpaw";
    nameInput.className = "desk-field__input";

    nameField.append(nameLabel, nameInput);

    // --- class picker ---
    const classesFieldset = document.createElement("fieldset");
    classesFieldset.className = "desk-classes";

    const classesLegend = document.createElement("legend");
    classesLegend.className = "desk-field__label";
    classesLegend.textContent = "Choose your class";

    const classesGrid = document.createElement("div");
    classesGrid.className = "class-grid";
    this.renderClassGrid(classesGrid);

    classesFieldset.append(classesLegend, classesGrid);

    // --- status / error / actions ---
    const status = document.createElement("p");
    status.className = "desk-card__status";
    status.setAttribute("aria-live", "polite");

    const error = document.createElement("p");
    error.className = "desk-card__error";
    error.setAttribute("aria-live", "assertive");
    error.setAttribute("hidden", "");

    const actions = document.createElement("div");
    actions.className = "desk-actions";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "desk-btn desk-btn--primary";
    submit.textContent = "Start delivering";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "desk-btn desk-btn--text";
    backBtn.textContent =
      this.characters.length > 0 ? "Back to my couriers" : "Sign out";
    backBtn.addEventListener("click", () => {
      if (this.characters.length > 0) {
        this.forceCreate = false;
        this.render();
      } else {
        clearAuthStorage();
        window.location.reload();
      }
    });

    actions.append(submit, backBtn);
    form.append(nameField, classesFieldset, status, error, actions);

    const footnote = document.createElement("p");
    footnote.className = "desk-card__footnote";
    footnote.textContent =
      "Don't worry about the perfect pick — every class can deliver any parcel.";

    card.append(title, subtitle, form, footnote);
    root.append(backdrop, card);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitCreate(nameInput.value, status, error, submit);
    });

    // Put the player's cursor in the name field right away.
    window.setTimeout(() => nameInput.focus(), 30);
  }

  private classOption(cls: ClassOption): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "class-option";
    label.htmlFor = `class-${cls.id}`;

    const radio = document.createElement("input");
    radio.className = "class-option__radio";
    radio.type = "radio";
    radio.name = "class";
    radio.id = `class-${cls.id}`;
    radio.value = String(cls.id);
    radio.checked = this.selectedClassId === cls.id;
    radio.addEventListener("change", () => {
      this.selectedClassId = cls.id;
    });

    const emoji = document.createElement("span");
    emoji.className = "class-option__emoji";
    emoji.setAttribute("aria-hidden", "true");
    emoji.textContent = ANIMAL_EMOJI[cls.animal] ?? CLASS_EMOJI_FALLBACK;

    const body = document.createElement("span");
    body.className = "class-option__body";

    const name = document.createElement("span");
    name.className = "class-option__name";
    name.textContent = cls.display_name;

    const desc = document.createElement("span");
    desc.className = "class-option__desc";
    desc.textContent =
      cls.description ??
      `${cls.role} · stamina-driven delivery specialist`;

    body.append(name, desc);
    label.append(radio, emoji, body);
    return label;
  }

  // ---------------------------------------------------------------- actions

  private async submitCreate(
    rawName: string,
    status: HTMLElement,
    error: HTMLElement,
    submit: HTMLButtonElement,
  ): Promise<void> {
    const name = rawName.trim();
    const nameError = validateCharacterName(name);
    if (nameError !== null) {
      this.setError(error, status, nameError);
      return;
    }
    if (this.selectedClassId === null) {
      this.setError(error, status, "Pick a class for your courier first.");
      return;
    }
    if (this.detail === null) return;

    submit.disabled = true;
    error.setAttribute("hidden", "");
    status.textContent = "Registering your courier…";

    try {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.detail.token}`,
        },
        credentials: "omit",
        body: JSON.stringify({
          name,
          class_id: this.selectedClassId,
          appearance: {},
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        character?: CharacterListItem;
        message?: string;
      } | null;

      if (!res.ok) {
        const message =
          body?.message ??
          "The post office couldn't register your courier — try again.";
        this.setError(error, status, message);
        return;
      }
      const created = body?.character;
      if (created === undefined || typeof created.id !== "number") {
        this.setError(
          error,
          status,
          "The post office sent back a strange reply — try again.",
        );
        return;
      }

      this.characters = [...this.characters, created];
      this.onPlay?.(this.characters, created.id);
      this.hide();
    } catch {
      this.setError(
        error,
        status,
        "The post office is unreachable right now — check your connection.",
      );
    } finally {
      submit.disabled = false;
    }
  }

  // ----------------------------------------------------------------- helpers

  private async ensureClasses(force = false): Promise<void> {
    if ((this.classes !== null || this.classesFailed) && !force) return;
    if (this.detail === null) return;
    this.classesFailed = false;
    if (force) this.refreshClassesIntoCurrentView(); // show "fetching…" again
    try {
      const res = await fetch("/api/classes", {
        headers: { Authorization: `Bearer ${this.detail.token}` },
        credentials: "omit",
      });
      if (!res.ok) throw new Error(`classes HTTP ${res.status}`);
      const body = (await res.json()) as { classes?: ClassOption[] };
      if (!Array.isArray(body.classes) || body.classes.length === 0) {
        throw new Error("empty class catalog");
      }
      this.classes = body.classes;
      this.refreshClassesIntoCurrentView();
    } catch {
      // Offline (or empty catalog) — surface a retry in the create form.
      this.classesFailed = true;
      this.refreshClassesIntoCurrentView();
    }
  }

  /**
   * Apply the fetched class catalog to whatever view is showing. When the
   * create form is on screen, swap the grid in place so a typed name
   * survives; otherwise re-render the whole desk.
   */
  private refreshClassesIntoCurrentView(): void {
    const root = this.root;
    if (root === null || root.hasAttribute("hidden")) return;
    const grid = root.querySelector(".class-grid");
    if (grid instanceof HTMLElement && grid.querySelector(".class-option") === null) {
      this.renderClassGrid(grid);
      return;
    }
    this.render();
  }

  /** Fill the class grid with cards, or a loading/retry note when offline. */
  private renderClassGrid(grid: HTMLElement): void {
    grid.textContent = "";
    if (this.classes !== null && this.classes.length > 0) {
      for (const cls of this.classes) {
        grid.appendChild(this.classOption(cls));
      }
      return;
    }
    const note = document.createElement("p");
    note.className = "desk-card__status";
    note.textContent = this.classesFailed
      ? "Couldn't load the class catalog."
      : "Fetching the class catalog…";
    grid.appendChild(note);
    if (this.classesFailed) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "desk-btn desk-btn--text";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => void this.ensureClasses(true));
      grid.appendChild(retry);
    }
  }

  private classById(classId: number): ClassOption | undefined {
    return this.classes?.find((c) => c.id === classId);
  }

  private classEmoji(classId: number): string {
    const cls = this.classById(classId);
    return cls === undefined
      ? CLASS_EMOJI_FALLBACK
      : (ANIMAL_EMOJI[cls.animal] ?? CLASS_EMOJI_FALLBACK);
  }

  private zoneLabel(zoneId: string): string {
    return zoneId === "zone-clover-village" ? "Clover Village" : zoneId;
  }

  private setError(
    error: HTMLElement,
    status: HTMLElement,
    message: string,
  ): void {
    error.textContent = message;
    error.removeAttribute("hidden");
    status.textContent = "The registration desk is holding your form.";
  }
}
