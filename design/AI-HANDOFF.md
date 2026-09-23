# AI Handoff — Paws & Parcels

## What this project is

Paws & Parcels is an existing cozy, courier-focused open-world RPG. Players are animal couriers in a shared magical forest. Deliveries, parcels, NPC relationships, and progression are the core identity; combat supports exploration and world progression.

This is a preparation baseline, not a request to rebuild the game. Continue existing systems in small, reviewable changes.

## Current architecture

- **Client:** Phaser 4 + TypeScript + Vite, with a three.js world renderer
  (`src/render3d/`) drawing the world as camera-facing billboards of the cutout art on a
  locked 3/4 perspective camera. Phaser still owns input, entities, the scene graph and the
  network systems; `?renderer=2d` runs the sprite world instead. See `decisions.md` §0.
- **UI:** DOM-over-Canvas HTML/CSS layered over the world canvas (above it in the stack, so
  no HUD panel is ever painted over by the world).
- **Server:** Node + TypeScript HTTP/WebSocket server.
- **Persistence:** SQLite, accessed only by the server. Runtime databases live outside Git at the configured `persist/` path.
- **Content:** JSON-authored catalogs under `src/data/`, validated and synchronized into server lookup tables.
- **Authentication:** ASHAT Hub OIDC authorization-code + PKCE flow, JWKS-verified by the server, followed by a server-issued JWT session.
- **Networking:** HTTP for authentication, characters, profiles, NPC dialogue, health, and admin operations; WebSocket for authenticated zone presence, movement, interactions, combat, quests, chat, and inventory/equipment updates.

## Implemented systems

The current codebase includes:

- OIDC authentication, session handling, account ownership checks, and character creation/selection;
- Clover Village (`zone-clover-village`) as the safe hub and Happy Valley (`zone-happy-valley`) as the outdoor monster zone;
- server-authoritative movement validation, collision checks, teleport sanity checks, presence, reconnect grace, and periodic position persistence;
- Bear Warrior, Cat Mage, and Fox Archer class data and server-side stats;
- server-authoritative combat, monster aggro/chase behavior, HP, damage, loot, XP, defeat, respawn, and cooldown validation;
- the Clover Village Courier Circuit tutorial and optional village side quests, including gated deliveries, fragile/urgent parcel rules, friendship state, rewards, and persisted progression;
- server-authoritative inventory and six-slot equipment, item ownership/locking/class/level validation, drag-and-drop presentation, derived courier/combat effects, and audit events;
- JSON-authoritative items, quests, classes, monsters, loot tables, zones, skills, upgrades, and dialogue;
- the admin panel foundation: tier and permission checks, player operations, settings, audit history, roles, assignments, CSRF protection, step-up tokens, and item catalog editing;
- the optional AI game engine for monster decisions and NPC dialogue, with model lifecycle management, timeouts, rate limits, and deterministic fallbacks;
- the dry-run Visual Director and admin-only capture tooling, which produce recommendations and reports without changing game source;
- automated content/map/parity tests, server integration tests, migration tests, checksum compatibility tests, CI, and the `npm run verify` gate;
- generated asset inventory and review catalogs for the authored/reference artwork.

## Incomplete or intentionally deferred

These are not claims that the game is finished:

- Dungeons and crafting are planned Phase 6 systems, not an implemented playable loop.
- Weather integration and deeper navigation/parcel-condition rules remain after the current inventory/equipment foundation.
- Broader Happy Valley progression and additional quest content remain future work.
- The local map panel is intentionally conservative: waypoint selection and interactive pan/zoom are not complete. Its unfinished controls are marked as coming soon rather than presented as working.
- The visual presentation still needs browser/gameplay review for layout, camera, depth sorting, sprite alignment, animation, mobile behavior, HUD overlap, and overall feel.
- The 3D world renderer is new and unjudged by eye: whether billboard cutouts read well at
  a 3/4 angle, whether the fixed camera's pitch/span feels right, and how depth, shadows and
  scale look in motion are all open review items. `three` is not code-split yet, and
  mouse/raycast world picking does not exist.
- Some production art categories remain reference-only or require future runtime selection; the asset catalog is an inventory and review tool, not permission to replace authored art.
- Admin editors for mobs, drops, NPCs, quests, dialogue, markets, seasons, events, zones, and draft/publish workflows are deferred.
- Load testing, browser compatibility review, security review for public alpha, and large-scale operational hardening remain future gates.

Visual and live-play checks are explicitly **REQUIRES SEELLE/BROWSER VERIFICATION**.

## Experimental systems

Treat these as opt-in and bounded:

- **Local game AI:** the game-owned LFM2.5-VL-450M can assist monster decisions and NPC dialogue. It is disabled by default, power-managed, rate-limited, timeout-bounded, and must always fall back deterministically.
- **Visual Director:** receives a capture plus structured metadata and returns review recommendations. It is dry-run tooling and must not directly edit maps, collision, quests, server authority, or assets.
- **Asset-generation and tuning scripts:** procedural ground/prop/tile tools and local VL review scripts are developer tooling. Generated output must be reviewed before becoming authored game content.
- **Visual capture review:** captures and reports are diagnostic artifacts. They do not substitute for a human or browser-capable gameplay review.

## Developer tooling and generated context

- `Asset Catalog/` and `scripts/build-browse-assets.mjs` generate visual/crawler asset catalogs.
- `design/assets/asset-inventory.json` and `design/assets/asset-reviews.json` are large generated/reference metadata files.
- `deploy/asset-catalog/` and `deploy/BrowseAssets/` are deployment output; regenerate them from source rather than hand-editing them.
- `tmp/` is scratch/review space and should remain empty of committed diagnostics.
- `reports/` contains selected visual-review history and reports; reports describe observations and do not change runtime authority.

## Do not replace

Do not replace or casually rewrite:

- the ASHAT Hub authentication and server-side ownership checks;
- server authority for movement, combat, HP, loot, inventory, equipment, quests, deliveries, and persistence;
- the current WebSocket protocol or SQLite migration history;
- existing delivery/tutorial systems unless the task specifically requires an extension;
- existing authored art, source filenames, or reference archive structure;
- deterministic fallbacks for the optional AI systems;
- the current Vite/Phaser/Node/SQLite technology choices.

Historical migrations are immutable. The repository currently contains two distinct `005_` migration filenames; both are part of the applied history. New migrations continue with unique increasing prefixes, beginning after `016` with `017`.

## Safe next areas for visual/game-capable iteration

A browser/game-capable agent can reasonably focus on:

- visual inspection and polish of Clover Village and Happy Valley;
- camera framing, depth ordering, sprite/prop alignment, animation presentation, HUD and responsive layout;
- live keyboard, touch, modal, accessibility, and inventory interaction verification;
- finishing the Local Map experience with browser-tested waypoint/pan/zoom behavior;
- selecting and wiring reference art only after visual review;
- extending courier quests and delivery presentation while preserving server validation;
- designing the first dungeon and crafting loop after confirming the Phase 6 scope.

Every visual or live-game result should be reported separately from source-level test results.

## Required verification

For source changes, run:

```bash
npm run typecheck
npm test
npm run validate
npm run build
```

Use `npm run verify` for the combined gate. Do not claim browser, accessibility, animation, camera, or gameplay verification from TypeScript tests alone.
