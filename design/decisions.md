# Paws & Parcels — Locked Design Decisions

> **Source of truth for implementation.** Updated for the **online 2.5D MMORPG pivot**
> (Phase 3.5, 2026-08-03). If any task conflicts with these decisions, stop and ask.
> Each decision lists **Decision · Reason · Consequences · Status**.
> Status markers: ✅ built · ⏭ next · ⬜ planned · ⚠ blocked or undecided · 🗃 archived
>
> The former single-player decisions document was retired when this online plan became authoritative.

---

## 0. Rendering & 2.5D Presentation

### 2.5D target — isometric/pseudo-3D on Phaser 4
- **Decision:** The first online milestone renders the world as **isometric 2D / pseudo-3D**:
  Phaser 4 client, 2D character/monster/NPC sprites, **depth sorting**, and tile-based
  logical coordinates. **No full 3D engine** (Three.js/Unity/Godot) is used in the first
  online milestone.
- **Reason:** Phaser 4 is already the proven client stack (Phases 0–3 shipped on it); 2D
  sprites keep the cozy art identity and the content pipeline (Aseprite sheets, JSON
  atlases) intact. An engine swap would block every other milestone.
- **Consequences:** Depth sorting is a first-class rendering requirement (Phase 7); a true
  3D engine, if ever required, needs a **separate engine-evaluation decision** and is
  blocked until then (⚠).
- **Status:** ✅ decided (documented, Phase 0 of new plan).

### Coordinate systems (explicitly distinct)
- **Decision:** Three coordinate concepts are kept separate everywhere:
  - **Logical/server coordinates:** tile-based `(x, y)` per zone, authoritative in SQLite.
  - **Client screen coordinates:** pixels for rendering; derived from logical + camera.
  - **Render depth/order:** draw order within a tile (e.g. `y`-sorted + sprite layer).
- **Reason:** Server-authoritative movement requires the server to reason in the same
  tile space the maps were designed in; conflating screen/depth with logical coords is
  the classic source of desync and collision bugs.
- **Consequences:** The protocol (`move_intent`, `player_snapshot`) carries logical
  coordinates only; clients own screen mapping and depth sorting.
- **Status:** ✅ decided.

### Viewport & tiles (retained from single-player)
- **Decision:** Game resolution **960×540 (16:9)**, Phaser `Scale.FIT` + `CENTER_BOTH`,
  min width 320px. Tile size **48×48**. Visible area ≈ 20×11.25 tiles.
- **Reason:** Locked in Phase 0 and shipped through Phase 3; no reason to change for the
  pivot.
- **Consequences:** Map authoring continues in tile units; viewport stays.
- **Status:** ✅ built.

### The camera frames the courier, it does not centre them
- **Decision:** The world camera carries two framing rules, both in
  `src/game/cameraFraming.ts` and both applied to the *focus point* rather than
  to the world: the focus sits **9% of the viewport height above the courier**, so
  the courier renders below centre and the world ahead gets more of the frame, and
  while the courier walks the focus **leads the direction of travel by up to 0.6
  tiles**, eased at 4.5/s so it settles when they stop. One value set for every
  zone, and `prefers-reduced-motion` keeps the bias while dropping the lead.
- **Reason:** Pass 1 settled the camera's *scale* (one zoom, ~18×10 tiles) and then
  handed it straight to `startFollow`, which centres the target exactly. A dead
  centre gives the ground already walked exactly as much of the viewport as the
  world ahead — the "flat tile field seen from far away" reading the overhaul
  exists to remove — and it is the half of the reference camera that a 2D client
  can take without tilting the projection (which would need new art and a different
  collision space, and is recorded as blocked on art, not on code).
- **Consequences:** The courier sits ~49 screen px below centre at 960×540 — the
  figure is a fraction of the viewport, not a fixed offset, so it holds at any
  window size and any zoom, and the offset is expressed in world units
  (`bias / zoom`) because that is what `setFollowOffset` takes. The lead is capped
  at a fraction of one tile, so the camera can never run ahead of the player. The
  easing is exponential (frame-rate independent) rather than a per-frame lerp, so a
  144 Hz client does not settle the camera faster than a 60 Hz one. Framing is
  rendering only: no courier position, collision, or presence is touched.
  **Open question (⚠):** whether the world *should* tilt. A true 3/4 projection is
  the remaining half of the reference camera and needs art authored at that angle;
  this pass is the part that does not.
- **Status:** ✅ built (`tests/data/camera-framing.test.ts` 16 cases: the bias is
  zoom-invariant and viewport-relative, the lead is equal in every direction and
  inside its clamp, the easing is monotonic and frame-rate independent, and reduced
  motion keeps the composition; `tests/e2e/movement.spec.ts` → "frames the courier
  below centre and leads the walk" measures it in a live browser — the courier
  renders 9% of the viewport height below centre while idle, the follow offset leads
  0.6 tiles while walking north and west, and unwinds to the idle bias when the key
  is released). Whether the courier sits at the right height in the frame, and
  whether the lead reads as anticipation rather than lag, is
  `REQUIRES SEELLE/BROWSER VERIFICATION` — the numbers are small on purpose.

### Prop size bands — one scale convention, in tiles
- **Decision:** Every placed prop declares an intended rendered height **in tiles**,
  measured as `sourceHeightPx * scale / 48`, and belongs to a named band (`decal`,
  `propSmall`, `propMedium`, `propTall`, `structure`, `canopy`, `building`, `landmark`,
  `surface`). The courier is the yardstick: class idle frames render **1.0 tile**, so one
  tile is one courier. The bands live in `src/game/propSizing.ts` and every placement in
  both zones is audited against them in `tests/data/prop-sizing.test.ts`.
- **Reason:** Each prop previously carried a bare `scale:` literal with no convention
  behind it — the entity classes disagreed with each other too (courier 1.33, NPC art
  0.095, monsters 1.1) — so "the props don't all feel like the same world" could neither
  be proven nor fixed. The audit immediately found real defects: a grass tuft drawn at
  4.65 tiles (taller than the canopy trees and larger than the shop), trees at 3.1–3.5
  tiles (below the buildings), the pond art at four different sizes (2.13–3.42 tiles)
  from one file, and a 2.5-tile flower front.
- **Consequences:** New props and art packs must declare a sizing row; the Post Office
  stays the tallest thing in the village and the canopy stays above every shrub, both
  asserted. `scripts/downscale-clover-valley-props.mjs` derives its factors from these
  placements, so it is now a dry run by default, requires `--write` to apply, and refuses
  to upscale art whose rendered size grew — the change that would otherwise silently undo
  a hand-tuned scale. **Open question (⚠):** the valley's own pack is authored about a
  third of the village's size for equivalent objects (its "tree" renders ~1.8 tiles
  against the village's 5.4); no single zone's audit can catch that, and it is left as a
  deliberate choice rather than silently rescaled.
- **Status:** ✅ built (Pass 3). Final judgement of how the sizes *look* is
  `REQUIRES SEELLE/BROWSER VERIFICATION`.

### Composition bands — deliberate density instead of even scatter
- **Decision:** The scattered layers (canopy, grass islands) draw their odds from a
  **composition plan** (`src/game/terrainComposition.ts`), not from one probability applied
  to every eligible tile. 12×12-tile cells take a seeded density class (open / light /
  normal / dense, with west-neighbour adoption so classes form regions), the outer five
  tiles of every map are always the **treeline**, and each way into the plaza gets a
  **framing cluster** — an arc of planting on the grass just outside the mouth. NPCs, the
  spawn, transitions and interactables are **reserved**: no decoration lands on them or
  within two tiles, and a framing cluster outranks the scatter it would displace.
- **Reason:** Even odds cannot compose a place — they produced the "sparse in some areas
  and cluttered in others" note, because a uniform probability has no way to make a
  clearing or a thicket. Measured on the generated village the bands give 0.000 / 0.024 /
  0.051 / 0.099 canopy pieces per tile (open → dense), and the boundary treeline has no
  gap wider than 1.41 tiles against a 1.6 tile spacing floor.
- **Consequences:** Zone decoration must declare its reserved set (`reservedTilesFor`); a
  new zone with a plaza automatically gets framed entrances. Grass islands remain
  spacing-limited, so their counts barely move with the band — recorded rather than
  papered over.
- **Status:** ✅ built (Pass 4).

### Depth bands and a foreground layer
- **Decision:** Depth offsets are **named** (`DEPTH_OFFSET.contactShadow / piece /
  overlay` in `WorldDepth.ts`) instead of bare literals, and pieces the courier walks
  *under* — the southern entrance arch and the canopy trees framing the square — are
  placed on a **foreground layer** (`foregroundDepth`, base 400) that draws above every
  entity on every map while still Y-sorting within itself. Terrain gains restrained
  **edge darkening**: three stepped bands of decreasing alpha (0.085 → 0.022) at the map
  boundary, drawn above the terrain stack and far below entities.
- **Reason:** Depth was expressed as scattered magic numbers, so nothing said what a
  depth meant, and canopy layered by Y alone cannot overlap the courier the way the
  reference illustration frames them.
- **Consequences:** `foreground: true` is a per-placement opt-in reserved for pieces the
  courier walks under — a piece the courier should be able to stand in front of must stay
  Y-sorted. **Open question (⚠):** true elevation (cliffs, ledges, stairs) still needs art
  the archive does not contain; this pass delivers foreground layering only.
- **Status:** ✅ built (Pass 5).

### One lighting recipe, derived from the footprint
- **Decision:** Every cast shadow comes from `shadowRecipe()` in
  `src/game/lighting.ts`: light from the **north-west**, so shadows fall south-east;
  width, thickness, offset and alpha all derived from the piece's **ground-contact
  footprint** (`footprintWidthPx`, the same helper the composition clearance rule uses),
  with alpha easing from 0.26 on a small prop to 0.15 on a large mass.
- **Reason:** Both set-piece renderers baked their own numbers — fixed 0.2 alpha, fixed
  `y - 4` offset, `frameWidth * scale * 0.7` width — so a bench and a building cast the
  same shape of shadow scaled up, and the props disagreed with the courier's own shadow
  (which sits below the sprite). Nothing in the village agreed where the light was.
- **Consequences:** Adding a prop means adding a sizing row (`propSizing.ts`), which then
  supplies its shadow automatically. The courier's shadow image keeps its own offset and
  now agrees in direction.
- **Status:** ✅ built (Pass 6). Appearance is `REQUIRES SEELLE/BROWSER VERIFICATION`.

### One size rule for the cast, measured by its figures
- **Decision:** The tile-based size convention now covers entities, not just props.
  `src/game/entitySizing.ts` declares, for every courier class, every authored NPC
  pack, and the generated placeholder art: the art's canvas, the alpha-bounds box of
  the *figure* inside it (height, width, and how far the feet sit below the canvas
  centre), a named band, and an intended rendered height in tiles. Scale, contact box,
  cast shadow, feet offset and name-tag height are all derived from that row, so no
  entity file contains a `setScale` literal any more (asserted by test).
- **Reason:** Pass 3 fixed the props but left the three entity classes on private
  literals — courier 1.33, authored NPC art 0.095, monsters 1.1 — which on screen meant
  0.75, 1.14 and 0.92 tiles of *figure*: villagers stood 1.5x the courier beside them
  while monsters were barely taller, and nothing said which was intended. Entity art
  cannot be measured by its canvas the way prop art can: the class frames put the figure
  in 69% of a 36px square and the NPC pack in 82-89% of a 700px one, so the same number
  meant different things in different packs. That is exactly how 1.33 and 0.095 came to
  look comparable.
- **Consequences:** The courier keeps its on-screen size (its scale is now derived and
  lands on 1.333 for the bear and cat, 1.286 for the fox), so this corrects the entities
  that disagreed with it rather than moving the character the camera and physics are
  tuned around. Villagers come down to 0.95 tiles (from 1.14-1.24) and monsters up to
  1.15 (from 0.92), so the cast reads as one world. Entity shadows are now the same
  Pass 6 recipe ellipse every prop uses, sized from the entity's own contact, which
  replaced the baked 32x24 `player-shadow` texture entirely (removed).
  **Open question (⚠):** the rule makes a pre-existing grounding fact measurable — on a
  48px tile the courier's feet land ~5px above the tile's bottom edge while a villager's
  land on it and a monster's sink ~4px below. Correcting that moves sprites relative to
  their collision bodies, which is a feel change, so it is recorded rather than done.
  Whether the new sizes read right on screen is `REQUIRES SEELLE/BROWSER VERIFICATION`.
- **Status:** ✅ built.

### Plan properties are reviewed as images, not as screenshots
- **Decision:** Visual Passes 2–6 are reviewed with `npm run composition:render`, which
  rasterizes the *planners' own output* — the terrain plan, density bands, framing
  clusters, the clearance audit and the shadow recipe — into PNGs under
  `artifacts/composition/`, with no browser, no dev server and no gameplay. Six panels
  per zone: authored codes, density, surface, plan pieces, clearance, lighting.
- **Reason:** The browser baseline cannot answer the questions these passes ask. It shows
  the world as it happens to be framed around the courier, with the HUD over it, so "is
  the plaza the generator's disc or a rectangle", "are the bands actually banded",
  "where did the arcs land", "does decoration touch a tile the player acts on" and "do the
  shadows agree about the light" are all invisible in it. Those are properties of the
  *plan*, and the plan is pure and Phaser-free.
- **Consequences:** The harness must stay a renderer of decisions taken elsewhere — it
  calls `buildTerrainPlan`, `footprintBoxTiles` and `shadowRecipe` and draws what they
  return, never re-implementing a rule. `tests/data/composition-preview.test.ts` pins
  that: it reads the pixel back out of each panel and compares it against the planner
  (the paved disc tile for tile, the density priority order, every colour declared), and
  asserts two runs are byte-identical. A magenta pixel means a map code the renderer does
  not handle. Panels also record what the plan *planned* against what a zone can actually
  *draw* — the valley authors no canopy or fringe art, so it plans 88 pieces and draws
  none, which is a zone choice made visible rather than a silent gap.
  Judging whether any of it looks good remains `REQUIRES SEELLE/BROWSER VERIFICATION`.
- **Status:** ✅ built.

### Composition intent lives in per-zone JSON, not in tuning constants
- **Decision:** Where a zone's clearings, thickets and framed entrances are is authored
  content: `src/data/maps/<zone>.composition.json`, read through the single registry
  `src/game/compositionPlans.ts` (the same pattern `Maps.ts` uses for maps) and applied by
  the planner in `src/game/terrainComposition.ts`. A plan can author the composition cell
  size, the treeline band and class, the four band multipliers, any number of **regions**
  (ellipse or rect, in tile coordinates, applied as *paint* in file order so a later region
  can carve a clearing out of an earlier thicket), the **entrances** to frame (or `null` to
  derive them from the map's own road mouths), the scatter densities, spacings and path
  clearances, and the minimum height a piece must have to cover a suppressed blocking tile.
- **Reason:** Pass 4 proved the mechanism — deliberate bands, a boundary treeline, framing
  arcs at the plaza approaches — but left the numbers as constants inside the planner, so
  the composition of a specific place could only be changed by editing a system. A zone's
  own geography (where its square is, which way its roads leave, which corner should be
  wooded) is content, and it belongs next to the map it describes.
- **Consequences:** Precedence is explicit and unchanged in spirit: a **reserved** tile is
  clear first (safety — decoration must never obscure a tile the player acts on), then the
  **treeline** band (the world's edge is not left to chance), then an **authored region**
  (intent), then the **seeded cell roll** (variation where nothing was authored). Two things
  are deliberately *not* authorable, because they are rules rather than intent:
  `RESERVED_RADIUS`, and `MOUTH_MERGE_TILES` / `APPROACH_CHAIN_TILES`, which only matter when
  a zone derives its entrances. A zone with no plan gets `COMPOSITION_DEFAULTS`, which are
  the numbers the planner used before, so an unauthored zone composes exactly as it did.
  Parsing is strict and reports *every* problem rather than the first, because this is
  hand-authored content; at runtime a rejected plan falls back to the defaults instead of
  taking the zone's terrain down, while `npm run validate` and `npm run composition:render`
  refuse to ship one. `validateComposition` adds the checks that matter after a map is
  regenerated underneath a hand-written plan: a region that no longer touches the map, bands
  that are no longer ordered open-to-dense, and an entrance that has stopped being a way in.
  Measured effect on the shipped village: 8 regions, and the band counts move to
  open 1264 / light 1477 / normal 725 / dense 2159 of 5625 (the open band is the square and
  its ring plus the reserved margins), and the three authored entrances land
  on the same tiles as the map's derived mouths (east 45,27 west 29,29 south 38,36) with
  compass outward vectors instead of the centroid's tilted ones. The valley, which has no
  paving at all and therefore derives nothing, authors its single gate. One honest
  consequence: authoring *which* ground is dense makes the dense band smaller and puts it
  where the woods already are, so the canopy-per-map-tile contrast between dense and light
  ground moves from 3x to 1.78x — the band still decides how wooded a place feels (0.187 /
  0.304 / 0.363 pieces per *woodland* tile, against a spacing floor that caps the dense band
  at 0.39), but the ratio is now the packing ratio rather than the odds ratio. Whether the
  authored clearings and thickets read the way they were meant to is
  `REQUIRES SEELLE/BROWSER VERIFICATION`; the wiring is not.
- **Status:** ✅ built (`tests/data/composition-plan.test.ts` 25 cases: defaults, full parse,
  error collection, region paint order and tile-centre sampling, radii and spread rejection,
  every `validateComposition` rule, and the shipped plans including the cross-check that the
  village's authored entrances sit on the map's real road mouths).

### One account surface: the courier switcher lives in the top bar
- **Decision:** The in-game courier switcher is **not** a widget of its own. It lives in the
  top bar's account dropdown (`src/ui/TopBar.ts`), which is the game's only account surface:
  account identity, the courier roster, "Character, bag & skills", "Create a new courier",
  "Report bug", and the Admin link. `src/ui/CharacterMenu.ts` and
  `src/styles/character-menu.css` are deleted, and the dropdown now opens for **every** role
  rather than Admin only, because switching couriers is an every-player need.
- **Reason:** the pill was a second, older component (`CharacterMenu`) that mounted into
  `#hud-overlays` — `position: fixed; inset: 0; z-index: 3000` — pinned at viewport top-left,
  which is *outside* the game window and therefore on top of the "Paws & Parcels" brand. It
  also duplicated what the bar already had: two carets, two visual languages (cream pill vs
  green bar), and Sign out in both.
- **Consequences:** the world HUD keeps one account affordance instead of two, and the
  floating pill cannot return without deleting the dropdown. Sign out stays the visible bar
  button rather than moving into the menu, so the primary action keeps its prominence. The
  roster scrolls inside a `max-height` panel — the cap that fixed the unreachable-actions
  defect in `reports/PLAYWRIGHT-RUNTIME-AUDIT.md` (D3) moved with the panel. One latent
  defect fell out of the merge: the Admin link had been rendering cream-on-cream, because
  `.top-navbar a { color: inherit }` (0,1,1) out-specified `.navbar-account-menu__link`
  (0,1,0), so it was invisible until hover; the menu now styles its own rows through
  `.navbar-account-menu a` / `.navbar-account-menu button`, which also have to opt back out
  of the cream-on-green bar button treatment.
- **Status:** ✅ built (`tests/e2e/hud.spec.ts` → "the top bar is the only account surface":
  zero `.character-menu` nodes, one `#navbar-account`, the dropdown opens with the create
  action and closes on Escape; `tests/e2e/support/harness.ts` now drives the merged menu, so
  every spec that boots a fresh courier exercises it). Whether the merged menu reads as well
  as it should — panel width, the ellipsised account name, roster scrolling — is
  `REQUIRES SEELLE/BROWSER VERIFICATION`.

### The inventory control is icon-only
- **Decision:** The bottom-right inventory control is **just its icon**: a circular cream
  control (44px at HUD scale, `--hud-inventory-size`) carrying the courier's satchel glyph,
  with no "Inventory" label and no `I` keycap chip. The binding lives in the hover hint
  (`title="Inventory - I"`) and the aria-label.
- **Reason:** the labelled pill was the largest HUD affordance on the screen for the smallest
  amount of information — the pill repeated what the icon already said, and the keycap was a
  third element for a hint the HUD already delivers through `title` elsewhere (the minimap
  toggle, every skill slot).
- **Consequences:** the control stops competing with the world, and the bottom-right corner
  is now its own (the quest tracker that used to stack above it moved to the bottom-left
  column — see the next entry). The satchel is a drawn glyph in `src/ui/hud/icons.ts` rather than a cropped sprite, because the
  HUD is vector throughout (gradients, inline SVG, no raster panel art) and a bitmap would be
  the first exception. It was checked by rasterizing it at its real 24px size: the clasp had
  to be a stroke rather than a rect, since a 3-unit box fills in solid at that size and reads
  as a smudge.
- **Status:** ✅ built (`tests/e2e/inventory.spec.ts` pins the control as icon-only: empty
  text, exactly one SVG child, `aria-label`, `title="Inventory - I"`, and a square box — then
  still opens the profile panel). Whether it *looks* like the right satchel at HUD scale is
  `REQUIRES SEELLE/BROWSER VERIFICATION`.

### The bottom-left is a column: quest tracker above village chat
- **Decision:** Panels that stack get a **column**: `hudColumn("bottom-left")` in
  `src/ui/hud/layer.ts` holds the quest tracker above the village chat, and the tracker is
  anchored bottom-left rather than bottom-right above the inventory control.
- **Reason:** two things. The tracker's position on the right was a hand-measured offset off
  a *different* panel's height (`bottom: edge + inventory-size + gap`), which is the same
  class of magic number the depth pass replaced everywhere else — and it goes stale the moment
  the chat log grows, or the narrow-window media query hides it. Inside a column, "above the
  chat" is layout. Separately, the bottom-right corner already had the inventory control, so
  the world's most useful panel sat in the corner with the least room.
- **Consequences:** the column is a layout box, not a surface — it spans more of the world
  than the panels it holds, so `#hud-layer > .hud-column` turns pointer events back off (the
  layer turns them on for every direct child). Mount order is not layout: `order` puts the
  tracker in the upper slot whichever component is constructed first. The collapsed tracker
  becomes just its tab, which is now a **button** — this is also the fix for a real defect:
  collapsing hid the whole panel body *including the chevron*, so the only control that could
  expand the tracker again was the one being hidden, and a collapsed tracker could not be
  reopened at all. The tab survives collapsing because it lives outside the body, and its
  `aria-expanded`/`aria-label` flip with the state.
- **Status:** ✅ built (`tests/e2e/hud.spec.ts` → "the quest tracker collapses to its tab,
  reopens, and stacks above the chat": the body hides, the tab stays visible with
  `aria-expanded="false"`, the tab click restores the card, and the tracker and chat share a
  left edge with the tracker entirely above the chat). Whether the stacked column reads
  better than the old right-edge placement — and whether a collapsed tab is enough of a
  cue — is `REQUIRES SEELLE/BROWSER VERIFICATION`.

### The status card is half the size and carries the class resource
- **Decision:** The player status card is **121px wide at HUD scale — half the 242px it
  shipped with** — with the numbers printed *inside* each bar so the card needs no third
  column for text, and one row per bar. It shows the courier's class **primary resource**
  (stamina / mana / focus) under health, and a **five-stamp courier rating** whose slots render
  greyed until the server scores them. Every row carries a `title` explaining what it is.
- **Reason:** the card was the largest thing in the HUD for the least information, and it showed
  a single bar. The resource is real authored content (`src/data/classes.json`
  `primaryResource` / `resourceMax` / `resourceRegenPerSec`, mirrored in `classStats.ts` and
  pinned by the class-parity test) that the HUD had simply never displayed.
- **Consequences:** the resource bar's **value is not yet simulated anywhere**. `design/combat.md`
  says basic attacks are free and abilities cost the resource; no ability is implemented and the
  server tracks no resource, so the bar sits at the authored ceiling — the correct steady state
  for something nothing spends — and `PlayerStatusCard.setResource(current, max)` is the seam the
  server will drive when combat spends it. One honest note for whoever picks that up: the server
  side is *scaffolded but absent* — `gameServer.ts` emits `resourceCost: {}` on both combat
  events, always empty, and `ws/combat.ts`'s rejection union has `TARGET_DEAD`, `OUT_OF_RANGE` and
  `COOLDOWN_ACTIVE` but no `INSUFFICIENT_RESOURCE`, even though `ROADMAP.md` lists resource costs
  and that error code under a complete Phase 3. The rating is likewise
  display-only (`setStampRating` is the seam), and the authoritative stamp *count* moved into the
  rating row's tooltip, since the half-width card has no room for a separate stat row.
- **Status:** ✅ built (`tests/e2e/hud.spec.ts` → "the status card is compact, self-explaining, and
  shows the class resource": two bars with two in-bar values, five rating slots with none earned,
  footprint under 16% of the game window, `title` on the name/level/health/resource/rating rows,
  the resource matching the courier's own class and its colour class, and no row overflowing at
  that width; `tests/data/class-parity.test.ts` pins the resource table to `classes.json`, and
  `tests/systems/network-hud-lifecycle.test.ts` that the card adopts it on mount). Whether a
  121px card is still legible, and whether greyed stamps read as "not yet" rather than "broken",
  is `REQUIRES SEELLE/BROWSER VERIFICATION`.

---

## 1. Online Architecture & Authority

### Online multiplayer is server-authoritative
- **Decision:** The game is **online and authoritative**: a dedicated game server owns all
  gameplay state; clients send intents and render server-approved results.
- **Reason:** Multiplayer requires a single source of truth for positions, combat, quests,
  and economy; authoritative servers are the standard pattern for MMORPGs and the only
  practical anti-cheat.
- **Consequences:** All gameplay logic must be written server-side and be testable without
  a browser; the client becomes a renderer + intent sender.
- **Status:** ✅ decided.

### SQLite is accessed only by the server
- **Decision:** SQLite is reachable **only** from the server process(es). The browser never
  connects to SQLite directly.
- **Reason:** Direct browser→DB access would expose credentials and let clients bypass all
  validation; the server is the trust boundary.
- **Consequences:** All persistence goes through HTTP/WS APIs; DB credentials live in
  server env/secrets; a public server layer is mandatory.
- **Status:** ✅ decided.

### Client input is untrusted
- **Decision:** Every client message is treated as **untrusted input**. The server validates
  all intents (movement speed/teleport sanity, attack cooldowns/ranges, item ownership,
  quest prerequisites) before applying them.
- **Reason:** A hostile client can forge any message; validation must be server-side to
  preserve game integrity.
- **Consequences:** Clients cannot grant themselves items/HP/completions; server logs and
  rejects invalid intents (see `error` message in the protocol).
- **Status:** ✅ decided.

### Combat calculations happen on the server
- **Decision:** All combat math — damage, crits, mitigation, defeat, XP — is computed on the
  **server**. Clients only send `attack` intents and render `combat_event` results.
- **Reason:** Deterministic, cheat-resistant combat and consistent experience for all
  players.
- **Consequences:** The server owns `character_stats` + monster stats; client shows no
  damage numbers of its own.
- **Status:** ✅ decided.

### Quest completion is validated on the server
- **Decision:** Quest state transitions (available → active → complete) are decided by the
  server, which validates prerequisites, required items, delivery targets, and gating.
- **Reason:** Quest chains and gated parcels/letters are core progression; client-side
  claims would break the chain economy.
- **Consequences:** NPC dialogue/UI can hint at gating, but the server is the arbiter;
  `quest_updated` is server → client only.
- **Status:** ✅ decided.

### Inventory and item ownership are validated on the server
- **Decision:** Inventories, stacks, equipment, and ownership live on the server and are
  mutated only by validated server operations (loot, quest reward, trade/buy, equip).
- **Reason:** Prevents duplication, stack exploits, and gear cheating; enables auditing.
- **Consequences:** `inventory_updated` is server → client; the client never mutates
  inventory locally beyond display.
- **Status:** ✅ decided.

### Player progression is persisted in SQLite
- **Decision:** All player progression (XP/level, stats, currency, inventory, quests,
  friendships, dungeon runs) persists in **SQLite** keyed by account/character.
- **Reason:** Persistent accounts + cross-session progression require server-side storage;
  localStorage cannot provide multi-device or authoritative persistence.
- **Consequences:** Save system moves entirely server-side; migration scripts versioned.
- **Status:** ✅ decided.

### localStorage holds the auth session, never gameplay state
- **Decision:** localStorage may hold the server-issued authentication session and client
  settings (audio volumes, text speed, UI toggles, control bindings). It must never hold
  authoritative gameplay state, inventory, quest progress, or character saves.
- **Reason:** Players should not have to sign in after every page refresh, while gameplay
  remains server-authoritative and protected from client-side state edits.
- **Consequences:** The access JWT's lifetime comes from server config; logout clears it, and
  a 401 clears the browser session. PKCE state/verifiers remain tab-scoped in sessionStorage.
- **Status:** ✅ decided.

---

## 2. Classes & Content

### Bear is Warrior
- **Decision:** The Bear class is the **Warrior** — melee tank/damage, primary resource
  **Stamina**, basic attack **Swipe**, starter ability **Bear Hug** (taunt + shield).
- **Reason:** Bear = big + protective maps naturally to the tank archetype.
- **Consequences:** Warrior starter content is designed for melee range and durability.
- **Status:** ✅ decided.

### Cat is Mage
- **Decision:** The Cat class is the **Mage** — ranged magic burst, primary resource
  **Mana**, basic attack **Spark**, starter ability **Moonbeam** (AoE).
- **Reason:** Cat = nimble + mysterious suits the caster archetype; "Moonbeam" ties into
  Lumi's moonflower lore.
- **Consequences:** Mage starter content is ranged with resource management.
- **Status:** ✅ decided.

### Fox is Archer
- **Decision:** The Fox class is the **Archer** — ranged sustain, primary resource
  **Focus**, basic attack **Arrow shot**, starter ability **Quick Volley** (3 arrows).
- **Reason:** Fox = quick + clever fits the precision/ranged archetype.
- **Consequences:** Archer starter content favors positioning and steady damage.
- **Status:** ✅ decided.

### Monsters cannot spawn inside the protected Main Village
- **Decision:** The Main Village is a **safe hub**: no monster spawns, no aggro. Monsters
  only exist on outdoor maps and in dungeons.
- **Reason:** Preserves the cozy, low-pressure identity and gives players a rest zone;
  matches Spec's hub concept and avoids new-player frustration.
- **Consequences:** All monster content is authored on outdoor/dungeon maps; the village
  spawn point is always safe.
- **Status:** ✅ decided.

### Dungeons are instanced/isolated from the outdoor map
- **Decision:** Dungeons are **instanced** zones: each party/run gets its own private copy,
  isolated from the shared outdoor world.
- **Reason:** Parties need private state (boss HP, loot, progression); instancing avoids
  griefing and lets difficulty be per-run.
- **Consequences:** A dungeon-run lifecycle (create → enter → run → complete/fail →
  destroy) must be built; dungeon state is keyed by run, not by zone.
- **Status:** ✅ decided.

### Dungeons and crafting are planned systems, not automatically MVP-complete
- **Decision:** Dungeons and crafting are **planned** (Phase 6) systems with their own
  scope gates. They are **not** considered complete just because related single-player
  content (gathering/cosmetics) previously existed.
- **Reason:** They introduce new server systems (instancing, recipes, materials) with real
  complexity; the pivot must not inherit "done" status from the old plan.
- **Consequences:** Marked ⬜ planned until their Phase 6 quality gates pass.
- **Status:** ⬜ planned.

---

## 3. Zones, IDs & Retained Content

### Zones (now multiplayer; hub renamed to Clover Village)
- **Decision:** The main hub is now `zone-clover-village` (safe village), replacing
  the old `zone-post-office` map. The old `zone-bramble-patch` map was removed;
  outdoor monster content returns in Phase 3 on the **Happy Valley** map
  (`zone-happy-valley`, from the Happy Valley art pack).
  Whispering Pines / Sunlit Clearing IDs stay reserved. The first dungeon is a
  new instanced zone.
- **Reason:** The village was rebuilt around the new Clover Village art pack
  (`reference/assets/maps/CloverVillage/`); the old placeholder maps no longer matched.
- **Consequences:** All five cozy NPCs live in the hub for now (placeholders until
  Phase 7 art); zone transitions become server-validated join/leave as more zones
  land.
- **Status:** ✅ built (hub map + Happy Valley monster content).

### ID conventions (retained)
- **Decision:** Stable kebab-case prefixed IDs (`zone-`, `npc-`, `item-`, `quest-`,
  `upgrade-`, `dialogue-`) — never renamed once data exists.
- **Reason:** Already the backbone of content validation; SQLite keys reuse them.
- **Consequences:** New entities (classes, monsters, dungeons, recipes) adopt the same
  convention (`class-`, `monster-`, `dungeon-`, `recipe-`).
- **Status:** ✅ built.

### Economy (retained, now audited)
- **Decision:** Currency is **Stamps**, server-issued, with **audit/economy events** logged
  to SQLite for every grant/spend. Cozy tuning (no required grinding) is preserved.
- **Reason:** Stamps are already established; server-side audit adds anti-cheat.
- **Consequences:** Every economy mutation goes through one validated server path.
- **Status:** ✅ decided.

### Friendship/reputation (retained, server-side)
- **Decision:** NPC friendship levels 0–4 (thresholds 3 / 7 / 12 / 18) are retained as the
  reputation system, but **persisted server-side** (level stored, per NPC) and used as
  quest-chain gates.
- **Reason:** The cozy relationship loop is core to the identity; it becomes part of
  progression + quest prerequisites.
- **Consequences:** `friendships` table in SQLite; reputation changes are server-validated;
  the no-two-level-jump invariant still applies to rewards.
- **Status:** ✅ built (content + server persistence).

---

## 4. Controls (retained from single-player)

- **Decision:** Desktop: WASD/arrows move · E/Space interact · 1 basic attack (Phase 3,
  slot 1 of the HUD skill boxes, keyed 1–4) ·
  Esc closes panels. Mobile: pointer-drag virtual pad + on-screen interact/attack buttons.
- **Reason:** Shipped input already works; combat adds an attack input.
- **Consequences:** InputSystem gains attack intents; mobile gets an attack button.
- **Status:** ✅ built.

## 5. Open questions (⚠)

- Server language/framework within the TS ecosystem (Node + ws/µWebSockets vs. Deno) —
  decided: Node + `ws` (see `server/src/ws/`), remaining questions deferred.
- Zone capacity exact number and snapshot rate (16–32 players, 10–20 Hz) — tunable at
  load test (Phase 8).
- Account identity: delegated to ASHAT Hub OIDC; the game stores the Hub user id and does not implement local-password accounts.
- Whether existing `src/data` JSON remains the content source of truth or migrates to
  SQLite seed data — lean: JSON stays, SQLite mirrors it (content ≠ player state).
