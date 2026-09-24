/**
 * The quest compass — where the courier should head next, and how to draw it.
 *
 * Pure on purpose. Everything that decides *what* the arrow points at, how far
 * away that is, what the label reads and how the minimap marker pulses lives
 * here, so the guidance rule is unit-testable without a scene, a canvas or a
 * renderer. The scene supplies the two tiles and its courier's on-screen spot;
 * this module supplies the answer.
 *
 * The destination is the same "next step" the tracker already shows, resolved
 * from server quest state: a search quest whose objective has not been found
 * yet points at its authored search object (the tracker's own rule —
 * `searchObjectId !== null && progress === 0`), otherwise at the target NPC.
 * Nothing here invents navigation for a quest the server has not given us, and
 * a target in another zone returns null rather than pointing at a wall.
 */

/** A position in tiles (fractional allowed). */
export interface TilePoint {
  x: number;
  y: number;
}

/** A position in canvas space, as a fraction of the play area (0–1). */
export interface CanvasFraction {
  x: number;
  y: number;
}

/** Where the arrow should point, and what to call it. */
export interface CompassDestination {
  id: string;
  label: string;
  kind: "npc" | "object" | "exit";
  tile: TilePoint;
}

/** The compass drops out this close — a marker on top of you is noise. */
export const COMPASS_NEAR_TILES = 1.5;

/**
 * How far ahead of the courier the arrow floats, in internal canvas pixels
 * (the 960×540 space). Small enough to read as attached to the courier, far
 * enough not to cover them or their name tag.
 */
export const COMPASS_OFFSET_PX = 40;

/** The arrow's own box, in internal canvas pixels — also its edge margin. */
export const COMPASS_SIZE_PX = 28;

/** What the arrow can be told about one quest. */
export interface ActiveQuest {
  state: string;
  giverId: string;
  targetId: string | null;
  searchObjectId: string | null;
  progress: number;
  defeat?: { monsterKey: string; count: number } | null;
  additionalStops?: readonly string[];
  visitedStops?: readonly string[];
}

/** A zone's exits and monster spawns, as `src/data/maps/*.json` authors them. */
export interface ZoneMap {
  id: string;
  transitions: readonly { id: string; label: string; x: number; y: number; toZone: string }[];
  monsterSpawns?: readonly { key: string }[];
}

/** A quest with the ordering fields, so the next one to take can be picked. */
export interface OrderedQuest extends ActiveQuest {
  chainPosition: number;
  sideQuest: boolean;
}

/** How the guidance is being used, which is worth distinguishing for tests. */
export type GuidanceReason = "objective" | "giver";

/** An authored villager, as `src/data/npcs.json` defines one. */
export interface NpcPlacement {
  id: string;
  name: string;
  homeZone: string;
  homeTile: TilePoint;
}

/** An authored map object the courier can interact with. */
export interface ObjectPlacement {
  id: string;
  label: string;
  x: number;
  y: number;
}

/**
 * Resolve the next stop, or null when there is nothing to point at here.
 *
 * Two cases, in priority order:
 *
 * 1. **A quest in progress.** Point at its next step: an unfinished hunt's
 *    zone exit (nothing, once in that zone), the authored search object while
 *    the objective is still missing, the next unvisited delivery stop, otherwise
 *    the target villager.
 * 2. **Nothing in progress.** A brand-new courier has no active quest — the
 *    first thing they need is the villager who hands one out, so point at the
 *    giver of the earliest available chain quest. Without this the arrow would
 *    be dark for exactly the player it was added for. Once the chain is done,
 *    the nearest giver of an available side quest.
 *
 * A destination that resolves in another zone yields null rather than a
 * direction that means nothing here.
 */
export function questDestination(input: {
  active: ActiveQuest | null | undefined;
  /** Every quest the server has sent, for the "go accept one" case. */
  quests?: readonly OrderedQuest[];
  zoneId: string;
  npcs: readonly NpcPlacement[];
  objects: readonly ObjectPlacement[];
  /** The courier's position, to pick the nearest side-quest giver. */
  from?: TilePoint;
  /** Every playable zone, to route a hunt toward where its monster lives. */
  maps?: readonly ZoneMap[];
}): { destination: CompassDestination; reason: GuidanceReason } | null {
  const { active, zoneId, npcs, objects } = input;

  if (active !== null && active !== undefined && active.state === "active") {
    const defeat = active.defeat ?? null;
    const maps = input.maps ?? [];
    const here = maps.find((zone) => zone.id === zoneId);
    if (defeat !== null && active.progress < defeat.count && here !== undefined) {
      const hosts = (zone: ZoneMap): boolean => (zone.monsterSpawns ?? []).some((spawn) => spawn.key === defeat.monsterKey);
      if (hosts(here)) return null;
      const exit = here.transitions.find((transition) => maps.some((zone) => zone.id === transition.toZone && hosts(zone)));
      return exit === undefined
        ? null
        : {
            destination: { id: exit.id, label: exit.label, kind: "exit", tile: { x: exit.x, y: exit.y } },
            reason: "objective",
          };
    }
    // A search objective the courier has not found yet is the next step, even
    // though the quest's targetId already names the villager it returns to.
    if (active.searchObjectId !== null && active.progress === 0) {
      const object = objects.find((candidate) => candidate.id === active.searchObjectId);
      if (object !== undefined) {
        return {
          destination: { id: object.id, label: object.label, kind: "object", tile: { x: object.x, y: object.y } },
          reason: "objective",
        };
      }
    }
    const nextStop = (active.additionalStops ?? []).find((stop) => !(active.visitedStops ?? []).includes(stop));
    const targetId = nextStop ?? active.targetId;
    if (targetId === null) return null;
    const target = npcs.find((npc) => npc.id === targetId && npc.homeZone === zoneId);
    return target === undefined
      ? null
      : {
          destination: { id: target.id, label: target.name, kind: "npc", tile: { ...target.homeTile } },
          reason: "objective",
        };
  }

  // The earliest chain quest still to be taken; optional errands never jump the
  // queue ahead of the tutorial the village is built around.
  const quests = input.quests ?? [];
  const next = quests
    .filter((quest) => quest.state === "available" && !quest.sideQuest)
    .sort((a, b) => a.chainPosition - b.chainPosition)[0];
  const chainDone = quests.some((quest) => !quest.sideQuest) && quests.every((quest) => quest.sideQuest || quest.state === "completed");
  const giverIds = next !== undefined
    ? [next.giverId]
    : chainDone
      ? quests.filter((quest) => quest.state === "available").map((quest) => quest.giverId)
      : [];
  const from = input.from;
  const giver = npcs
    .filter((npc) => giverIds.includes(npc.id) && npc.homeZone === zoneId)
    .sort((a, b) => (from === undefined ? 0 : compassDistanceTiles(from, tileCentre(a.homeTile)) - compassDistanceTiles(from, tileCentre(b.homeTile))))[0];
  return giver === undefined
    ? null
    : {
        destination: { id: giver.id, label: giver.name, kind: "npc", tile: { ...giver.homeTile } },
        reason: "giver",
      };
}

/**
 * A tile index as a point on the continuous tile grid.
 *
 * The world mixes the two: authored content (`homeTile`, map objects) names a
 * tile by index, while a courier's position is continuous tile units where the
 * index `n` covers `[n, n+1)`. Comparing them without this conversion is a
 * half-tile error — enough to mislabel a distance, and enough to make the
 * compass disappear while the courier is still a couple of tiles short.
 */
export function tileCentre(tile: TilePoint): TilePoint {
  return { x: tile.x + 0.5, y: tile.y + 0.5 };
}

/**
 * Ground distance in tiles (straight line; the village is open ground), between
 * two points on the continuous tile grid.
 */
export function compassDistanceTiles(from: TilePoint, to: TilePoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** False once the courier is close enough to see the target for themselves. */
export function shouldShowCompass(distanceTiles: number): boolean {
  return distanceTiles > COMPASS_NEAR_TILES;
}

/**
 * The arrow's rotation, from a ground delta in tiles.
 *
 * Canvas convention (y grows downward): 0 points east/right, +π/2 points
 * south/down — exactly what a CSS rotation wants, and the direction the compass
 * icon is authored in.
 *
 * `foreshortening` is how much the renderer compresses the north/south axis: 1
 * for the top-down sprite renderer, `sin(pitch)` for the 3/4 3D camera. Using
 * the ground delta rather than two projected points means a destination far
 * south of the courier keeps pointing south even where a perspective projection
 * would fold it back over the horizon.
 */
export function groundCompassAngle(dx: number, dy: number, foreshortening = 1): number {
  return Math.atan2(dy * foreshortening, dx);
}

/**
 * Where the arrow floats: one offset from the courier along the bearing.
 *
 * `origin` is in fraction space and the offset in internal canvas pixels, so
 * the offset is resolved per axis — on a 16:9 canvas, the same *pixel* nudge
 * is a different fraction of width and height, and treating them as equal
 * would trail the arrow off-axis.
 */
export function compassArrowPoint(
  origin: CanvasFraction,
  angleRad: number,
  canvas: { width: number; height: number },
  offsetPx = COMPASS_OFFSET_PX,
): CanvasFraction {
  return {
    x: origin.x + (Math.cos(angleRad) * offsetPx) / canvas.width,
    y: origin.y + (Math.sin(angleRad) * offsetPx) / canvas.height,
  };
}

/**
 * Keep the arrow inside the play area, in *fraction* space.
 *
 * The courier can stand in a corner, and the arrow hangs ahead of them — so a
 * clamped position is what stops the guidance from being drawn off-screen in
 * exactly the places a new player is most likely to be lost.
 */
export function clampToCanvas(
  point: CanvasFraction,
  marginPx: number,
  canvas: { width: number; height: number },
): CanvasFraction {
  const marginX = marginPx / canvas.width;
  const marginY = marginPx / canvas.height;
  return {
    x: Math.min(1 - marginX, Math.max(marginX, point.x)),
    y: Math.min(1 - marginY, Math.max(marginY, point.y)),
  };
}

/** The arrow's caption: who it is, and how far. */
export function compassLabel(destination: CompassDestination, distanceTiles: number): string {
  const rounded = Math.round(distanceTiles);
  if (rounded <= 0) return `${destination.label} · here`;
  return `${destination.label} · ${rounded} tile${rounded === 1 ? "" : "s"}`;
}

/** One pulse period of the minimap's quest marker. */
export const QUEST_MARKER_PERIOD_MS = 1400;

/**
 * The minimap marker's expanding ring: a radius in tiles and an alpha, both
 * driven by elapsed ms so the pulse is deterministic and testable rather than
 * a random per-frame wobble.
 */
export function questMarkerPulse(elapsedMs: number): { radiusTiles: number; alpha: number } {
  const phase = ((elapsedMs % QUEST_MARKER_PERIOD_MS) + QUEST_MARKER_PERIOD_MS) % QUEST_MARKER_PERIOD_MS / QUEST_MARKER_PERIOD_MS;
  return { radiusTiles: 2.2 + 2.6 * phase, alpha: 0.75 * (1 - phase) };
}
