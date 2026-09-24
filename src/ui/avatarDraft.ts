/**
 * The avatar editor's state changes, apart from the DOM so node tests cover
 * them: choosing a species, painting a part, resetting it, and which colour a
 * part shows right now.
 */
import {
  BODY_PARTS,
  SPECIES,
  normalizeAppearance,
  speciesById,
  type Appearance,
  type AvatarPart,
  type SpeciesDefinition,
} from "../game/appearance.ts";
import { PART_REFERENCE } from "../game/avatarPalette.ts";
import type { ClassKey } from "../game/classStats.ts";

/** Preset swatches per part; the colour input covers everything else. */
export const PART_SWATCHES: Readonly<Record<AvatarPart, readonly string[]>> = {
  fur: ["#f2f0ea", "#e8c89a", "#deb17b", "#c8502a", "#a8744a", "#6b4a32", "#8f96a3", "#3a3a3a"],
  fur2: ["#fffaf2", "#f6e7db", "#f4c8cc", "#f2d7a8", "#d9d4ea", "#c9e3c4", "#b8b2aa", "#4a4040"],
  eyes: ["#0e4aa0", "#3a38c7", "#2f8a4a", "#74fcfd", "#f0c040", "#8a4b2a", "#8a3ab0", "#202020"],
  outfit: ["#2b2929", "#2a3450", "#3a5a3a", "#5b7a3a", "#7a2a3a", "#6a4a8a", "#c99a32", "#80674b"],
  accent: ["#a95556", "#e85f57", "#e7bc55", "#e0b050", "#6f9d58", "#4f86cd", "#d97ab0", "#f2f0ea"],
};

function speciesOf(appearance: Appearance): SpeciesDefinition {
  return speciesById(appearance.species) ?? (SPECIES[0] as SpeciesDefinition);
}

/** Whether a saved look names a real species (otherwise the class's animal stands in). */
export function choosesSpecies(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const species = (raw as { species?: unknown }).species;
  return typeof species === "string" && speciesById(species) !== undefined;
}

/** A fresh look for a species: its own default colours. */
export function withSpecies(speciesId: string, classKey: ClassKey): Appearance {
  return normalizeAppearance({ species: speciesId }, classKey);
}

/** Paint one part, or clear it back to the species default with `null`. */
export function withPartColor(
  appearance: Appearance,
  part: AvatarPart,
  color: string | null,
  classKey: ClassKey,
): Appearance {
  const colors = { ...appearance.colors };
  if (color === null) delete colors[part];
  else colors[part] = color;
  return normalizeAppearance({ species: appearance.species, colors }, classKey);
}

/** The parts this look's body can recolour. */
export function editableParts(appearance: Appearance): readonly AvatarPart[] {
  return BODY_PARTS[speciesOf(appearance).body];
}

/** The colour a part shows: the courier's pick, else the species default, else the art's own tone. */
export function partColor(appearance: Appearance, part: AvatarPart): string {
  const species = speciesOf(appearance);
  return appearance.colors[part] ?? species.colors[part] ?? PART_REFERENCE[species.body][part] ?? "#000000";
}
