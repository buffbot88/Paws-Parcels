# Paws & Parcels

A cozy, browser-based 2D RPG where players become a tiny animal courier in a magical forest — delivering letters, gathering resources, and building friendships. No combat, no timers, no stress.

## Stack

- **Engine:** Phaser 4 (Canvas/WebGL)
- **Language/Tooling:** TypeScript, Vite 8
- **UI:** DOM-over-Canvas (HTML/CSS layered above the game canvas)
- **Persistence:** localStorage via a versioned `SaveData` schema (Phases 4+)
- **Tests:** Vitest
- **Hosting:** any static host (Vercel, Netlify)

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

> **Windows note:** the repo folder contains `&` (`Paws&Parcels`), which breaks npm's
> `node_modules/.bin` PATH shims. Scripts call tools via explicit
> `node node_modules/...` paths — keep them that way.

## Project structure

```
public/            Static assets (favicon; art lands here in Phase 8)
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
design/            Locked decisions, world map, NPC cards (Phase 0)
```

## Phase status

> Full picture of what's built vs. what's next: **[`ROADMAP.md`](ROADMAP.md)**

- **Phase 0 — Pre-Production:** ✅ complete (design locked, content in `src/data`, validated)
- **Phase 1 — Project Foundation:** ✅ complete (Vite + TS + Phaser boot, placeholder textures, responsive layout, dev README)
- **Phase 2 — World & Player Movement:** ✅ complete (both zones from `design/world-map.md`, WASD/arrow + touch movement, wall collision, camera follow, zone transitions)
- **Phase 3 — NPCs & Interaction:** ✅ complete (5 NPCs from `npcs.json`, DOM dialogue panel, tap/E-space interact, mailbox & signs, interaction prompt)
- **Phase 4 — Inventory & Gathering:** ⏭ next
- Phases 4–9: see [`ROADMAP.md`](ROADMAP.md) and `BuildPlan.md` §6.

## Design docs

- `Spec.md` — full product spec
- `BuildPlan.md` — MVP build plan and roadmap
- `design/decisions.md` — locked decisions (resolution 960×540, 48×48 tiles, Scale.FIT; custom-JSON maps over Tiled)
- `design/world-map.md`, `design/npcs.md` — world + character reference
- `VOWS.md` — development practices that bind all work here
