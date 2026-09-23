# Paws & Parcels — Engine Evaluation (2.5D → 3D paths)

> Companion docs: [`decisions.md`](decisions.md) (the 2.5D lock this document amends),
> [`BuildPlan.md`](../BuildPlan.md), [`architecture.md`](architecture.md).
> Status: ✅ evaluated 2026-09-17. **Recommended path: A — Isometric Phaser.**
> This document is the "separate engine-evaluation decision" that
> [`decisions.md`](decisions.md) §0 requires before any true-3D work may start.

---

## 1. Why the 2.5D lock exists

`decisions.md` locks the first online milestone to isometric/pseudo-3D on Phaser 4 and
explicitly blocks a true 3D engine behind this evaluation. The reasoning: Phaser 4 is the
proven client stack, 2D sprites keep the cozy art identity and the Aseprite/JSON-atlas
pipeline intact, and an engine swap would block every other milestone. Any 3D move must
therefore justify itself against that lock.

## 2. What is already renderer-agnostic (reusable on every path)

- **Entire server** (`server/src/`): authoritative movement, combat, quests, inventory,
  admin, AI — all reason in logical tile coordinates; no renderer coupling.
- **WS protocol** (`network-protocol.md`): 13 C→S intents + 15 S→C frames carry logical
  coordinates only. A 3D client consumes it unchanged.
- **DOM-over-canvas UI**: dialogue, HUD, chat, minimap, courier desk, and the whole admin
  panel are HTML/CSS and survive any engine swap.
- **Auth (ASHAT Hub OIDC), SQLite schema, build/test/deploy pipeline.**

## 3. What is 2D-coupled (the actual work)

- `src/scenes/` + `src/game/` — Phaser tilemaps, `WorldDepth` y-sorting, procedural tile
  textures, placement tables for both zones.
- `src/entities/` — sprite-based Player/NPC/Monster/RemotePlayer rendering.
- Art pipeline — 2D cutouts and sheets (~1.8 GB reference archive); a true-3D path needs
  models or billboarded 2.5D sprites (the current cutout art suits billboards well).
- Input — 3D needs camera control + raycast targeting design on top of WASD/touch.

## 4. Path A — Isometric Phaser 4 ✅ RECOMMENDED

**Swap the projection, keep everything else.** Render the existing tile-based world on an
isometric grid (2:1 diamond tiles) with the existing depth-sorting replaced by
depth-from-grid-position; sprites stay 2D.

- **Pros:** honors the locked 2.5D decision (this *is* the "isometric/pseudo-3D" it
  names); zero server/protocol change; existing art reads perfectly on an iso grid;
  smallest scope — confined to `src/scenes`, `src/game` (tile→screen math, camera
  bounds, picking) and map-authoring coordinates; mobile performance stays comfortable.
- **Cons:** not "true 3D" — no free camera rotation, no verticality beyond fake
  elevation.
- **Server/protocol impact:** none. Coordinates stay tile-based `(x, y)`; the client
  derives screen position via the iso projection.
- **Effort:** moderate, client-only. Fits inside the existing Phase 7 "2.5D Presentation"
  milestone — it can even ride along with the depth-sorting work already planned there.
- **Risks:** map authoring/collision stays in tile space while rendering is projected —
  mitigated because collision is already authoritative server-side in the ASCII maps;
  pointer-picking needs a screen→tile inverse transform.

## 5. Path B — Three.js rendering layer (taken, 2026-09-22)

Keep game state and DOM UI; replace the renderer with Three.js using billboard sprites
first, real models later. Requires amending `decisions.md`.

> **Status: adopted.** The owner directed this path on 2026-09-22 after the 2D visual
> passes (1–6) ran out of headroom for the 3/4 camera presence the product targets, and
> `decisions.md` §0 now carries the amendment this section reserved. What shipped is a
> hybrid of the plan above: Phaser keeps input, the scene graph, entities, the network
> systems and the DOM HUD, and three.js draws only the world (billboard cutouts on a
> locked 3/4 camera). The prediction below — "rewrites `src/scenes`/`src/game`/
> `src/entities` entirely" — did **not** come true, because the renderer was built behind
> a `worldView` seam instead of replacing the sprite path; `?renderer=2d` still runs the
> sprite world. The other predictions held: a second rendering mental model is now in the
> codebase, the main chunk grew to ~2.19 MB (three is ~600 kB of it, not yet code-split),
> and raycast/mouse targeting and 3D assets remain open. Worth revisiting Path C only if
> real models and elevation become core, which they are not today.

- **Pros:** unlocks real 3D (camera, lighting, elevation) while reusing server, protocol,
  and UI; billboard-first migration keeps the current art usable.
- **Cons:** rewrites `src/scenes`/`src/game`/`src/entities` entirely; a second rendering
  mental model (scene graph vs. Phaser display list); bigger bundle on top of the
  already 1.6 MB main chunk; camera controls and raycast targeting are new design
  surfaces; art pipeline eventually needs 3D assets.
- **Server/protocol impact:** none, but coordinate conventions (elevation, camera) would
  eventually want protocol additions.
- **When to choose it:** if/when the product goal shifts to true 3D presentation and the
  Phase 7 milestone is complete — a clean re-render boundary after Phase 7 is the
  cheapest entry point.

## 6. Path C — Full engine swap (Godot/Unity web) ❌ not recommended

- **Cons:** discards the DOM-over-canvas UI architecture and the whole client codebase;
  restarts the asset pipeline; web export + single-process hosting model needs rework;
  largest risk to the cozy identity mid-pivot. Only worth it if 3D becomes a core
  product pillar, which it is not today.

## 7. Decision

- **Path A was adopted first, and shipped** (visual Passes 1–6: one world zoom, prop size
  bands, authored composition bands, named depth bands with a foreground layer, one shadow
  recipe, entity sizing). Those passes remain in force: they are authored in shared,
  renderer-agnostic modules, and the 3D renderer consumes them rather than replacing them.
- **Path B was then adopted by owner directive on 2026-09-22** (see §5), which lifted the
  §0 block through an explicit amendment rather than leaving it to a follow-up milestone.
  This document stays the evaluation baseline: any future engine question cites §5–§7.
- **Path C remains not recommended** and blocked on a further §0 amendment.
