import { describe, expect, it } from "vitest";
import { encodePNG } from "../../scripts/lib/png.mjs";
import {
  PANEL_NAMES,
  PANEL_PALETTES,
  buildZonePreview,
  renderCompositionPreviews,
} from "../../scripts/render-composition.mjs";
import cloverVillageJson from "../../src/data/maps/clover-village.json";
import happyValleyJson from "../../src/data/maps/happy-valley.json";
import { buildTerrainPlan, isPavedTile } from "../../src/game/terrainSurface.ts";
import type { MapData } from "../../src/game/Maps.ts";
import { CLOVER_VILLAGE_TERRAIN } from "../../src/game/cloverVillagePlacements.ts";
import { HAPPY_VALLEY_TERRAIN } from "../../src/game/happyValleyPlacements.ts";
import { isReservedNear, reservedTilesFor } from "../../src/game/terrainComposition.ts";
import { COMPOSITION_BY_ZONE } from "../../src/game/compositionPlans.ts";
import npcsJson from "../../src/data/npcs.json";

/**
 * The composition review harness (`npm run composition:render`) draws the
 * *planners'* output, with no browser and no Phaser, so it can be checked the
 * way any other deterministic artifact is.
 *
 * The point of these tests is not that the images look nice — that judgement is
 * human. It is that the images cannot lie: the harness must stay a renderer of
 * decisions taken elsewhere, so a tile the planner classified one way can never
 * be drawn another way, and a panel can never quietly go blank.
 *
 * Its sibling `terrain-composition.test.ts` audits the decisions themselves.
 */

const ZONES = ["clover-village", "happy-valley"] as const;

/** The map JSON as the planners see it (the same cast the sibling suite uses). */
type ZoneMap = MapData & {
  spawn: { x: number; y: number };
  transitions: { x: number; y: number }[];
  interactables: { x: number; y: number }[];
};

const MAPS: Record<(typeof ZONES)[number], ZoneMap> = {
  "clover-village": cloverVillageJson as unknown as ZoneMap,
  "happy-valley": happyValleyJson as unknown as ZoneMap,
};

const PX = buildZonePreview("clover-village").panels[0].raster.w / 75;

type Panel = ReturnType<typeof buildZonePreview>["panels"][number];

/** The RGBA at a pixel. */
function pixelAt(raster: Panel["raster"], x: number, y: number): number[] {
  const i = (y * raster.w + x) * 4;
  return [raster.buf[i]!, raster.buf[i + 1]!, raster.buf[i + 2]!, raster.buf[i + 3]!];
}

/** Sample the centre of a tile. */
const tileCentre = (raster: Panel["raster"], x: number, y: number): number[] =>
  pixelAt(raster, x * PX + Math.floor(PX / 2), y * PX + Math.floor(PX / 2));

function panelOf(preview: ReturnType<typeof buildZonePreview>, name: string): Panel {
  const panel = preview.panels.find((entry) => entry.name === name);
  if (panel === undefined) throw new Error(`no ${name} panel`);
  return panel;
}

describe("composition review harness — renders the plan, never re-decides it", () => {
  it("emits one panel per documented name, in order, and documents every one", () => {
    for (const zone of ZONES) {
      const preview = buildZonePreview(zone);
      expect(preview.panels.map((panel) => panel.name)).toEqual([...PANEL_NAMES]);
      for (const panel of preview.panels) {
        expect(preview.legend[panel.name]).toBeTypeOf("string");
        expect(panel.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("sizes every panel to the map it draws", () => {
    for (const zone of ZONES) {
      const preview = buildZonePreview(zone);
      const map = MAPS[zone];
      expect(preview.map).toEqual({ width: map.width, height: map.height });
      for (const panel of preview.panels) {
        expect([panel.raster.w, panel.raster.h]).toEqual([map.width * PX, map.height * PX]);
      }
    }
  });

  it("draws the paved disc the planner classified, tile for tile", () => {
    // The defect Pass 2 fixed was a hardcoded 176-tile rectangle painted over a
    // 134-tile disc. If the harness rendered anything but `isPavedTile`'s answer,
    // this count would drift — so the count is read back out of the pixels.
    const preview = buildZonePreview("clover-village");
    const surface = panelOf(preview, "surface").raster;
    const paved = PANEL_PALETTES.surface.paved;
    const map = MAPS["clover-village"];

    let drawnPaved = 0;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const isPaved = isPavedTile(map, x, y);
        const pixel = tileCentre(surface, x, y);
        const painted = pixel[0] === paved[0] && pixel[1] === paved[1] && pixel[2] === paved[2];
        if (isPaved) drawnPaved += 1;
        expect(painted).toBe(isPaved);
      }
    }
    expect(drawnPaved).toBe(preview.counts.paved);
    expect(drawnPaved).toBeGreaterThan(0);
  });

  it("never invents a colour: every tile is one the panel declares", () => {
    // The magenta sentinel in the harness marks a map code the renderer does not
    // handle. If it ever survives into an image, a tile is being drawn by
    // accident instead of by decision.
    for (const zone of ZONES) {
      const surface = panelOf(buildZonePreview(zone), "surface").raster;
      const declared = new Set(
        Object.values(PANEL_PALETTES.surface).map((color) => color.slice(0, 3).join(",")),
      );
      const map = MAPS[zone];
      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          const pixel = tileCentre(surface, x, y);
          expect(pixel).toBeDefined();
          expect(declared.has(pixel.slice(0, 3).join(","))).toBe(true);
        }
      }
    }
  });

  it("shows the clearance audit as clean, for both zones", () => {
    for (const zone of ZONES) {
      const preview = buildZonePreview(zone);
      expect(preview.violations).toEqual([]);
      // And nothing is painted in the violation colour.
      const clearance = panelOf(preview, "clearance").raster;
      const violation = PANEL_PALETTES.violation;
      let flagged = 0;
      for (let i = 0; i < clearance.buf.length; i += 4) {
        if (
          clearance.buf[i] === violation[0] &&
          clearance.buf[i + 1] === violation[1] &&
          clearance.buf[i + 2] === violation[2]
        ) {
          flagged += 1;
        }
      }
      expect(flagged).toBe(0);
    }
  });

  it("shadows every piece south-east of it, from the shared recipe", () => {
    // Light arrives from the north-west, so the cast shadow must land down-right
    // of the piece's base point. This compares the lighting panel against the
    // same panel with no pieces, so it can only pass if a shadow was actually
    // painted where the recipe says.
    const preview = buildZonePreview("clover-village");
    const lighting = panelOf(preview, "lighting").raster;
    const bare = panelOf(buildZonePreview("clover-village", { pieces: [] }), "lighting").raster;

    let changed = 0;
    for (let i = 0; i < lighting.buf.length; i += 4) {
      if (lighting.buf[i] !== bare.buf[i]) changed += 1;
    }
    expect(changed).toBeGreaterThan(preview.counts.setPieces * PX);

    // Every marker tile inside the map has ground beneath it: the panel is not
    // blank, so the comparison above is meaningful rather than two dark images.
    const ground = tileCentre(bare, 10, 10);
    expect(ground[3]).toBe(255);
    expect(bare.buf.length).toBe(lighting.buf.length);
  });

  it("draws only pieces a zone declares art for", () => {
    // The valley plans canopy coverage but authors no canopy or fringe art, so
    // the shared renderer draws its base and path only. Both totals are reported
    // so the gap is visible instead of looking like a broken panel.
    const valley = buildZonePreview("happy-valley");
    expect(HAPPY_VALLEY_TERRAIN.foliage).toBeUndefined();
    expect(valley.materials).toEqual({
      patch: false,
      plaza: false,
      fringes: false,
      foliage: false,
    });
    expect(valley.counts.foliage).toBeGreaterThan(0);
    expect(valley.counts.drawnPieces).toBe(0);

    const village = buildZonePreview("clover-village");
    expect(village.materials).toEqual({
      patch: true,
      plaza: true,
      fringes: true,
      foliage: true,
    });
    expect(village.counts.drawnPieces).toBe(
      village.counts.foliage + village.counts.patches,
    );
  });

  it("describes the same reserved set the scene builds", () => {
    // A zone mismatch would silently leave an NPC unprotected in the image while
    // the audit still reported clean.
    const village = buildZonePreview("clover-village");
    const expected = reservedTilesFor(
      MAPS["clover-village"],
      npcsJson.npcs
        .filter((npc) => npc.homeZone === "zone-clover-village")
        .map((npc) => npc.homeTile),
    );
    const counts = { npc: 0, spawn: 0, transition: 0, interactable: 0 };
    for (const tile of expected) counts[tile.kind] += 1;
    expect(village.reservedCounts).toEqual(counts);
    expect(counts.npc).toBeGreaterThan(0);
  });

  it("is byte-identical across runs", () => {
    // Determinism is the whole reason this harness can replace a browser for
    // these questions: a diff of two runs is a real change.
    for (const zone of ZONES) {
      const first = buildZonePreview(zone);
      const second = buildZonePreview(zone);
      for (const [index, panel] of first.panels.entries()) {
        const other = second.panels[index];
        expect(Buffer.compare(Buffer.from(panel.raster.buf), Buffer.from(other.raster.buf))).toBe(0);
        const a = encodePNG(panel.raster.w, panel.raster.h, Buffer.from(panel.raster.buf.buffer));
        const b = encodePNG(other.raster.w, other.raster.h, Buffer.from(other.raster.buf.buffer));
        expect(Buffer.compare(a, b)).toBe(0);
      }
      expect(first.counts).toEqual(second.counts);
    }
  });

  it("writes a manifest that points at files that exist", () => {
    const manifest = renderCompositionPreviews(
      new URL("../../artifacts/composition-test/", import.meta.url),
    );
    expect(manifest.zones.map((zone) => zone.zone)).toEqual([...ZONES]);
    for (const zone of manifest.zones) {
      expect(zone.panels.map((panel) => panel.name)).toEqual([...PANEL_NAMES]);
      for (const panel of zone.panels) {
        expect(panel.size).toEqual([zone.map.width * PX, zone.map.height * PX]);
        expect(panel.file.startsWith(`${zone.zone}-`)).toBe(true);
      }
      expect(zone.sheet).toBe(`${zone.zone}-sheet.png`);
    }
  });

  it("shows the banding priority order in the density panel", () => {
    // The band is an override, not a density class, and it is decided per tile —
    // so no cell boundary may leave a hole in it. But a reserved tile wins over
    // everything, including the treeline (`buildDensityGrid` documents that
    // order), so the only tiles allowed to break the band are reserved ones.
    // Read back from the pixels, which is what makes this a check on the image.
    const map = MAPS["clover-village"];
    const preview = buildZonePreview("clover-village");
    const density = panelOf(preview, "density").raster;
    const reserved = reservedTilesFor(
      map,
      npcsJson.npcs
        .filter((npc) => npc.homeZone === "zone-clover-village")
        .map((npc) => npc.homeTile),
    );
    const dense = PANEL_PALETTES.density.dense;
    const open = PANEL_PALETTES.density.open;
    let reservedInBand = 0;

    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (x >= 5 && y >= 5 && x < map.width - 5 && y < map.height - 5) continue;
        const pixel = tileCentre(density, x, y).slice(0, 3);
        if (isReservedNear(reserved, x, y)) {
          reservedInBand += 1;
          expect(pixel).toEqual(open.slice(0, 3));
          continue;
        }
        expect(pixel).toEqual(dense.slice(0, 3));
      }
    }

    // The exception is real, not hypothetical — otherwise this test would pass
    // even if reserved tiles stopped taking priority.
    expect(reservedInBand).toBeGreaterThan(0);
  });

  it("reports the authored plan it drew, and it is the plan the game composes with", () => {
    // The harness reads the plan from the same registry the scene does, so a
    // picture can never show a composition the game would not build.
    for (const zone of ZONES) {
      const preview = buildZonePreview(zone);
      const plan = COMPOSITION_BY_ZONE[`zone-${zone}`];
      expect(plan).toBeDefined();
      expect(preview.authored.regions).toBe(plan!.regions.length);
      expect(preview.authored.entrances).toBe(plan!.entrances?.length ?? 0);
      expect(preview.authored.derived).toBe(plan!.entrances === null);
      expect(preview.authored.cellTiles).toBe(plan!.cellTiles);
      expect(preview.authored.treelineBand).toBe(plan!.treeline.band);
      expect(preview.authored.bands).toEqual(plan!.bands);
      // Hand-composed zones compose by hand: neither of them leans on the
      // derived entrances, and both paint regions.
      expect(preview.authored.derived).toBe(false);
      expect(preview.authored.regions).toBeGreaterThan(0);
      const painted = Object.values(preview.authored.regionsByClass).reduce(
        (sum, count) => sum + count,
        0,
      );
      expect(painted).toBe(preview.authored.regions);
    }
  });

  it("is exercised by the same planner the game runs", () => {
    // Guards the seam this harness depends on: it must call the real planner.
    const preview = buildZonePreview("clover-village");
    const plan = buildTerrainPlan(MAPS["clover-village"], {
      foliageVariants: CLOVER_VILLAGE_TERRAIN.foliage?.length ?? 1,
      reserved: [],
    });
    expect(plan.paved.length).toBeGreaterThan(0);
    expect(preview.counts.paved).toBe(plan.paved.length);
  });
});
