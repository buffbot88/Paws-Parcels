/**
 * A courier's look: which animal they are and the colours of its parts.
 *
 * Shared by client and server. Species decides the body art; class still
 * decides stats and attacks. The three bodies are the authored class art
 * (bear, cat, fox); every other species is a recolour of one of them until
 * its own art exists. Pure: no Phaser, so the server validates with it too.
 */
import speciesJson from "../data/species.json" with { type: "json" };
import type { ClassKey } from "./classStats.ts";

export type AvatarBody = "bear" | "cat" | "fox";
export type AvatarPart = "fur" | "fur2" | "eyes" | "outfit" | "accent";
export type AvatarColors = Partial<Record<AvatarPart, string>>;

export const AVATAR_PARTS: readonly AvatarPart[] = ["fur", "fur2", "eyes", "outfit", "accent"];

export const PART_LABELS: Readonly<Record<AvatarPart, string>> = {
  fur: "Fur",
  fur2: "Markings",
  eyes: "Eyes",
  outfit: "Outfit",
  accent: "Trim",
};

/**
 * Which parts each body's art can recolour. The cat's suit is drawn in its
 * fur colour and the bear's muzzle in its fur tones, so those parts have no
 * pixels of their own to take a colour.
 */
export const BODY_PARTS: Readonly<Record<AvatarBody, readonly AvatarPart[]>> = {
  bear: ["fur", "eyes", "outfit", "accent"],
  cat: ["fur", "fur2", "eyes"],
  fox: ["fur", "fur2", "eyes", "outfit", "accent"],
};

/** The class art each body is drawn from. */
export const BODY_ART_CLASS: Readonly<Record<AvatarBody, ClassKey>> = {
  bear: "bear-warrior",
  cat: "cat-mage",
  fox: "fox-archer",
};

/** A courier with no saved look keeps the animal their class always had. */
const CLASS_SPECIES: Readonly<Record<ClassKey, string>> = {
  "bear-warrior": "bear",
  "cat-mage": "cat",
  "fox-archer": "fox",
};

export interface SpeciesDefinition {
  readonly id: string;
  readonly name: string;
  readonly body: AvatarBody;
  readonly colors: AvatarColors;
}

export const SPECIES: readonly SpeciesDefinition[] = speciesJson.species as SpeciesDefinition[];

export interface Appearance {
  species: string;
  colors: AvatarColors;
}

/** What the renderer needs: the body to draw and the colours to paint it. */
export interface AvatarLook {
  readonly body: AvatarBody;
  readonly colors: AvatarColors;
}

const HEX = /^#[0-9a-f]{6}$/;

export function speciesById(id: string): SpeciesDefinition | undefined {
  return SPECIES.find((species) => species.id === id);
}

/**
 * Clean a client-supplied look: an unknown species falls back to the class's
 * animal, and only well-formed colours for parts the body has survive.
 */
export function normalizeAppearance(raw: unknown, classKey: ClassKey): Appearance {
  const record = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const requested = typeof record.species === "string" ? speciesById(record.species) : undefined;
  const species = requested ?? (speciesById(CLASS_SPECIES[classKey]) as SpeciesDefinition);
  const rawColors =
    typeof record.colors === "object" && record.colors !== null ? (record.colors as Record<string, unknown>) : {};
  const colors: AvatarColors = {};
  for (const part of BODY_PARTS[species.body]) {
    const value = rawColors[part];
    if (typeof value === "string" && HEX.test(value.toLowerCase())) colors[part] = value.toLowerCase();
  }
  return { species: species.id, colors };
}

/** The body and final colours: species defaults, overridden by the courier's own picks. */
export function resolveLook(raw: unknown, classKey: ClassKey): AvatarLook {
  const appearance = normalizeAppearance(raw, classKey);
  const species = speciesById(appearance.species) as SpeciesDefinition;
  return { body: species.body, colors: { ...species.colors, ...appearance.colors } };
}

/** A stable id for a look; an unpainted body is just its class art. */
export function lookArtId(look: AvatarLook): string {
  const painted = AVATAR_PARTS.filter((part) => look.colors[part] !== undefined);
  if (painted.length === 0) return BODY_ART_CLASS[look.body];
  return `look-${look.body}-${painted.map((part) => `${part}${look.colors[part]?.slice(1)}`).join("-")}`;
}
