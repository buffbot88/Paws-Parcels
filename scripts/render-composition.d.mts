/** A zone's dense list of measurements, as reported beside every panel. */
export interface ZoneCounts {
  paths: number;
  paved: number;
  fringes: number;
  patches: number;
  foliage: number;
  framingClusters: number;
  setPieces: number;
  drawnPieces: number;
}

/** Which optional surface layers a zone authors art for. */
export interface ZoneMaterials {
  patch: boolean;
  plaza: boolean;
  fringes: boolean;
  foliage: boolean;
}

/**
 * The authored plan the panels were drawn from, reported beside them.
 * `derived` means the entrance arcs came from the map's own road mouths rather
 * than from the plan, and `regionsByClass` counts painted regions per band.
 */
export interface ZoneAuthored {
  regions: number;
  entrances: number;
  derived: boolean;
  cellTiles: number;
  treelineBand: number;
  bands: Record<string, number>;
  scatter: Record<string, number>;
  blockingCover: { minHeightTiles: number };
  regionsByClass: Record<string, number>;
}

/** One rendered panel: its own buffer plus the label drawn above it. */
export interface PreviewPanel {
  name: string;
  label: string;
  sublabel: string;
  raster: { w: number; h: number; buf: Uint8Array };
  /** Filled in by the write pass only. */
  file?: string;
}

export interface ZonePreview {
  zone: string;
  label: string;
  map: { width: number; height: number };
  authored: ZoneAuthored;
  reservedCounts: Record<string, number>;
  densityCounts: Record<string, number>;
  counts: ZoneCounts;
  materials: ZoneMaterials;
  violations: string[];
  legend: Record<string, string>;
  panels: PreviewPanel[];
}

export interface PreviewManifest {
  pxPerTile: number;
  zones: {
    zone: string;
    label: string;
    map: { width: number; height: number };
    authored: ZoneAuthored;
    sheet: string;
    counts: ZoneCounts;
    materials: ZoneMaterials;
    density: Record<string, number>;
    reserved: Record<string, number>;
    violations: string[];
    panels: { name: string; file: string; size: [number, number] }[];
  }[];
  legend: Record<string, string>;
}

/** Panel names, in the order they are stacked. */
export const PANEL_NAMES: readonly string[];

/**
 * The exact colours each panel draws with, so a test can read an image back.
 * Tuples are RGBA.
 */
export const PANEL_PALETTES: {
  surface: Record<string, readonly number[]>;
  density: Record<string, readonly number[]>;
  violation: readonly number[];
};

/** Pixels per tile in every rendered panel. */
export const PX_PER_TILE: number;

/** The clearance verdicts, from the game's own auditor. */
export function clearanceReport(
  world: unknown,
  plan: unknown,
): { authored: string[]; scatter: string[] };

/**
 * Build every panel for one zone. `options.pieces` overrides the zone's authored
 * piece list (the lighting test renders the same zone with none, to diff).
 */
export function buildZonePreview(
  zoneId: string,
  options?: { pieces?: readonly unknown[] },
): ZonePreview;

/** Render every zone, write the PNGs and a manifest, and return the manifest. */
export function renderCompositionPreviews(outDirUrl?: URL | string): PreviewManifest;
