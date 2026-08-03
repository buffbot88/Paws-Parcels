# Paws & Parcels — Development Roadmap

> 🗃 **Legacy/archived single-player roadmap:** [`docs/archive/ROADMAP-single-player.md`](docs/archive/ROADMAP-single-player.md)
> **Current authoritative plan:** [`BuildPlan.md`](BuildPlan.md) (online 2.5D MMORPG pivot)
> Locked decisions: [`design/decisions.md`](design/decisions.md) · Architecture: [`design/architecture.md`](design/architecture.md)
> Status markers: ✅ built · ⏭ next · ⬜ planned · ⚠ blocked or undecided · 🗃 archived

---

## 0. Project vision (30-second version)

Paws & Parcels is now a **cozy, browser-based 2.5D online RPG (MMORPG-lite)** where
players are tiny animal couriers in a shared magical forest. The cozy soul — warm
visuals, friendly NPCs, deliveries, Stamps, no permanent failure — is retained. The
world is now **persistent, server-authoritative, and multiplayer**:

- **Shared zones** with other players visible.
- **Three animal classes:** Bear Warrior, Cat Mage, Fox Archer.
- **Monsters + combat** (no gore, no perma-death).
- **Quest chains** with gated parcel/letter deliveries.
- **Instanced dungeons** with gear-crafting materials.
- **MySQL persistence** (accounts, characters, progression).
- **No PvP, no grinding, no real-money transactions.**

**Current standing:** Phases 0–3 of the **original single-player plan** are built and
remain the client foundation. Phase 0 (pivot docs) and Phase 1 (**Online Foundation** —
server app, MySQL migrations, health check, ASHAT Hub OIDC auth, account + character
data models, character list/create/classes endpoints) are complete. Next up:
**Phase 2 — Multiplayer Village** (WebSocket presence + movement sync).

---

## 1. Built ✅ (client foundation, phases 0–3 of the original plan)

> These phases are the single-player client that will be **wired to the server** starting
> in Phase 1 of the new plan. They are **not** authoritative for the online game; they
> are the rendering and content foundation.

### Phase 3 — Interaction & Dialogue ✅
- **NPC entities:** `src/entities/NPC.ts` — 5 placeholder blobs tinted per NPC, name tags, gentle bob; placed from `npcs.json`
- **Interaction:** `src/systems/InteractionSystem.ts` + `findFocusedTarget`; prompt shown above the player
- **Input:** `InputSystem` with tap-vs-drag disambiguation + E/Space interact
- **Dialogue:** `src/ui/DialoguePanel.ts` DOM overlay — multi-line, Esc closes, focus in/out;
`DialogueService` friendship-level-aware set selection
- **Map objects:** interactables (counter, quest board, mailbox, shop, signs) with flavor lines
- **Validation:** NPCs must have dialogue sets; home tiles walkable; interactables unique/reachable
- **Test suite:** 69 passing (content + map + systems)

### Phase 0 — Pre-Production ✅
- Locked decisions: 960×540 @ 48×48 tiles, Scale.FIT, ID conventions, economy, friendship thresholds
- Content data: 5 NPCs, 20 items, 19 quests, 3 upgrades, 6 dialogue sets
- Data models: `PlayerState`, `SaveData`, `ItemDefinition`, `QuestDefinition`, `NPC`, etc.
- Validation: `ContentValidator` + `scripts/validate-content.ts`

### Phase 1 — Project Foundation ✅
- Vite 8 + TypeScript + Phaser 4
- Boot → Preloader → Overworld scene flow; runtime placeholder textures
- Responsive DOM layout; error logging
- Gates: `npm run dev` / `build` / `typecheck` all pass

### Phase 2 — World & Player Movement ✅
- Custom JSON maps (`post-office`, `bramble-patch`) with collision, camera, zone transitions
- Player entity (Arcade sprite, 180 px/s, 28×20 body, facing)
- WASD/arrows + pointer-drag joystick input
- Client-only movement (no server validation yet)

---

## 2. Next ⏭ (online plan phases)

### Phase 1 — Online Foundation ✅
Goal: server application, MySQL, auth, health check.
- Server (Node/TS, `server/src`) + config loader with fail-fast validation
- MySQL connection + versioned migrations (runner in `server/src/db/migrate.ts`,
  schema 001–004 incl. OIDC account columns)
- Health check + structured logging (`/api/health`)
- Account & character data models (`Account.ts`, `Character.ts`, `CharacterClass.ts`)
- Auth via **ASHAT Hub OIDC** (authorization code + PKCE, JWKS-verified) + JWT sessions
- Character endpoints: `GET/POST /api/characters`, `GET /api/classes`
- Gate: server `tsc` + Vitest suite green

### Phase 2 — Multiplayer Village *(next phase)*
Goal: players see each other in the Main Village.
- Connect client to server (HTTP + WS)
- Authenticate, join zone, sync presence
- Movement validation + snapshots
- Disconnect/reconnect handling

### Phase 3 — Classes and Combat
Goal: first monster map, basic combat, class system.
- Bear Warrior / Cat Mage / Fox Archer
- Server-side stats, HP, defeat state
- Bramble Patch monsters (Bramble Bug family)
- Basic attacks + monster/player respawn

### Phase 4 — Quest Chains and Deliveries
Goal: server-validated quest chains with gated deliveries.

### Phase 5 — Inventory and Equipment
Goal: server-authoritative inventory + equipment with gear stats.

### Phase 6 — First Dungeon and Crafting
Goal: instanced dungeon + crafting station with recipes.

### Phase 7 — 2.5D Presentation and Content
Goal: sprites, depth sorting, animations, audio.

### Phase 8 — Testing and Online Release
Goal: security review, load tests, browser matrix, alpha.

---

## 3. Planned ⬜ (all details in new BuildPlan.md)

See [`BuildPlan.md §19`](BuildPlan.md#19-phased-milestones) for the complete phased plan.
Summary of phases:
- **Phase 0:** Pivot documentation — ✅ built
- **Phase 1:** Online Foundation — ✅ built (server, MySQL, OIDC auth, characters)
- **Phase 2:** Multiplayer Village — ⏭ next
- **Phase 3:** Classes and Combat
- **Phase 4:** Quest Chains and Deliveries
- **Phase 5:** Inventory and Equipment
- **Phase 6:** First Dungeon and Crafting
- **Phase 7:** 2.5D Presentation and Content
- **Phase 8:** Testing and Online Release

---

## 4. Post-MVP backlog (reserved)

- **More zones:** Whispering Pines, Sunlit Clearing
- **More monsters:** Shades, Sprites, Fungal Golems
- **More dungeon encounters**
- **Abilities at levels 5, 10, 15**
- **Status effects** (poison, slow, daze)
- **Consumables** (potions, food buffs)
- **Cosmetic equipment + dyes**
- **PvP dueling** (opt-in only)
- **Party system + group loot**
- **Leaderboards / achievements** (non-authoritative but server-tracked)
- **Out of scope permanently:** real-money purchases, housing, procedural worlds, voice acting

---

## 5. Quality gates & how we stay honest

| Gate | Check |
|---|---|
| Every phase | `npm run typecheck` · `npm test` · `npm run validate` · `npm run build` pass (client); server: `tsc` + test suite |
| Every phase | Browser-verified on desktop + mobile |
| Content integrity | `node scripts/validate-content.ts` (content + maps) |
| Progress tracking | This file + `README.md` updated at the end of each phase |

**One rule from VOWS:** content-first discipline — placeholders stay until Phase 7.
