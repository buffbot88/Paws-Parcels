# Project knowledge

This file gives Freebuff context about your project: goals, commands, conventions, and gotchas.

## What this is
**Paws & Parcels** — a cozy, browser-based 2D RPG where the player is a tiny animal courier delivering letters/packages in a magical forest. No combat, no timers, no failure states; the loop is accept delivery → explore zone → gather resources → talk to NPCs → deliver → earn Stamps & friendship → buy upgrades → return next in-game day.

**Status: Phase 1 (Project Foundation) complete.** Game boots (Vite 8 + Phaser 4), content is locked and validated. Architecture below is from `BuildPlan.md` (the authoritative build doc), with the deviations noted in `design/decisions.md` + knowledge.md (Phaser 4 chosen over BuildPlan's Phaser 3).

- `Spec.md` — full product spec (gameplay, quests, NPCs, items, save schema, MVP acceptance checklist)
- `BuildPlan.md` — MVP build plan: stack, folder structure, phased milestones, DoD, risks (Phase 0 marked complete)
- `VOWS.md` — **binding development practices, read before writing any code** (see Conventions)
- `design/decisions.md` — **locked decisions**: 960×540 @ 48×48 tiles, Scale.FIT; IDs, zones, economy
- `design/world-map.md` — tile-unit sketches for the 2 MVP zones (post office hub + Bramble Patch)
- `design/npcs.md` — 5 NPC cards with friendship-level unlocks
- `src/data/*.json` — content: 5 npcs, 20 items, 19 quests, 3 upgrades, 6 dialogue sets (stable kebab-case IDs; quests use `rewardItemId` for L4 friendship rewards)
- `scripts/validate-content.ts` — content integrity validator CLI (Node 26 runs TS natively); run via `node scripts/validate-content.ts`
- `.agents/types/` — Codebuff custom-agent type definitions (`agent-definition.ts`, `tools.ts`, `util-types.ts`)

**Zone discrepancy resolved (recorded in decisions.md):** Spec §17 says "two exploration zones" but BuildPlan MVP scope/DoD define exactly one (Bramble Patch). BuildPlan is authoritative; Whispering Pines/Sunlit Clearing IDs reserved for post-MVP.

## Quickstart
**Phase 1 (Project Foundation) complete** — Vite 8 + TS + Phaser 4 boot pipeline is live. Deps: `typescript`, `vitest`, `@types/node`, `vite`, `phaser`.
- Setup: `npm install`
- Dev: `npm run dev` (localhost:5173) — Boot → Preloader → Overworld scenes
- Build: `npm run build` (outputs `dist/`; `base: './'` for static hosting)
- Typecheck: `npm run typecheck`
- Test: `npm test` (Vitest) — unit tests live in `tests/`
- Content validate: `node scripts/validate-content.ts` (also `npm run validate`)

**Gotcha:** the repo folder name contains `&` (`Paws&Parcels`), which breaks npm's `node_modules/.bin` PATH shims on Windows. The npm scripts therefore invoke the tools via explicit relative paths (`node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vitest/vitest.mjs run`, `node node_modules/vite/bin/vite.js`) — do not change them back to bare `tsc`/`vitest`/`vite`.

## Planned stack & architecture
- **Engine:** Phaser 4 (Canvas/WebGL) — **user-confirmed deviation from BuildPlan's Phaser 3** (Phaser 3 is legacy; Phaser 4.2.x keeps the same config/scene/Scale.FIT API). Game config in `src/game/GameConfig.ts`: 960×540, `Scale.FIT` + `CENTER_BOTH`, parent `#game-container`, min width 320px
- **Scene flow (Phase 1):** `boot` → `preloader` (generates placeholder geometric textures at runtime via `make.graphics().generateTexture` — no binary assets until Phase 8) → `overworld` (placeholder anchor scene; Phase 2 adds real maps/movement/camera)
- **DOM layout:** `index.html` + `src/styles/global.css` center a 16:9 container; Phaser canvas fills it (DOM-over-Canvas foundation; UI components arrive Phase 2)
- **Error logging:** `src/game/ErrorLog.ts` wires `window.onerror` + unhandled rejections (Phase 1 deliverable)
- **Language/tooling:** TypeScript, Vite
- **UI:** DOM-over-Canvas — ALL menus/dialogue/inventory/shop/settings in HTML/CSS layered above the canvas, never built in Phaser. Bridge via an event-emitter pattern: Phaser emits events (e.g. `OPEN_INVENTORY`), DOM listens and overlays HTML
- **State:** Singleton `GameManager` persisting to `localStorage` (versioned `SaveData` with migration support; upgradeable to IndexedDB)
- **Maps:** Tiled Editor → JSON exports; **assets:** Aseprite → sprite sheets + JSON atlases
- **Data:** JSON content files under `src/data/` (npcs, items, quests, upgrades, dialogue)
- **Deployment:** static hosting (Vercel or Netlify)

Planned folder layout: `src/{assets, components, data, scenes, systems, ui, types, styles}` + `public/assets/{audio, maps, sprites, tilesets, ui}` + `tests/{systems, data, e2e}`. See `BuildPlan.md` §4 for the full tree.

**Currently in place:** `src/data/*.json` (content), `src/types/*.ts` (typed models matching the JSON: `PlayerState`, `SaveData`, `ItemDefinition`, `QuestDefinition`, `NPC`, plus `UpgradeDefinition`/`DialogueSet`/`ContentData`), `src/systems/ContentValidator.ts` (shared validation rules), `tests/data/content-validation.test.ts` (31 Vitest tests: schema conformance + rule coverage). `scripts/validate-content.ts` wraps the same ContentValidator — single source of truth.

## Conventions
- **Follow `VOWS.md`:** no shortcuts/mock/boilerplate/underbuilding; no hallucinating or assuming — ask the user; present a build plan and get user approval BEFORE implementing; docstrings max 1–2 sentences; gather all context first, then exactly one planning pass
- **Content-first discipline:** keep the delivery loop playable before adding art/scope; use placeholder geometric shapes until mechanics are verified (Phase 4)
- **Core data models** (in `BuildPlan.md` §5): `PlayerState`, `ItemDefinition`, `QuestDefinition`, `SaveData` — stable kebab-case IDs for all items/quests/NPCs/zones
- **Game feel targets:** cozy-first, no grinding, no permanent progress blockers; initial load <5s, 60 FPS desktop / 30–60 FPS mobile; minimum width 320px

## Gotchas
- **MVP scope is fixed:** 5 NPCs (Pip, Maple, Biscuit, Lumi, Moss), 2 zones (Clover Post Office hub + Bramble Patch), 10–15 quests, 12 inventory slots (+6 per bag upgrade), 3 upgrades, save via localStorage. Out of scope: multiplayer, combat, accounts, crafting, housing, procedurally generated maps
- **Vows 5:** mechanical work (searches, lints, single-file edits, test runs) acts immediately; anything warranting a plan gets exactly ONE deliberate planning pass, shown to the user for approval first
- Save data is versioned — adding/migrating fields requires a migration path, never a silent shape change
- Quests must never create impossible combinations (content pool randomization in `BuildPlan.md` Phase 5)
