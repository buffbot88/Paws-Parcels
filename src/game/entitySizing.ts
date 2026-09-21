/**
 * The tile-based size convention for *entities* — the counterpart to
 * `propSizing.ts` for the things that walk around.
 *
 * Why this exists (and why Pass 3 did not finish the job): Pass 3 gave every
 * prop a declared height in tiles, but the three entity classes each kept their
 * own bare `setScale` literal — the courier at 1.33, authored NPC art at 0.095,
 * monsters at 1.1 — with no shared definition. Measured as *figures* on screen,
 * those three numbers meant:
 *
 *   courier   36px frame x 1.33   ->  figure   27 x 1.33 = 36px = 0.75 tiles
 *   NPC art  700px frame x 0.095  ->  figure  575 x 0.095 = 55px = 1.14 tiles
 *   monster  placeholder x 1.1    ->  figure   40 x 1.10 = 44px = 0.92 tiles
 *
 * so the villagers were 1.5x the courier beside them while the monsters were
 * barely taller, and nothing in the codebase said which of those was intended.
 * This module says it, the same way the prop table does: a declared rendered
 * height in tiles, one shared conversion, and an audit.
 *
 * ## Why entities are measured by their *figure*, not their canvas
 *
 * A prop's art is cropped tight to its own bounds, so its canvas height is its
 * height. Entity art is not: the class frames put the figure in 69% of a 36px
 * square, and the NPC pack in 82-89% of a 700px one. Measuring entities by
 * canvas height would therefore mean two different things in two packs — which
 * is exactly how 1.33 and 0.095 came to look comparable when they were not.
 *
 * So every row below declares the alpha-bounds box of the figure, measured over
 * the art the entity can actually show — for a class, the four idle rotations
 * plus every walk/attack/death frame, because the figure changes shape between
 * them and the declaration has to bound all of it; for an NPC pack, its idle
 * sequence, which is all that pack ships. `tiles` is the intended height of the
 * tallest of those.
 *
 * ## The rule
 *
 *   scale = tiles * TILE_SIZE / visible          (shared `scaleForTiles`)
 *   contact width = visibleWidth * scale * band fraction   (`contactWidthFor`)
 *   contact box  = `contactBoxFrom`               (shared with props)
 *   shadow       = `shadowRecipe(contact width)`  (Pass 6's one recipe)
 *
 * The courier is the yardstick and keeps its current on-screen size (0.75
 * tiles, which is scale 1.333 for the bear and cat, 1.286 for the fox) — so this
 * pass corrects the entities that disagreed with it rather than resetting the
 * character the camera and physics are tuned around.
 *
 * Pure and Phaser-free, like its prop counterpart: `tests/data/entity-sizing.test.ts`
 * re-measures the art on disk and audits every row.
 */
import type { ClassKey } from "./classStats.ts";
import type { CloverNpcArt } from "./cloverVillageNpcAssets.ts";
import type { FootprintBox } from "./propSizing.ts";
import type { ShadowRecipe } from "./lighting.ts";
import {
  PROP_TILE_PX,
  contactBoxFrom,
  contactWidthFor,
  scaleForTiles,
} from "./propSizing.ts";
import { shadowRecipe } from "./lighting.ts";

/**
 * The cast, in tiles of rendered figure height.
 *
 * Named bands rather than exact values, for the same reason the prop bands are:
 * a hare and a boar are both monsters, and a band is the vocabulary while the
 * per-row intent is the contract. A band is at least twice the tolerance around
 * its intent, so a row that left its band has failed the intent check first.
 */
export const ENTITY_BANDS = {
  /** The player's couriers: small animal adventurers, and the yardstick. */
  courier: { min: 0.7, max: 0.8 },
  /** Villagers: one head taller than a courier, so adults read as adults. */
  villager: { min: 0.85, max: 1.05 },
  /**
   * Monsters. Deliberately the widest band: placeholder art is one blob for
   * every species, and a boar and a hare must not be forced to agree.
   */
  creature: { min: 0.85, max: 1.3 },
} as const;

export type EntityBand = keyof typeof ENTITY_BANDS;

/**
 * How much of a figure's *widest* silhouette touches the ground.
 *
 * The same concept as `FOOTPRINT_FRACTION` for props, tuned for a standing
 * figure: the widest frame includes arm swing, ears and hat brims, while a
 * contact patch is the feet. A creature on four legs spreads wider than a
 * villager standing still. This is what the cast shadow is sized from.
 */
export const ENTITY_CONTACT_FRACTION: Readonly<Record<EntityBand, number>> = {
  courier: 0.6,
  villager: 0.55,
  creature: 0.7,
};

/**
 * How far an entity's declared height may sit from its figure's measured size.
 *
 * Tighter than `PROP_SIZE_TOLERANCE`, because an entity has one height per
 * class rather than one per placement: there is no authored variation to
 * accommodate, so drift can only ever mean the two have parted company.
 */
export const ENTITY_SIZE_TOLERANCE = 0.05;

/** One entity's art, measured, with the height it is intended to render at. */
export interface EntitySizing {
  /** Which pack the art came from; `generated` rows come from code, not a file. */
  readonly source: "authored" | "generated";
  /** Repository-relative path, or `generated:<texture key>` for a runtime texture. */
  readonly path: string;
  /** Which texture key this row describes, so a lookup can never drift. */
  readonly texture: string;
  /** Full art canvas in source pixels. */
  readonly canvas: { readonly w: number; readonly h: number };
  /** Height of the figure inside the canvas (alpha bounds), source pixels. */
  readonly visible: number;
  /** Width of the widest figure frame (alpha bounds), source pixels. */
  readonly visibleWidth: number;
  /** Source pixels from the canvas centre down to the figure's feet. */
  readonly feet: number;
  readonly band: EntityBand;
  /** Intended rendered height of the figure, in tiles. */
  readonly tiles: number;
}

const CLASS_ROOT = "reference/assets/Classes";
const NPC_ROOT = "reference/assets/maps/CloverVillage/NPC";

/**
 * The player couriers, per class.
 *
 * Measured across everything the class art draws — the four idle rotations
 * (`Classes/<Class>/Idle/rotations/<direction>.png`, which is the stance on
 * screen at rest) and every frame under `animations/` — because the figure
 * changes shape between them and the declaration has to bound all of it: an
 * idle bear is 26px tall and a walking one 27px, in the same 36px frame. So
 * `visible` is the tallest the figure gets, and the derived scale keeps the
 * courier where the camera and physics were tuned (Warrior and Mage land on
 * 1.333, the number they used to carry as a literal).
 *
 * The fox is the widest and lowest of the three (28px across, feet 15px below
 * centre against the bear's 13), and the *tile* is what stays fixed, so its
 * scale compensates rather than its size changing.
 *
 * Typed as `Record<ClassKey, …>` on purpose: adding a fourth class without a
 * row here is a type error, not a silently wrong sprite.
 */
export const COURIER_SIZING: Readonly<Record<ClassKey, EntitySizing>> = {
  "bear-warrior": {
    source: "authored",
    path: `${CLASS_ROOT}/Warrior/Idle`,
    texture: "courier-bear-warrior-idle",
    canvas: { w: 36, h: 36 },
    visible: 27,
    visibleWidth: 25,
    feet: 13,
    band: "courier",
    tiles: 0.75,
  },
  "cat-mage": {
    source: "authored",
    path: `${CLASS_ROOT}/Mage/Idle`,
    texture: "courier-cat-mage-idle",
    canvas: { w: 36, h: 36 },
    visible: 27,
    visibleWidth: 24,
    feet: 14,
    band: "courier",
    tiles: 0.75,
  },
  "fox-archer": {
    source: "authored",
    path: `${CLASS_ROOT}/Archer/Idle`,
    texture: "courier-fox-archer-idle",
    canvas: { w: 36, h: 36 },
    visible: 28,
    visibleWidth: 28,
    feet: 15,
    band: "courier",
    tiles: 0.75,
  },
};

/**
 * The generated placeholder blob, used for a courier whose class art is missing
 * and for villagers with no authored art.
 *
 * Its geometry is code (`PreloaderScene.generatePlaceholderTextures`): a circle
 * of radius 20 centred in a 48px square, so the figure is 40px across and its
 * bottom edge is 20px below the canvas centre. It used to render at scale 1 as a
 * courier and 1.1 as a monster; it now renders at the size of the role it is
 * standing in for, which is the point of having the table at all.
 */
export const BLOB_CANVAS = { w: 48, h: 48 } as const;
const BLOB_FIGURE = { visible: 40, visibleWidth: 40, feet: 20 } as const;

/** Fallback courier art (`TextureKeys.PlayerIdleDown`). */
export const COURIER_FALLBACK_SIZING: EntitySizing = {
  source: "generated",
  path: "generated:player-idle-down",
  texture: "player-idle-down",
  canvas: BLOB_CANVAS,
  ...BLOB_FIGURE,
  band: "courier",
  tiles: 0.75,
};

/**
 * Villagers, per authored NPC pack.
 *
 * Measured on `NPC/<Art>/PNG/Front/PNG Sequences/Idle/*`: the tallest frame is
 * 575-627px inside a 700px canvas — 11-18% of that canvas is padding, which is
 * the whole reason a canvas-based rule could not compare an NPC with a courier.
 * All three packs put the feet on the same row (301px below centre), so the
 * pack is grounded consistently even though the figures differ in height.
 */
export const VILLAGER_SIZING: Readonly<Record<CloverNpcArt, EntitySizing>> = {
  artist: {
    source: "authored",
    path: `${NPC_ROOT}/Artist/PNG/Front/PNG Sequences/Idle`,
    texture: "clover-npc-artist-idle-front",
    canvas: { w: 700, h: 700 },
    visible: 596,
    visibleWidth: 440,
    feet: 301,
    band: "villager",
    tiles: 0.95,
  },
  astrologer: {
    source: "authored",
    path: `${NPC_ROOT}/Astrologer/PNG/Front/PNG Sequences/Idle`,
    texture: "clover-npc-astrologer-idle-front",
    canvas: { w: 700, h: 700 },
    visible: 627,
    visibleWidth: 434,
    feet: 301,
    band: "villager",
    tiles: 0.95,
  },
  citizen: {
    source: "authored",
    path: `${NPC_ROOT}/Citizen/PNG/Front/PNG Sequences/Idle`,
    texture: "clover-npc-citizen-idle-front",
    canvas: { w: 700, h: 700 },
    visible: 575,
    visibleWidth: 394,
    feet: 301,
    band: "villager",
    tiles: 0.95,
  },
};

/** Fallback villager art (`TextureKeys.NpcBlob`). */
export const VILLAGER_FALLBACK_SIZING: EntitySizing = {
  source: "generated",
  path: "generated:npc-blob",
  texture: "npc-blob",
  canvas: BLOB_CANVAS,
  ...BLOB_FIGURE,
  band: "villager",
  tiles: 0.95,
};

/**
 * Monster placeholder art — one blob for every species, tinted per family.
 *
 * One row rather than one per species is deliberate and temporary: until Phase 8
 * monster art lands there is nothing species-specific to measure, so the
 * creature band's *range* is where that variation will live. Sized to 1.15 tiles
 * so a monster reads as bigger than the courier it chases, which the previous
 * fixed 1.1 did not achieve once the courier was measured as a figure.
 */
export const CREATURE_SIZING: EntitySizing = {
  source: "generated",
  path: "generated:npc-blob",
  texture: "npc-blob",
  canvas: BLOB_CANVAS,
  ...BLOB_FIGURE,
  band: "creature",
  tiles: 1.15,
};

/**
 * The scale that renders this entity's figure at its declared height.
 *
 * The one conversion the whole cast shares, and the reason no entity file
 * contains a `setScale` literal any more.
 */
export function entityScale(spec: EntitySizing): number {
  return scaleForTiles(spec.visible, spec.tiles);
}

/** On-screen width of the figure, in pixels. */
export function entityRenderedWidthPx(spec: EntitySizing): number {
  return spec.visibleWidth * entityScale(spec);
}

/** On-screen ground-contact width, in pixels — the shadow's basis. */
export function entityContactWidthPx(spec: EntitySizing): number {
  return contactWidthFor(entityRenderedWidthPx(spec), ENTITY_CONTACT_FRACTION[spec.band]);
}

/** The tile the entity stands on, as the same contact box props use. */
export function entityContactBox(spec: EntitySizing): FootprintBox {
  return contactBoxFrom(entityContactWidthPx(spec), spec.tiles);
}

/** This entity's cast shadow, from Pass 6's shared recipe. */
export function entityShadow(spec: EntitySizing): ShadowRecipe {
  return shadowRecipe(entityContactWidthPx(spec));
}

/**
 * Pixels from the entity's centre down to its feet.
 *
 * The shadow sits here. It replaces the fixed `y + 12` the courier and monsters
 * used regardless of size, and lines entities up with the props, whose shadows
 * also come from their own footprint.
 */
export function entityFeetOffsetPx(spec: EntitySizing): number {
  return spec.feet * entityScale(spec);
}

/** Pixels from the entity's centre up to the top of its head (negative = up). */
export function entityHeadOffsetPx(spec: EntitySizing): number {
  return -(spec.visible - spec.feet) * entityScale(spec);
}

/** Where a name tag belongs: just above the figure's head, not its canvas. */
export function entityNameTagOffsetPx(spec: EntitySizing, marginPx = 6): number {
  return entityHeadOffsetPx(spec) - marginPx;
}

/** The courier's row, authored art or the placeholder. */
export function courierSizing(classKey: ClassKey, authoredArtAvailable: boolean): EntitySizing {
  return authoredArtAvailable ? COURIER_SIZING[classKey] : COURIER_FALLBACK_SIZING;
}

/** A villager's row, authored art or the placeholder. */
export function villagerSizing(art: CloverNpcArt | null): EntitySizing {
  return art === null ? VILLAGER_FALLBACK_SIZING : VILLAGER_SIZING[art];
}

/** One named row of the cast, for the audit and its messages. */
export interface EntitySizeRow {
  readonly id: string;
  readonly spec: EntitySizing;
}

/**
 * Every declared row, courier classes and NPC packs by name.
 *
 * The fallbacks are included: a placeholder that is silently the wrong size is
 * exactly the kind of thing nobody notices until a class fails to load.
 */
export function allEntitySizes(): EntitySizeRow[] {
  const rows: EntitySizeRow[] = [];
  for (const [key, spec] of Object.entries(COURIER_SIZING)) {
    rows.push({ id: `courier:${key}`, spec });
  }
  rows.push({ id: "courier:placeholder", spec: COURIER_FALLBACK_SIZING });
  for (const [key, spec] of Object.entries(VILLAGER_SIZING)) {
    rows.push({ id: `villager:${key}`, spec });
  }
  rows.push({ id: "villager:placeholder", spec: VILLAGER_FALLBACK_SIZING });
  rows.push({ id: "creature:placeholder", spec: CREATURE_SIZING });
  return rows;
}

/**
 * Check the cast against its own convention, returning every row that breaks it.
 *
 * Four properties, in order of how expensive a mistake they are:
 *
 *   1. the intent sits inside its band (the vocabulary is honest);
 *   2. the figure fits inside its canvas (a figure taller than its frame is
 *      clipped, and its feet cannot be below the frame it stands in);
 *   3. every courier really is the yardstick — `entityScale` must reproduce the
 *      0.75 tiles the camera and physics are tuned around;
 *   4. the family ranks in the right order: a villager is taller than a courier
 *      and a monster is at least a courier, so the cast reads as one world
 *      instead of three packs that happen to be on screen together.
 *
 * `rows` is injectable so the audit itself can be tested with a broken row.
 */
export function auditEntitySizing(rows: readonly EntitySizeRow[] = allEntitySizes()): string[] {
  const violations: string[] = [];

  for (const { id, spec } of rows) {
    const band = ENTITY_BANDS[spec.band];
    if (spec.tiles < band.min || spec.tiles > band.max) {
      violations.push(
        `${id}: intent ${spec.tiles} tiles is outside the ${spec.band} band (${band.min}-${band.max})`,
      );
    }
    if (spec.visible > spec.canvas.h) {
      violations.push(
        `${id}: figure ${spec.visible}px is taller than its ${spec.canvas.h}px canvas — it would be clipped`,
      );
    }
    if (spec.visibleWidth > spec.canvas.w) {
      violations.push(
        `${id}: figure ${spec.visibleWidth}px is wider than its ${spec.canvas.w}px canvas`,
      );
    }
    if (spec.feet > spec.canvas.h / 2) {
      violations.push(
        `${id}: feet sit ${spec.feet}px below centre, past the ${spec.canvas.h / 2}px canvas half-height`,
      );
    }
    // The rows that cannot be rendered at all, checked *before* the arithmetic:
    // a zero figure height makes the scale Infinity and the rendered height
    // NaN, and every comparison against NaN is false — so a tolerance check
    // alone would pass the one row nothing can draw.
    if (!(spec.visible > 0) || !Number.isFinite(entityScale(spec))) {
      violations.push(
        `${id}: declares a ${spec.visible}px figure, which no scale can render`,
      );
    } else if (!(spec.tiles > 0)) {
      violations.push(`${id}: intent ${spec.tiles} tiles is not a height`);
    } else {
      const tiles = (spec.visible * entityScale(spec)) / PROP_TILE_PX;
      if (Math.abs(tiles - spec.tiles) / spec.tiles > ENTITY_SIZE_TOLERANCE) {
        violations.push(`${id}: renders at ${tiles.toFixed(2)} tiles, intent ${spec.tiles}`);
      }
    }
    if (spec.source === "authored" && !spec.path.startsWith("reference/assets/")) {
      violations.push(`${id}: authored row must point at the art archive, not "${spec.path}"`);
    }
  }

  const byId = new Map(rows.map((row) => [row.id, row.spec]));
  const courier = byId.get("courier:bear-warrior");
  const villager = byId.get("villager:citizen");
  const creature = byId.get("creature:placeholder");
  if (courier !== undefined && villager !== undefined && villager.tiles <= courier.tiles) {
    violations.push(
      `villagers must out-top the courier: ${villager.tiles} vs ${courier.tiles} tiles`,
    );
  }
  if (courier !== undefined && creature !== undefined && creature.tiles < courier.tiles) {
    violations.push(
      `monsters must not be shorter than the courier: ${creature.tiles} vs ${courier.tiles} tiles`,
    );
  }

  return violations;
}
