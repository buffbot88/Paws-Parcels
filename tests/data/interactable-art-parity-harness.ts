import { describe, expect, it } from "vitest";
import type { TerrainMaterials } from "../../src/game/terrainAssets.ts";

/**
 * Shared interactable-art parity harness: every mapped zone's interactable
 * must have DEDICATED set-piece art (not just any nearby decor) within the
 * adjacency radius, so a new map cannot ship interactables that render as
 * bare marker circles. Zones opt in via describeInteractableArtParity.
 */

/** Minimal structural shape of a map's interactable entries. */
interface ParityInteractable {
  id: string;
  x: number;
  y: number;
}

/** Minimal structural shape of a set-piece placement definition. */
interface ParityPlacement {
  texture: string;
  frame?: string;
  tileX: number;
  baseTileY: number;
}

export interface InteractableArtParitySpec {
  /** Display name used in describe titles and failure messages. */
  mapName: string;
  /** The zone's interactables, straight from its map JSON. */
  interactables: readonly ParityInteractable[];
  /** Every texture key the zone's placements module declares. */
  allTextureKeys: readonly string[];
  /** Texture keys drawn by dedicated surface code, never set pieces. */
  surfaceKeys?: readonly string[];
  /** Interactable id → the texture(s) that visually embody it. */
  artMappings: Readonly<Record<string, readonly string[]>>;
  /** The zone's set-piece placements. */
  definitions: readonly ParityPlacement[];
  /**
   * Sheet-frame registry (frame name → rect) for multi-item textures; when
   * provided, frame placements and registrations are cross-checked.
   */
  sheetFrames?: Readonly<Record<string, unknown>>;
}

function nearestPlacement(
  definitions: readonly ParityPlacement[],
  textureKeys: readonly string[],
  x: number,
  y: number,
): { texture: string; distance: number } | null {
  let best: { texture: string; distance: number } | null = null;
  for (const def of definitions) {
    if (!textureKeys.includes(def.texture)) continue;
    const distance = Math.hypot(def.tileX - x, def.baseTileY - y);
    if (!best || distance < best.distance) {
      best = { texture: def.texture, distance };
    }
  }
  return best;
}

/** How close (in tiles) the dedicated art must sit to its interactable. */
const ADJACENCY_TILES = 4;

/**
 * The texture keys a zone's terrain materials draw directly, for a zone's
 * `surfaceKeys`. Derived from the material set so adding a terrain piece cannot
 * register as a dead set-piece key.
 *
 * Foliage is deliberately EXCLUDED: a zone wires the same decor art both as
 * canopy cover and as curated set pieces, so those keys must still be proven to
 * appear in the world by the placement check.
 */
export function terrainSurfaceKeys(materials: TerrainMaterials): readonly string[] {
  const keys: string[] = [materials.base, materials.path];
  if (materials.patch !== undefined) keys.push(materials.patch);
  if (materials.plaza !== undefined) keys.push(materials.plaza);
  for (const variants of Object.values(materials.fringes ?? {})) keys.push(...variants);
  return keys;
}

/** Emit the standard interactable-art parity suite for one zone. */
export function describeInteractableArtParity(spec: InteractableArtParitySpec): void {
  const surfaceKeys = new Set(spec.surfaceKeys ?? []);
  const definitions = spec.definitions;

  describe(`${spec.mapName} — interactable/art parity`, () => {
    it("every interactable id has a declared art mapping", () => {
      const missing = spec.interactables
        .filter((interactable) => !spec.artMappings[interactable.id])
        .map((interactable) => interactable.id);
      expect(missing).toEqual([]);
    });

    it("every declared art mapping refers to a real interactable", () => {
      const interactableIds = new Set(spec.interactables.map((i) => i.id));
      const unknown = Object.keys(spec.artMappings).filter((id) => !interactableIds.has(id));
      expect(unknown).toEqual([]);
    });

    it("each interactable has dedicated art within the adjacency radius", () => {
      const problems: string[] = [];
      for (const interactable of spec.interactables) {
        const keys = spec.artMappings[interactable.id];
        if (!keys) continue; // reported by the first test
        const placement = nearestPlacement(definitions, keys, interactable.x, interactable.y);
        if (!placement) {
          problems.push(
            `${interactable.id}@(${interactable.x},${interactable.y}) — no art for ${keys.join("|")}`,
          );
        } else if (placement.distance > ADJACENCY_TILES) {
          problems.push(
            `${interactable.id}@(${interactable.x},${interactable.y}) — nearest ${placement.texture} is ${placement.distance.toFixed(2)} tiles away`,
          );
        }
      }
      expect(problems).toEqual([]);
    });

    it("every mapped texture key actually has at least one placement", () => {
      const placed = new Set(definitions.map((d) => d.texture));
      const unplaced = new Set<string>();
      for (const keys of Object.values(spec.artMappings)) {
        for (const key of keys) if (!placed.has(key)) unplaced.add(key);
      }
      expect([...unplaced]).toEqual([]);
    });

    it("every declared texture key has at least one placement (no dead keys)", () => {
      const placed = new Set(definitions.map((d) => d.texture));
      const dead = spec.allTextureKeys.filter((key) => !placed.has(key) && !surfaceKeys.has(key));
      expect(dead).toEqual([]);
    });

    if (spec.sheetFrames !== undefined) {
      const registered = new Set(Object.keys(spec.sheetFrames));

      it("every sheet-frame placement refers to a registered frame", () => {
        const unregistered = [
          ...new Set(
            definitions
              .filter((d) => d.frame !== undefined)
              .map((d) => d.frame as string)
              .filter((frame) => !registered.has(frame)),
          ),
        ];
        expect(unregistered).toEqual([]);
      });

      it("every registered frame is used by at least one placement", () => {
        const used = new Set(definitions.map((d) => d.frame).filter(Boolean));
        const orphaned = [...registered].filter((frame) => !used.has(frame));
        expect(orphaned).toEqual([]);
      });
    }
  });
}
