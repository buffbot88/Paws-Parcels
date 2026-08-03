# Paws & Parcels

> **A cozy browser-based 2.5D online RPG (MMORPG-lite)** — tiny animal couriers explore
a shared magical forest, deliver parcels, fight monsters, craft gear, and build
friendships. Server-authoritative, multiplayer, and always cozy.

- **Engine:** Phaser 4 (Canvas/WebGL, depth-sorted isometric/pseudo-3D)
- **Language/Tooling:** TypeScript, Vite 8
- **UI:** DOM-over-Canvas (HTML/CSS layered above the game canvas)
- **Persistence:** SQLite (server-side) — localStorage only for client settings
- **Server:** Node/TS (separate process; HTTP + WebSocket, SQLite persistence)
- **Tests:** Vitest (client) + server test suite
- **Hosting:** static hosting for client (Vercel/Netlify) + containerized server

## Commands

| Command | Action |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start the Vite dev server (localhost:5173) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm test` | Run Vitest unit tests |
| `npm run validate` | Validate `src/data` content integrity |
| `npm run dev:server` | Start the game/API server (localhost:3001) |
| `npm run migrate` | Apply SQLite migrations + seeds (`server/data/paws-and-parcels.sqlite`) |

> **Windows note:** the repo folder contains `&` (`Paws&Parcels`), which breaks npm's
> `node_modules/.bin` PATH shims. Scripts call tools via explicit
> `node node_modules/...` paths — keep them that way.

## Project structure (client)

```
public/            Static assets (favicon; art lands here in Phase 7)
src/
  data/            Content JSON (npcs, items, quests, upgrades, dialogue) + maps/
  entities/        Player, NPC (placeholder blobs + name tags)
  game/            GameConfig, ErrorLog, GameConstants, Maps registry, Tiles catalog
  scenes/          Boot → Preloader → Overworld (zone-capable world scene)
  styles/          global.css + game-ui.css (responsive DOM layout, UI overlay)
  systems/         ContentValidator + MapValidator + InputSystem + InteractionSystem + DialogueService
  ui/              DialoguePanel (DOM overlay)
  types/           Typed data models matching src/data schemas
tests/             Vitest suites (content, map, systems)
scripts/           validate-content.ts CLI (content + maps + NPC placement)
design/            Locked decisions, world map, NPC cards, architecture, DB schema, protocol, classes, etc.
server/            Node/TS game server (HTTP + WebSocket, SQLite persistence, migrations)
```

## Phase status

> Full picture: **[`ROADMAP.md`](ROADMAP.md)** · Authoritative plan: **[`BuildPlan.md`](BuildPlan.md)**

**Client foundation (old single-player plan, built ✅):**
- **Phase 0 — Pre-Production:** ✅ complete
- **Phase 1 — Project Foundation:** ✅ complete (Vite + TS + Phaser 4 boot, placeholders, responsive layout)
- **Phase 2 — World & Player Movement:** ✅ complete (both zones, WASD/touch, collision, camera, transitions)
- **Phase 3 — NPCs & Interaction:** ✅ complete (5 NPCs, DOM dialogue panel, mailbox & signs, interaction prompt)

**Online plan (new):**
- **Phase 0 — Pivot Documentation:** ✅ complete (this documentation migration)
- **Phase 1 — Online Foundation:** ✅ built (server + SQLite + ASHAT Hub OIDC auth)
- **Phase 2 — Multiplayer Village:** ✅ built (client WS hookup, courier desk, presence + movement sync)
- **Phases 2–8:** see [`BuildPlan.md §19`](BuildPlan.md#19-phased-milestones)

## Design docs

| Doc | What |
|---|---|
| [`BuildPlan.md`](BuildPlan.md) | **Authoritative build plan** — online RPG, phases, scope, architecture overview |
| [`design/decisions.md`](design/decisions.md) | Locked decisions (2.5D, authority, classes, zones) |
| [`design/architecture.md`](design/architecture.md) | Client/server/SQLite responsibilities, HTTP, WS, lifecycle |
| [`design/database-schema.md`](design/database-schema.md) | SQLite entities, PK/FK, ownership, auth/secrets |
| [`design/network-protocol.md`](design/network-protocol.md) | WS/HTTP messages, validation, failure cases |
| [`design/classes.md`](design/classes.md) | Bear Warrior · Cat Mage · Fox Archer cards |
| [`design/combat.md`](design/combat.md) | Damage, health, defeat, respawn, validation |
| [`design/quests.md`](design/quests.md) | Quest chains, prerequisites, gated deliveries |
| [`design/monsters.md`](design/monsters.md) | Bramble Bug family, spawn, loot, respawn |
| [`design/dungeons.md`](design/dungeons.md) | Instance lifecycle, encounters, rewards |
| [`design/crafting.md`](design/crafting.md) | Materials, recipes, station, validation |
| [`docs/archive/`](docs/archive/) | 🗃 Historical single-player docs (non-authoritative) |

- `VOWS.md` — development practices that bind all work here
- `design/world-map.md`, `design/npcs.md` — legacy single-player references (retained for NPC/lore content)
