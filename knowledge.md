# Project knowledge

This file gives Freebuff context about your project: goals, commands, conventions, and gotchas.

## What this is
**Paws & Parcels** — a cozy, browser-based **2.5D online RPG (MMORPG-lite)** where the player is a tiny animal courier in a shared magical forest. The game is **server-authoritative**: the server owns all gameplay state; the client renders intents. No permanent failure states, no PvP, no gore.

**Status: Phase 2 — Multiplayer Village complete.** The client is the Phaser 4 single-player foundation (one walkable hub zone, 5 NPCs, DOM dialogue) rebuilt around **Clover Village** (`zone-clover-village`, `src/data/maps/clover-village.json` — the old Post Office + Bramble Patch maps were removed; all 5 NPCs moved to the hub). The server has **SQLite persistence** (single committed file `server/data/paws-and-parcels.sqlite`, migrations 001–003 via `server/src/db/migrate.ts`), health check, **ASHAT Hub OIDC auth** (authorization code + PKCE, JWKS-verified), JWT sessions, character endpoints (`GET/POST /api/characters`, `GET /api/classes`), and the **Phase 2 WebSocket layer** (`server/src/ws/`: 30s single-use tokens via `GET /api/ws-token`, `authenticate`/`join_zone`/`move_intent`/`leave_zone`, 20 Hz snapshots, 60s reconnect grace, server-validated movement with collision from the same map JSON, periodic position persistence every 10s while moving). The **client is now hooked up end-to-end**: `GameSocket`/`NetworkSystem`/`RemotePlayer` render presence + movement sync with a status chip, and the **courier desk** (`CharacterDesk`) provides character creation (name + class picker) and a select screen for multi-character accounts, with the chosen courier persisting across reloads. An in-game **courier menu** (HUD button, `CharacterMenu`) switches couriers, opens character creation, and signs out — it tears down and reboots the Phaser game (`main.ts` `playWith`). Next: **Phase 3 — Classes and Combat**.

## Key online-plan documents
- `BuildPlan.md` — **authoritative build plan**: architecture, phases, scope, ownership rules, quality gates
- `ROADMAP.md` — status of what's built vs. what's next (online phases)
- `design/decisions.md` — locked decisions (2.5D isometric, server-authoritative, class system, SQLite persistence, safe hub)
- `design/architecture.md` — client/server/SQLite responsibilities, HTTP + WebSocket, auth flow, reconnection, tick model
- `design/database-schema.md` — SQLite entities (accounts, characters, inventory, quests, dungeons, audit), PK/FK, ownership, auth handling
- `design/network-protocol.md` — WS messages (10 C→S + 8 S→C), payload shapes, validation rules, failure cases
- `design/{classes,combat,quests,monsters,dungeons,cra*}.md` → `design/{classes,combat,quests,monsters,dungeons,cra ft}.md` — 6 content design docs
- `docs/archive/` — 🗃 archived single-player docs (BuildPlan, Spec, ROADMAP, decisions) with historical banners

## Legacy docs (retained, single-player context)
- `Spec.md` — original single-player product spec; kept for NPC/lore content reference
- `design/world-map.md` — tile-unit sketch for the Clover Village hub (post office + Bramble Patch maps were removed)
- `design/npcs.md` — 5 NPC cards with friendship-level unlocks (all NPCs live in the hub for now)

## Quickstart
**Client still runs as a single-player Phaser 4 app.** Server is not yet built.
- Setup: `npm install`
- Dev: `npm run dev` (localhost:5173) — Boot → Preloader → Overworld (walk with WASD/arrows/drag)
- Build: `npm run build` (outputs `dist/`; `base: './'` for static hosting)
- Typecheck: `npm run typecheck`
- Test: `npm test` (Vitest) — 69 unit tests in `tests/`
- Content validate: `node scripts/validate-content.ts` (also `npm run validate`)

**Gotcha:** the repo folder name contains `&` (`Paws&Parcels`), which breaks npm's `node_modules/.bin` PATH shims on Windows. The npm scripts therefore invoke the tools via explicit relative paths (`node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vitest/vitest.mjs run`, `node node_modules/vite/bin/vite.js`) — do not change them back to bare `tsc`/`vitest`/`vite`.
- **JSON imports:** Node 26's native TS runner requires `with { type: "json" }` on JSON imports (see `src/game/Maps.ts`) — plain JSON imports work under Vite/Vitest but crash the validate CLI. Use the import attribute.

## Planned stack & architecture
- **Client:** Phaser 4 (Canvas/WebGL, depth-sorted isometric/pseudo-3D). Game config: 960×540, `Scale.FIT` + `CENTER_BOTH`, parent `#game-container`, min width 320px
- **Server:** Node/TS (separate process, same monorepo or sibling package). WebSocket + HTTP. Containerized.
- **Database:** SQLite — accessed only by the server. Passwords hashed (argon2id).
- **UI:** DOM-over-Canvas — all menus/dialogue/inventory/shop/settings in HTML/CSS layered above the canvas, never built in Phaser. Bridge via an event-emitter pattern.
- **Persistence:** SQLite for all gameplay state. localStorage limited to client settings (audio, UI, controls).
- **Maps:** custom JSON (ASCII `rows` + spawn/transitions); **assets:** Aseprite → sprite sheets + JSON atlases
- **Data:** JSON content files under `src/data/` (npcs, items, quests, upgrades, dialogue) — may be mirrored to SQLite seed data
- **Deployment:** static hosting (Vercel/Netlify) for client; containerized server + managed SQLite

## Scene flow (client, current)
`boot` → `preloader` (generates placeholder geometric textures at runtime via `make.graphics().generateTexture` — no binary assets until Phase 7; one `tileset-main` sheet, tile frames defined in `src/game/Tiles.ts`) → `overworld` (zone-capable: builds tilemaps from custom JSON maps, `layer.setCollision` for walls/water/trees, camera `setBounds` + `startFollow`, tile-based transitions via `scene.restart({ zoneId, spawn })`)

## Authority rules
- **Client input is untrusted.** Server validates all intents: movement, attack, interact, quest accept, equip, craft.
- **Combat math is server-side.** Damage, crits, defeat, respawn — all server-computed.
- **Quest completion is server-validated.** Prerequisites, delivery targets, gating.
- **Inventory is server-authoritative.** Ownership, stacks, slots, equipment.
- **Economy is audited** via `audit_economy_events` table.

## Conventions
- **Follow `VOWS.md`:** no shortcuts/mock/boilerplate/underbuilding; no hallucinating or assuming — ask the user; present a build plan and get user approval BEFORE implementing; docstrings max 1–2 sentences; gather all context first, then exactly one planning pass
- **Content-first discipline:** keep the delivery loop playable before adding art/scope; use placeholder geometric shapes until mechanics are verified (Phase 7)
- **Core data models:** stable kebab-case IDs for all items/quests/NPCs/zones/classes/monsters/dungeons/recipes
- **Game feel targets:** cozy-first, no grinding, no permanent progress blockers; initial load <5s, 60 FPS desktop / 30–60 FPS mobile; minimum width 320px

## Gotchas
- **MVP scope is evolving:** the old single-player out-of-scope list (multiplayer, combat, accounts, online database, crafting) is now **in scope**. The new MVP scope is defined in `BuildPlan.md §21`.
- **Vows 5:** mechanical work (searches, lints, single-file edits, test runs) acts immediately; anything warranting a plan gets exactly ONE deliberate planning pass, shown to the user for approval first
- A server is now required — no more offline-only game.
- The old `SaveData` / `localStorage` progression model is superseded by SQLite persistence.