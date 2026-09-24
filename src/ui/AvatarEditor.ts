/**
 * The look editor shared by the courier desk and Fern's Salon: a species
 * picker, colour pickers for the parts that species' body can recolour, and a
 * live mirror. Switching species starts from that species' own colours.
 */
import {
  PART_LABELS,
  SPECIES,
  normalizeAppearance,
  resolveLook,
  speciesById,
  type Appearance,
  type AvatarPart,
} from "../game/appearance.ts";
import type { ClassKey } from "../game/classStats.ts";
import { AvatarMirror, drawLookThumbnail } from "./AvatarMirror.ts";
import {
  PART_SWATCHES,
  choosesSpecies,
  editableParts,
  partColor,
  withPartColor,
  withSpecies,
} from "./avatarDraft.ts";

export interface AvatarEditorOptions {
  classKey: ClassKey;
  /** A saved look; empty or unknown means the class's animal with its default colours. */
  appearance?: unknown;
  onChange?: (appearance: Appearance) => void;
}

interface ColorRow {
  swatches: HTMLButtonElement[];
  input: HTMLInputElement;
  reset: HTMLButtonElement;
}

let nextId = 0;

export class AvatarEditor {
  private readonly root: HTMLElement;
  private readonly mirror: AvatarMirror;
  private readonly colorList: HTMLElement;
  private readonly speciesButtons = new Map<string, HTMLButtonElement>();
  private readonly rows = new Map<AvatarPart, ColorRow>();
  private readonly idPrefix = `avatar-editor-${nextId++}`;
  private classKey: ClassKey;
  private appearance: Appearance;
  /** No look picked yet, so the species follows the chosen class. */
  private followsClass: boolean;

  constructor(
    container: HTMLElement,
    private readonly options: AvatarEditorOptions,
  ) {
    this.classKey = options.classKey;
    this.appearance = normalizeAppearance(options.appearance, this.classKey);
    this.followsClass = !choosesSpecies(options.appearance);

    this.root = document.createElement("div");
    this.root.className = "avatar-editor";

    const preview = document.createElement("div");
    preview.className = "avatar-editor__preview";
    this.mirror = new AvatarMirror(preview);

    const controls = document.createElement("div");
    controls.className = "avatar-editor__controls";

    const speciesGroup = this.group("Animal");
    const speciesGrid = document.createElement("div");
    speciesGrid.className = "avatar-editor__species";
    for (const species of SPECIES) speciesGrid.appendChild(this.speciesOption(species.id));
    speciesGroup.appendChild(speciesGrid);

    const colorGroup = this.group("Colours");
    this.colorList = document.createElement("div");
    this.colorList.className = "avatar-editor__colors";
    colorGroup.appendChild(this.colorList);

    controls.append(speciesGroup, colorGroup);
    this.root.append(preview, controls);
    container.appendChild(this.root);
    this.renderColors();
    this.sync();
  }

  getAppearance(): Appearance {
    return normalizeAppearance(this.appearance, this.classKey);
  }

  setClassKey(classKey: ClassKey): void {
    this.classKey = classKey;
    if (!this.followsClass) return;
    this.appearance = normalizeAppearance({}, classKey);
    this.renderColors();
    this.sync();
    this.options.onChange?.(this.getAppearance());
  }

  destroy(): void {
    this.mirror.destroy();
    this.root.remove();
  }

  private update(appearance: Appearance, speciesChanged: boolean): void {
    this.appearance = appearance;
    this.followsClass = false;
    if (speciesChanged) this.renderColors();
    this.sync();
    this.options.onChange?.(this.getAppearance());
  }

  private group(legendText: string): HTMLFieldSetElement {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "avatar-editor__group";
    const legend = document.createElement("legend");
    legend.className = "avatar-editor__legend";
    legend.textContent = legendText;
    fieldset.appendChild(legend);
    return fieldset;
  }

  private speciesOption(speciesId: string): HTMLButtonElement {
    const species = speciesById(speciesId);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "species-option";
    btn.setAttribute("aria-label", species?.name ?? speciesId);
    const thumb = document.createElement("canvas");
    thumb.className = "species-option__thumb";
    thumb.width = 36;
    thumb.height = 36;
    thumb.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "species-option__name";
    name.textContent = species?.name ?? speciesId;
    btn.append(thumb, name);
    btn.addEventListener("click", () => this.update(withSpecies(speciesId, this.classKey), true));
    this.speciesButtons.set(speciesId, btn);
    drawLookThumbnail(thumb, resolveLook({ species: speciesId }, this.classKey));
    return btn;
  }

  private renderColors(): void {
    this.rows.clear();
    this.colorList.textContent = "";
    const speciesName = speciesById(this.appearance.species)?.name ?? "species";
    for (const part of editableParts(this.appearance)) {
      const label = PART_LABELS[part];
      const row = document.createElement("div");
      row.className = "color-row";

      const input = document.createElement("input");
      input.type = "color";
      input.className = "color-row__custom";
      input.id = `${this.idPrefix}-${part}`;
      input.title = `Custom ${label.toLowerCase()} colour`;
      input.addEventListener("input", () => this.update(withPartColor(this.appearance, part, input.value, this.classKey), false));

      const name = document.createElement("label");
      name.className = "color-row__label";
      name.htmlFor = input.id;
      name.textContent = label;

      const swatchList = document.createElement("div");
      swatchList.className = "color-row__swatches";
      const swatches = PART_SWATCHES[part].map((hex) => {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "color-swatch";
        swatch.style.background = hex;
        swatch.dataset.color = hex;
        swatch.setAttribute("aria-label", `${label} ${hex}`);
        swatch.addEventListener("click", () => this.update(withPartColor(this.appearance, part, hex, this.classKey), false));
        swatchList.appendChild(swatch);
        return swatch;
      });

      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "color-row__reset";
      reset.textContent = "↺";
      reset.title = `Reset to the ${speciesName} default`;
      reset.setAttribute("aria-label", `Reset ${label.toLowerCase()} to the ${speciesName} default`);
      reset.addEventListener("click", () => this.update(withPartColor(this.appearance, part, null, this.classKey), false));

      row.append(name, swatchList, input, reset);
      this.colorList.appendChild(row);
      this.rows.set(part, { swatches, input, reset });
    }
  }

  private sync(): void {
    for (const [id, btn] of this.speciesButtons) btn.setAttribute("aria-pressed", String(id === this.appearance.species));
    for (const [part, row] of this.rows) {
      const color = partColor(this.appearance, part);
      for (const swatch of row.swatches) swatch.setAttribute("aria-pressed", String(swatch.dataset.color === color));
      if (row.input.value !== color) row.input.value = color;
      row.reset.disabled = this.appearance.colors[part] === undefined;
    }
    this.mirror.setLook(resolveLook(this.appearance, this.classKey));
  }
}
