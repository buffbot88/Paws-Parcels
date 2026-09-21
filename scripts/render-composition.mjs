#!/usr/bin/env node
/**
 * Deterministic composition review images (visual Passes 2-6).
 *
 * The browser baseline (`npm run visual:baseline`) cannot answer the questions
 * these passes ask. It captures the world as it happens to be framed around the
 * courier, at one moment, with the HUD over it — so "is the plaza paving the
 * generator's disc or a rectangle", "are the density bands actually banded",
 * "where did the framing arcs land", "does any prop touch a tile the player acts
 * on" and "do the shadows agree about where the light is" are all invisible in
 * it. Those are properties of the *plan*, not of the pixels, and the plan is pure
 * and Phaser-free — so it can be drawn directly, with no browser, no dev server
 * and no gameplay.
 *
 * This module rasterizes the planners' own output and the auditors' own verdicts:
 *
 *   1 AUTHORED   — the map's ASCII codes: the ground truth everything derives from
 *   2 DENSITY    — composition bands + cell grid + treeline + framing arcs
 *   3 SURFACE    — path vs plaza vs grass, the paved disc, and which blocking
 *                  tiles still paint a procedural square (the invisible-wall risk)
 *   4 PLAN       — every piece the planner decided to draw, at its visual size
 *   5 CLEARANCE  — reserved tiles, every piece's *contact* footprint, and any
 *                  overlap the audit found
 *   6 LIGHTING   — the shared shadow recipe per piece, and the light direction
 *
 * It is a *renderer of decisions taken elsewhere* and must stay one: it calls
 * `buildTerrainPlan`, `footprintBoxTiles` and `shadowRecipe` and draws what they
 * return. It never re-implements a rule, so a disagreement between this image and
 * the game would be a bug in the game, not two opinions. A value this file does
 * own — a colour, a pixel size — cannot change behaviour.
 *
 * Everything is seeded by tile coordinate and drawn into a plain buffer, so two
 * runs produce byte-identical PNGs (`tests/data/composition-preview.test.ts`).
 *
 * Output: artifacts/composition/<zone>-<n>-<panel>.png, <zone>-sheet.png,
 * manifest.json
 *
 *   npm run composition:render
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { encodePNG } from "./lib/png.mjs";
import { Raster, alpha, hex, stackPanels } from "./lib/raster.mjs";
import {
  buildTerrainPlan,
  GRASS_COVER_CODES,
  isPavedTile,
} from "../src/game/terrainSurface.ts";
import {
  COMPOSITION_CELL,
  DENSITY_MULTIPLIER,
  RESERVED_RADIUS,
  TREE_LINE_BAND,
  reservedTilesFor,
} from "../src/game/terrainComposition.ts";
import { COMPOSITION_BY_ZONE, auditCompositionPlans } from "../src/game/compositionPlans.ts";
import {
  CLOVER_VILLAGE_PROP_SIZING,
  HAPPY_VALLEY_PROP_SIZING,
  PROP_TILE_PX,
  auditReservedClearance,
  footprintBoxTiles,
  footprintWidthPx,
  renderedTiles,
  renderedWidthPx,
} from "../src/game/propSizing.ts";
import { LIGHT_DIRECTION, SHADOW_COLOR, shadowRecipe } from "../src/game/lighting.ts";
import {
  CLOVER_VILLAGE_TERRAIN,
  getCloverVillageSetPieceDefinitions,
} from "../src/game/cloverVillagePlacements.ts";
import {
  HAPPY_VALLEY_TERRAIN,
  getHappyValleySetPieceDefinitions,
} from "../src/game/happyValleyPlacements.ts";

/** Pixels per tile in the rendered panels. */
export const PX_PER_TILE = 8;
const PX = PX_PER_TILE;

/**
 * Tile-code colours, taken from the placeholder tileset palette
 * (`src/game/tilePalette.ts`) so panel 1 reads like the game's own tile art.
 * An unlisted code renders magenta, so a new map code cannot slip in unnoticed.
 */
const CODE_COLORS = {
  G: "#8fc98a",
  P: "#d9b07c",
  F: "#d8b28a",
  W: "#8d7a68",
  "~": "#6fb7d9",
  T: "#4c8f4f",
  B: "#5aa85e",
  X: "#e28bc4",
};

/**
 * Panel 3 palette: the materials actually wired, at their measured averages.
 *
 * `land_1` and `road_5` come from `design/assets` measurements recorded in
 * `terrainAssets.ts`; using the real averages means this panel also shows the
 * luminance question the browser baseline raised (the authored ground is a much
 * darker green than the meadow it replaced).
 */
const SURFACE_COLORS = {
  grass: "#478122",
  patch: "#6b9c3a",
  path: "#ad7d5e",
  paved: "#a3aaab",
  water: "#4f97c4",
  canopyAuthored: "#2f6b3f",
  proceduralBlocking: "#8a3b5a",
  wall: "#8d7a68",
  floor: "#d8b28a",
};

/** Panel 2 palette: open ground through to thicket. */
const DENSITY_COLORS = {
  open: "#f2eecf",
  light: "#c9dc9a",
  normal: "#7fb268",
  dense: "#2b5c37",
};

const MARKERS = {
  cellEdge: alpha(hex("#000000"), 0.22),
  treeline: hex("#d64fae"),
  arc: hex("#ffd24a"),
  fringe: hex("#f0e6a8"),
  patch: hex("#a8d08d"),
  foliageBand: hex("#16412a"),
  foliageCluster: hex("#ffb020"),
  contact: hex("#ffffff"),
  violation: hex("#ff2d2d"),
  reserved: {
    npc: hex("#ff5fa2"),
    spawn: hex("#4ad1ff"),
    transition: hex("#ffd24a"),
    interactable: hex("#9a6bff"),
  },
  lightArrow: hex("#fff3b0"),
};

const SUBLABEL = hex("#8fa08c");

/**
 * The zones this harness can draw.
 *
 * `sizing` and `pieces` are the same tables the game and the size audit use, so
 * panel 5 audits exactly what ships. Map JSON is imported as data rather than
 * through `Maps.ts` because that module also carries runtime formatting.
 */
function loadZoneSources() {
  const map = (name) =>
    JSON.parse(readFileSync(new URL(`../src/data/maps/${name}.json`, import.meta.url), "utf8"));
  const npcs = JSON.parse(
    readFileSync(new URL("../src/data/npcs.json", import.meta.url), "utf8"),
  ).npcs;

  const zone = (id, label, mapName, terrain, sizing, pieces) => {
    const data = map(mapName);
    // The zone's authored plan, read from the same registry the client uses: the
    // panels are meant to show what will be drawn, not what the defaults would
    // have drawn, and the plan must not be readable one way here and another in
    // the game.
    const composition = COMPOSITION_BY_ZONE[`zone-${id}`];
    if (composition === undefined) throw new Error(`no composition plan for ${id}`);
    return {
      id,
      label,
      map: data,
      terrain,
      sizing,
      pieces,
      composition,
      // Mirrors the scene: the map's own spawn/transitions/interactables plus
      // this zone's NPC homes.
      reserved: reservedTilesFor(
        data,
        npcs
          .filter((npc) => npc.homeZone === `zone-${id}`)
          .map((npc) => npc.homeTile),
      ),
    };
  };

  return [
    zone(
      "clover-village",
      "CLOVER VILLAGE",
      "clover-village",
      CLOVER_VILLAGE_TERRAIN,
      CLOVER_VILLAGE_PROP_SIZING,
      getCloverVillageSetPieceDefinitions(),
    ),
    zone(
      "happy-valley",
      "HAPPY VALLEY",
      "happy-valley",
      HAPPY_VALLEY_TERRAIN,
      HAPPY_VALLEY_PROP_SIZING,
      getHappyValleySetPieceDefinitions(),
    ),
  ];
}

/**
 * The pieces a zone's surface renderer actually draws, in the renderer's own
 * coordinate convention: canopy and patches are bottom-anchored on the tile
 * below their coordinate (see `terrainAssets.ts`).
 */
function drawnSurfacePieces(world, plan) {
  const out = [];
  const foliageKeys = world.terrain.foliage ?? [];
  for (const piece of plan.foliage) {
    out.push({
      texture: foliageKeys[piece.variant % (foliageKeys.length || 1)],
      tileX: piece.tileX,
      baseTileY: piece.tileY + 1,
      scale: piece.scale,
      source: piece.source,
    });
  }
  if (world.terrain.patch !== undefined) {
    for (const patch of plan.patches) {
      out.push({
        texture: world.terrain.patch,
        tileX: patch.tileX,
        baseTileY: patch.tileY + 0.5,
        scale: patch.scale,
        source: "patch",
      });
    }
  }
  return out.filter((piece) => world.sizing[piece.texture] !== undefined);
}

/**
 * Rendered size of each forest variant, which the blocking-cover rule needs.
 *
 * Zeroes when a zone has no foliage art (Happy Valley does not yet): the planner
 * then cannot tell what hides what, and reports no cover rather than guessing.
 */
function foliageSizes(world) {
  return (world.terrain.foliage ?? []).map((key) => {
    const spec = world.sizing[key];
    if (spec === undefined) return { tiles: 0, widthTiles: 0 };
    return { tiles: spec.h / PROP_TILE_PX, widthTiles: spec.w / PROP_TILE_PX };
  });
}

/** Everything panel 5 audits: authored art plus the scattered layers. */
function auditedPieces(world, plan) {
  return {
    authored: world.pieces.map((piece) => ({
      texture: piece.texture,
      tileX: piece.tileX,
      baseTileY: piece.baseTileY,
      scale: piece.scale,
      frame: piece.frame,
    })),
    scatter: drawnSurfacePieces(world, plan).map((piece) => ({
      texture: piece.texture,
      tileX: piece.tileX,
      baseTileY: piece.baseTileY,
      scale: piece.scale,
    })),
  };
}

/**
 * The clearance verdicts, from the game's own auditor.
 *
 * Authored art protects NPC/spawn/transition tiles only — dedicated art is
 * *meant* to stand on its own interactable, which the art-parity suite covers
 * separately. The scatter protects everything.
 */
export function clearanceReport(world, plan) {
  const { authored, scatter } = auditedPieces(world, plan);
  return {
    authored: auditReservedClearance(authored, world.sizing, world.reserved, [
      "npc",
      "spawn",
      "transition",
    ]),
    scatter: auditReservedClearance(scatter, world.sizing, world.reserved, [
      "npc",
      "spawn",
      "transition",
      "interactable",
    ]),
  };
}

// --- drawing helpers ---------------------------------------------------------

/** Paint one pixel block per tile, choosing the colour with `colorAt`. */
function paintTiles(raster, width, height, colorAt) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = colorAt(x, y);
      if (color === undefined) continue;
      raster.fillRect(x * PX, y * PX, PX, PX, color);
    }
  }
}

/** Tile bounds of a piece's *visual* silhouette, centred on its anchor. */
function silhouette(piece, spec) {
  const widthTiles = renderedWidthPx(spec.w, piece.scale) / PROP_TILE_PX;
  const heightTiles = renderedTiles(spec.h, piece.scale);
  return { rx: (widthTiles / 2) * PX, ry: (heightTiles / 2) * PX, heightTiles };
}

/** Pixel position of a piece's anchor (base-centre), the way a renderer places it. */
function anchorPx(piece) {
  return { x: piece.tileX * PX, y: piece.baseTileY * PX };
}

/** Draw the visual silhouette of a piece, as a translucent ellipse. */
function drawSilhouette(raster, piece, spec, color) {
  const anchor = anchorPx(piece);
  const box = silhouette(piece, spec);
  raster.fillEllipse(anchor.x, anchor.y - box.ry, box.rx, Math.max(box.ry, 1), color);
}

/** Draw a piece's ground *contact* box (the clearance concept), as an outline. */
function drawContactBox(raster, piece, spec, color, thickness = 1) {
  const anchor = anchorPx(piece);
  const box = footprintBoxTiles(spec, piece.scale);
  const w = box.halfWidth * 2 * PX;
  const x = anchor.x - box.halfWidth * PX;
  const y = anchor.y - box.back * PX;
  const h = (box.back + box.front) * PX;
  raster.strokeRect(x, y, Math.max(w, 2), Math.max(h, 2), thickness, color);
}

// --- panels ------------------------------------------------------------------

function panelAuthored(world) {
  const { map } = world;
  const raster = new Raster(map.width * PX, map.height * PX, hex("#12171a"));
  paintTiles(raster, map.width, map.height, (x, y) => {
    const code = map.rows[y]?.[x];
    if (code === undefined) return undefined;
    return hex(CODE_COLORS[code] ?? "#ff00ff");
  });
  return raster;
}

function panelDensity(world, plan) {
  const { map } = world;
  const raster = new Raster(map.width * PX, map.height * PX, hex("#12171a"));
  paintTiles(raster, map.width, map.height, (x, y) => {
    const cls = plan.density[y]?.[x];
    return cls === undefined ? undefined : hex(DENSITY_COLORS[cls]);
  });

  // Composition-cell grid, so the banding can be read as cells rather than noise.
  for (let x = 0; x <= map.width; x += COMPOSITION_CELL) {
    raster.fillRect(x * PX - 1, 0, 1, raster.h, MARKERS.cellEdge);
  }
  for (let y = 0; y <= map.height; y += COMPOSITION_CELL) {
    raster.fillRect(0, y * PX - 1, raster.w, 1, MARKERS.cellEdge);
  }

  // The treeline band is an override, not a class, so mark its inner boundary.
  const band = TREE_LINE_BAND * PX;
  raster.strokeRect(
    band,
    band,
    map.width * PX - band * 2,
    map.height * PX - band * 2,
    1,
    MARKERS.treeline,
  );

  // Framing arcs: the deliberate planting at each plaza approach.
  for (const cluster of plan.framingClusters) {
    for (const tile of cluster.tiles) {
      raster.strokeRect(tile.x * PX, tile.y * PX, PX, PX, 1, MARKERS.arc);
    }
  }
  return raster;
}

function panelSurface(world, plan) {
  const { map, terrain } = world;
  const covered = new Set(terrain.coveredBlockingCodes ?? []);
  const hidden = plan.coveredBlockingTiles ?? new Set();
  const patches = new Set(plan.patches.map((patch) => `${patch.tileX},${patch.tileY}`));
  const raster = new Raster(map.width * PX, map.height * PX, hex("#12171a"));

  paintTiles(raster, map.width, map.height, (x, y) => {
    const code = map.rows[y]?.[x];
    if (code === undefined) return undefined;
    if (code === "P") {
      return hex(isPavedTile(map, x, y) ? SURFACE_COLORS.paved : SURFACE_COLORS.path);
    }
    if (GRASS_COVER_CODES.has(code)) {
      // `B`/`X` are grass underfoot, so they read as ground with a marker dot.
      const base = patches.has(`${x},${y}`) ? SURFACE_COLORS.patch : SURFACE_COLORS.grass;
      return hex(base);
    }
    if (code === "T") {
      // What the game actually shows: a blocked tile's square is hidden only
      // where the plan put art over it, so this panel is also the audit of the
      // invisible-wall risk — a magenta block here is a solid tile with nothing
      // on it that the courier would walk into.
      const painted = !covered.has(code) || !hidden.has(`${x},${y}`);
      return hex(painted ? SURFACE_COLORS.proceduralBlocking : SURFACE_COLORS.canopyAuthored);
    }
    if (code === "~") return hex(SURFACE_COLORS.water);
    if (code === "W") return hex(SURFACE_COLORS.wall);
    if (code === "F") return hex(SURFACE_COLORS.floor);
    return hex("#ff00ff");
  });

  // Decoration codes get a dot in their palette colour on top of the grass.
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const code = map.rows[y]?.[x];
      if (code !== "B" && code !== "X") continue;
      raster.fillRect(x * PX + PX / 2 - 1, y * PX + PX / 2 - 1, 3, 3, hex(CODE_COLORS[code]));
    }
  }

  // Where the planner laid a grass fringe across the seam.
  for (const fringe of plan.fringes) {
    const x = fringe.tileX * PX;
    const y = fringe.tileY * PX;
    const thickness = 2;
    if (fringe.edge === "n") raster.fillRect(x, y, PX, thickness, MARKERS.fringe);
    if (fringe.edge === "s") raster.fillRect(x, y + PX - thickness, PX, thickness, MARKERS.fringe);
    if (fringe.edge === "w") raster.fillRect(x, y, thickness, PX, MARKERS.fringe);
    if (fringe.edge === "e") raster.fillRect(x + PX - thickness, y, thickness, PX, MARKERS.fringe);
  }
  return raster;
}

function panelPlan(world, plan) {
  const { map } = world;
  const raster = new Raster(map.width * PX, map.height * PX, hex("#2c4a17"));
  paintTiles(raster, map.width, map.height, (x, y) => {
    const code = map.rows[y]?.[x];
    if (code === "P") return hex("#3a3730");
    if (code === "~") return hex("#1d3a4a");
    return undefined;
  });

  for (const piece of drawnSurfacePieces(world, plan)) {
    const spec = world.sizing[piece.texture];
    const color =
      piece.source === "cluster"
        ? alpha(MARKERS.foliageCluster, 0.85)
        : piece.source === "patch"
          ? alpha(MARKERS.patch, 0.75)
          : alpha(MARKERS.foliageBand, 0.85);
    drawSilhouette(raster, piece, spec, color);
  }
  return raster;
}

function panelClearance(world, plan, report) {
  const { map } = world;
  const raster = new Raster(map.width * PX, map.height * PX, hex("#161c17"));

  // Context: the walkable surface, very faint, so overlaps are readable.
  raster.blit(panelSurface(world, plan), 0, 0);
  raster.fillRect(0, 0, raster.w, raster.h, alpha(hex("#0d1210"), 0.62));

  // Reserved tiles, and the margin decoration must keep off.
  for (const tile of world.reserved) {
    const margin = RESERVED_RADIUS * PX;
    raster.strokeRect(
      tile.x * PX - margin,
      tile.y * PX - margin,
      PX + margin * 2,
      PX + margin * 2,
      1,
      alpha(hex("#ffffff"), 0.18),
    );
    raster.fillRect(
      tile.x * PX,
      tile.y * PX,
      PX,
      PX,
      alpha(MARKERS.reserved[tile.kind] ?? hex("#ffffff"), 0.9),
    );
  }

  // Contact footprints of everything drawn: authored art in white, the scattered
  // layers in grey so the two audits stay distinguishable in the image.
  for (const piece of world.pieces) {
    const spec = world.sizing[piece.texture];
    if (spec === undefined || piece.frame !== undefined) continue;
    drawContactBox(raster, piece, spec, alpha(hex("#ffffff"), 0.55));
  }
  for (const piece of drawnSurfacePieces(world, plan)) {
    drawContactBox(raster, piece, world.sizing[piece.texture], alpha(hex("#9ad0ff"), 0.4));
  }

  // Violations, in red, where the auditor said they are.
  const violations = [...report.authored, ...report.scatter];
  for (const piece of [...world.pieces, ...drawnSurfacePieces(world, plan)]) {
    const spec = world.sizing[piece.texture];
    if (spec === undefined) continue;
    const named = violations.some((entry) => entry.startsWith(`${piece.texture}@(`));
    if (!named) continue;
    drawContactBox(raster, piece, spec, MARKERS.violation, 2);
    raster.fillEllipse(piece.tileX * PX, piece.baseTileY * PX, PX, PX, alpha(hex("#ff2d2d"), 0.5));
  }
  return raster;
}

function panelLighting(world) {
  const { map } = world;
  const raster = new Raster(map.width * PX, map.height * PX, hex("#3d6b1c"));

  // Ground reference: the same surface, darkened, so shadows can be judged.
  raster.blit(panelSurface(world, { patches: [], fringes: [] }), 0, 0);
  raster.fillRect(0, 0, raster.w, raster.h, alpha(hex("#0b1208"), 0.35));

  // One shared recipe per piece, from the piece's own footprint width.
  for (const piece of world.pieces) {
    const spec = world.sizing[piece.texture];
    if (spec === undefined || piece.frame !== undefined) continue;
    const recipe = shadowRecipe(footprintWidthPx(spec, piece.scale));
    const anchor = anchorPx(piece);
    raster.fillEllipse(
      anchor.x + recipe.offsetXPx,
      anchor.y + recipe.offsetYPx,
      recipe.widthPx / 2,
      recipe.heightPx / 2,
      alpha(hex("#263b2a"), recipe.alpha),
    );
    drawContactBox(raster, piece, spec, alpha(hex("#ffffff"), 0.25));
  }

  // Cue that reads as the light * arriving from the north-west.
  const size = 5 * PX;
  for (let i = 0; i < size; i += 1) {
    raster.fillRect(PX + i, PX + i, 3, 3, MARKERS.lightArrow);
  }
  raster.fillRect(PX, PX, size, 3, alpha(MARKERS.lightArrow, 0.5));
  raster.fillRect(PX, PX, 3, size, alpha(MARKERS.lightArrow, 0.5));
  return raster;
}

// --- assembly ----------------------------------------------------------------

/** Panel names, in stacked order. Adding a panel means adding it here. */
export const PANEL_NAMES = [
  "authored",
  "density",
  "surface",
  "plan",
  "clearance",
  "lighting",
];

const PANEL_LEGEND = {
  authored: "map tile codes: the ground truth every other panel derives from",
  density: `composition bands, ${COMPOSITION_CELL}-tile cells, treeline band, arcs`,
  surface: "wired materials: path vs paved disc vs grass, fringes, procedural blockers",
  plan: "every piece the planner draws, at its rendered silhouette size",
  clearance: "reserved tiles + margin, contact footprints, audit violations",
  lighting: "shared shadow recipe per piece; light arrives from the north-west",
};

/**
 * The exact colours each panel draws with, as RGBA tuples.
 *
 * Exported so a test can read a rendered panel back and compare it against the
 * planner's own list, rather than trusting the image.
 */
export const PANEL_PALETTES = {
  surface: {
    ...Object.fromEntries(Object.entries(SURFACE_COLORS).map(([name, value]) => [name, hex(value)])),
    // Decoration codes marked with a dot on top of the grass they sit on.
    bush: hex(CODE_COLORS.B),
    flower: hex(CODE_COLORS.X),
  },
  density: Object.fromEntries(
    Object.entries(DENSITY_COLORS).map(([name, value]) => [name, hex(value)]),
  ),
  violation: MARKERS.violation,
};

/**
 * Build every panel for one zone, plus the measured summary.
 *
 * `options.pieces` overrides the zone's authored piece list, which the lighting
 * test uses to render the same zone with no props at all and diff the two — the
 * only way to prove a shadow was painted *by* a piece.
 */
export function buildZonePreview(zoneId, options = {}) {
  const found = loadZoneSources().find((entry) => entry.id === zoneId);
  if (found === undefined) throw new Error(`unknown zone: ${zoneId}`);
  const world = options.pieces === undefined ? found : { ...found, pieces: options.pieces };

  const plan = buildTerrainPlan(world.map, {
    foliage: foliageSizes(world),
    foliageVariants: world.terrain.foliage?.length ?? 1,
    reserved: world.reserved,
    composition: world.composition,
    coveredBlockingCodes: world.terrain.coveredBlockingCodes,
  });
  const report = clearanceReport(world, plan);
  const violations = [...report.authored, ...report.scatter];

  const densityCounts = {};
  for (const cls of Object.keys(DENSITY_MULTIPLIER)) {
    densityCounts[cls] = plan.density.flat().filter((entry) => entry === cls).length;
  }
  const reservedCounts = {};
  for (const tile of world.reserved) {
    reservedCounts[tile.kind] = (reservedCounts[tile.kind] ?? 0) + 1;
  }

  const drawn = drawnSurfacePieces(world, plan);

  // Where the composition came from, so the images say whether a zone is composed
  // by hand or by the shared defaults. `derived` means the entrance arcs were
  // computed from the map's own road mouths rather than authored.
  const authored = {
    regions: world.composition.regions.length,
    entrances: world.composition.entrances?.length ?? 0,
    derived: world.composition.entrances === null,
    cellTiles: world.composition.cellTiles,
    treelineBand: world.composition.treeline.band,
    bands: world.composition.bands,
    scatter: world.composition.scatter,
    blockingCover: world.composition.blockingCover,
    regionsByClass: Object.fromEntries(
      Object.keys(DENSITY_MULTIPLIER).map((cls) => [
        cls,
        world.composition.regions.filter((region) => region.class === cls).length,
      ]),
    ),
  };

  const panels = [
    {
      name: "authored",
      label: `1 ${world.label} AUTHORED`,
      sublabel: `${world.map.width}x${world.map.height} TILES`,
      raster: panelAuthored(world),
    },
    {
      name: "density",
      label: "2 DENSITY",
      sublabel: `${
        authored.derived ? "ARC DERIVED" : `ARC AUTHORED ${authored.entrances}`
      }  REGIONS ${authored.regions}  ${Object.entries(densityCounts)
        .map(([cls, count]) => `${cls} ${count}`)
        .join("  ")}`,
      raster: panelDensity(world, plan),
    },
    {
      name: "surface",
      label: "3 SURFACE",
      sublabel: `PATH ${plan.paths.length}  PAVED ${plan.paved.length}  FRINGE ${plan.fringes.length}  SQUARES KEPT ${plan.uncoveredBlocking.length}`,
      raster: panelSurface(world, plan),
    },
    {
      name: "plan",
      label: "4 PLAN",
      sublabel: `DRAWN ${drawn.length} OF ${plan.foliage.length + plan.patches.length} PLANNED  ARCS ${plan.framingClusters.length}`,
      raster: panelPlan(world, plan),
    },
    {
      name: "clearance",
      label: "5 CLEARANCE",
      sublabel: `${violations.length === 0 ? "CLEAN" : `${violations.length} VIOLATIONS`}  RESERVED ${world.reserved.length}`,
      raster: panelClearance(world, plan, report),
    },
    {
      name: "lighting",
      label: "6 LIGHTING",
      sublabel: `LIGHT ${LIGHT_DIRECTION.x} ${LIGHT_DIRECTION.y}  PIECES ${world.pieces.length}`,
      raster: panelLighting(world),
    },
  ];

  // The stacked order and the documented list are the same list, so a panel
  // cannot be added without naming it (the manifest and the tests key off it).
  if (panels.map((panel) => panel.name).join() !== PANEL_NAMES.join()) {
    throw new Error(
      `panel order ${panels.map((p) => p.name).join()} does not match PANEL_NAMES`,
    );
  }

  return {
    zone: zoneId,
    label: found.label,
    map: { width: world.map.width, height: world.map.height },
    reservedCounts,
    densityCounts,
    authored,
    counts: {
      paths: plan.paths.length,
      paved: plan.paved.length,
      fringes: plan.fringes.length,
      patches: plan.patches.length,
      foliage: plan.foliage.length,
      cover: plan.cover.length,
      /** Suppressed blocking tiles that keep their procedural square instead. */
      squaresKept: plan.uncoveredBlocking.length,
      framingClusters: plan.framingClusters.length,
      setPieces: world.pieces.length,
      // A zone only draws what it authors materials for, so the planned total
      // and the drawn total differ wherever a zone declares no such art. Both
      // are reported so the gap reads as a deliberate zone choice, not a bug.
      drawnPieces: drawn.length,
    },
    /** Which optional surface layers this zone can draw at all. */
    materials: {
      patch: world.terrain.patch !== undefined,
      plaza: world.terrain.plaza !== undefined,
      fringes: world.terrain.fringes !== undefined,
      foliage: (world.terrain.foliage?.length ?? 0) > 0,
    },
    violations,
    legend: PANEL_LEGEND,
    panels,
  };
}

/** Render every zone, write the PNGs and a manifest, and return the manifest. */
export function renderCompositionPreviews(outDirUrl = new URL("../artifacts/composition/", import.meta.url)) {
  const dir = outDirUrl instanceof URL ? outDirUrl : new URL(outDirUrl, import.meta.url);
  mkdirSync(dir, { recursive: true });

  const manifest = { pxPerTile: PX, zones: [] };
  for (const zoneId of loadZoneSources().map((entry) => entry.id)) {
    const preview = buildZonePreview(zoneId);
    preview.panels.forEach((panel, index) => {
      panel.file = `${zoneId}-${index + 1}-${panel.name}.png`;
      writeFileSync(
        new URL(panel.file, dir),
        encodePNG(panel.raster.w, panel.raster.h, Buffer.from(panel.raster.buf.buffer)),
      );
    });
    const sheet = stackPanels(preview.panels);
    const sheetFile = `${zoneId}-sheet.png`;
    writeFileSync(
      new URL(sheetFile, dir),
      encodePNG(sheet.w, sheet.h, Buffer.from(sheet.buf.buffer)),
    );
    manifest.zones.push({
      zone: preview.zone,
      label: preview.label,
      authored: preview.authored,
      map: preview.map,
      sheet: sheetFile,
      counts: preview.counts,
      materials: preview.materials,
      density: preview.densityCounts,
      reserved: preview.reservedCounts,
      violations: preview.violations,
      panels: preview.panels.map((panel) => ({
        name: panel.name,
        file: panel.file,
        size: [panel.raster.w, panel.raster.h],
      })),
    });
  }
  manifest.legend = PANEL_LEGEND;
  writeFileSync(new URL("manifest.json", dir), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1]?.endsWith("render-composition.mjs")) {
  // The plans being drawn are authored content, so a broken or drifted one is a
  // failure here rather than something the pictures quietly paper over.
  const planErrors = auditCompositionPlans();
  if (planErrors.length > 0) {
    console.error(`composition plan validation FAILED:\n  ${planErrors.join("\n  ")}`);
    process.exit(1);
  }
  const manifest = renderCompositionPreviews();
  for (const zone of manifest.zones) {
    console.log(`${zone.label} (${zone.map.width}x${zone.map.height}) -> ${zone.sheet}`);
    console.log(
      `  paved ${zone.counts.paved}  path ${zone.counts.paths}  fringe ${zone.counts.fringes}  patch ${zone.counts.patches}  canopy ${zone.counts.foliage}  arcs ${zone.counts.framingClusters}`,
    );
    console.log(
      `  drawn ${zone.counts.drawnPieces} of ${zone.counts.foliage + zone.counts.patches} planned  materials ${Object.entries(zone.materials).filter(([, on]) => on).map(([name]) => name).join("+") || "base+path only"}`,
    );
    console.log(
      `  bands ${JSON.stringify(zone.density)}  cover ${zone.counts.cover}  squares kept ${zone.counts.squaresKept}`,
    );
    console.log(
      `  authored regions ${zone.authored.regions}  entrances ${zone.authored.entrances} (derived from the map: ${zone.authored.derived ? "yes" : "no"})  cell ${zone.authored.cellTiles}  treeline ${zone.authored.treelineBand}`,
    );
    console.log(
      `  clearance ${zone.violations.length === 0 ? "clean" : zone.violations.join(" | ")}`,
    );
  }
  console.log("wrote 6 panels + a sheet per zone, and manifest.json, in artifacts/composition/");
}
