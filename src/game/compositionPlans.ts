/**
 * The authored composition plans, one per composed zone (visual Pass 4).
 *
 * Mirrors `Maps.ts`: the JSON is imported here rather than read by each caller,
 * so the bundler, the `validate` CLI and the tests all look at the same bytes and
 * a plan can never be silently missing from one of them.
 *
 * Where composition *intent* lives. A designer edits
 * `src/data/maps/<zone>.composition.json` to say which ground is a clearing,
 * which is a thicket, and where the framed ways in belong; the planner in
 * `terrainComposition.ts` only knows how to apply it, and the seeded cell roll
 * covers whatever no region claims. A zone with no plan composes exactly as it
 * did before plans existed (`COMPOSITION_DEFAULTS`).
 */
import { ZoneKeys } from "./GameConstants.ts";
import { ARCHIVED_MAPS } from "./ArchivedMaps.ts";
import cloverVillagePlan from "../data/maps/clover-village.composition.json" with { type: "json" };
import happyValleyPlan from "../data/maps/happy-valley.composition.json" with { type: "json" };
import {
  COMPOSITION_DEFAULTS,
  parseComposition,
  validateComposition,
  type ZoneComposition,
} from "./terrainComposition.ts";
import { isPavedTile } from "./terrainSurface.ts";

/** Raw plan JSON by zone, before parsing. */
export const COMPOSITION_PLAN_JSON: Readonly<Record<string, unknown>> = {
  [ZoneKeys.CloverVillage]: cloverVillagePlan,
  [ZoneKeys.HappyValley]: happyValleyPlan,
};

/** Parse every shipped plan, keeping the errors instead of only reporting them. */
function parseAll(): {
  byZone: Record<string, ZoneComposition>;
  errors: string[];
} {
  const byZone: Record<string, ZoneComposition> = {};
  const errors: string[] = [];
  for (const [zoneId, raw] of Object.entries(COMPOSITION_PLAN_JSON)) {
    const { composition, errors: parseErrors } = parseComposition(raw, zoneId);
    for (const error of parseErrors) errors.push(`${zoneId}: ${error}`);
    // A broken plan falls back to the defaults rather than taking the zone's
    // terrain down with it; the CLI is what stops it shipping.
    byZone[zoneId] = parseErrors.length > 0 ? COMPOSITION_DEFAULTS : composition;
  }
  return { byZone, errors };
}

const parsed = parseAll();

/** The plan the scene composes a zone with, or nothing for an unauthored zone. */
export const COMPOSITION_BY_ZONE: Readonly<Record<string, ZoneComposition>> = parsed.byZone;

/**
 * Every problem with the shipped plans, across both stages: reading them out of
 * JSON, and checking them against the map they are meant to compose.
 *
 * The second stage is the one that matters after a map is regenerated — a region
 * that no longer touches the map, a band that has stopped being ordered, or an
 * entrance that has stopped being a way in. Used by `npm run validate` and by
 * `tests/data/composition-plan.test.ts`.
 */
export function auditCompositionPlans(): string[] {
  const errors = [...parsed.errors];
  for (const zoneId of Object.keys(COMPOSITION_PLAN_JSON)) {
    const composition = COMPOSITION_BY_ZONE[zoneId];
    const map = ARCHIVED_MAPS[zoneId];
    if (composition === undefined) continue;
    if (map === undefined) {
      errors.push(`${zoneId}: plan exists but the zone has no map`);
      continue;
    }
    if (composition.zone !== COMPOSITION_DEFAULTS.zone && composition.zone !== zoneId) {
      errors.push(`${zoneId}: plan is labelled for zone "${composition.zone}"`);
    }
    for (const error of validateComposition(composition, map, {
      // The map's own road code plus the derived paving: an entrance has to lead
      // onto something a courier can actually walk down.
      isPath: (x, y) => isPavedTile(map, x, y) || map.rows[y]?.[x] === "P",
    })) {
      errors.push(`${zoneId}: ${error}`);
    }
  }
  return errors;
}
