# Paws & Parcels — Online RPG Build Plan

> **Status: 🏛 AUTHORITATIVE (Phase 3.5 documentation pivot, 2026-08-03).**
> This plan supersedes the archived single-player plan
> ([`docs/archive/BuildPlan-single-player.md`](docs/archive/BuildPlan-single-player.md)).
> Locked decisions: [`design/decisions.md`](design/decisions.md). Architecture:
> [`design/architecture.md`](design/architecture.md). Schema: [`design/database-schema.md`](design/database-schema.md).
> Protocol: [`design/network-protocol.md`](design/network-protocol.md).
> Status markers: ✅ built · ⏭ next · ⬜ planned · ⚠ blocked or undecided · 🗃 archived

---

## 1. Product Vision

Paws & Parcels is a **cozy, browser-based 2.5D online RPG (MMORPG-lite)** where players
are tiny animal couriers in a magical forest. The cozy identity — warm visuals, friendly
NPCs, deliveries, Stamps currency, no permanent failure states — is **retained**, but the
world is now **shared, persistent, and server-authoritative**:

- A persistent **account and character** for every player.
- **Other players visible** in shared zones (Main Village + outdoor maps).
- **Three animal classes**: Bear **Warrior**, Cat **Mage**, Fox **Archer**.
- **Monsters** roam outdoor maps; **combat** with health, damage, defeat, respawn.
- **Quest chains** with prerequisites; some parcels/letters are only handed over after
  earlier quests in the chain are complete.
- **Dungeons** (instanced) with gear-crafting and upgrade materials.
- **Inventory, equipment, progression, crafting** — all persisted server-side.
- Cute and cozy visual identity **despite** the added combat (no gore, no perma-death,
  defeat = respawn at the village with items kept).

The game is **not** a full 3D MMO. The first online milestone targets **isometric /
pseudo-3D rendering** (Phaser 4 client, 2D sprites, depth sorting, tile-based logic
coordinates). See the 2.5D decision in [`design/decisions.md`](design/decisions.md).

## 2. MMO Terminology & Scope

| Term | Meaning here |
|---|---|
| Server-authoritative | The game server owns and decides all gameplay state; the client renders intent. |
| Zone | A tiled world area (e.g. Main Village, Happy Valley, Dungeon X). Players are synchronized per zone. |
| Outdoor map | A shared, persistent world zone that may contain monsters. |
| Dungeon | An **instanced** zone created per party/run; isolated from the outdoor map. |
| Player snapshot | Periodic server → client position/state broadcast for other players. |
| Intent | Client sends *intent* messages (move, attack, interact); the server validates and decides. |
| Class | Bear Warrior / Cat Mage / Fox Archer — chosen at character creation, persisted in SQLite. |
| Quest chain | An ordered sequence of quests with prerequisites and locked next-step rewards. |
| Instance | A private copy of a zone (dungeons); only its party/owner sees and mutates it. |

**MVP scope (vertical slice):** 1 server · accounts + auth · 3 classes · Main Village +
1 outdoor monster map + 1 dungeon · 1 monster family (3–4 species) · 1 quest chain
(3–5 quests incl. a gated delivery) · combat (basic attacks, defeat, respawn) ·
inventory + equipment · crafting station + small recipe set · WebSocket sync for
2–16 players per zone.

## 3. Client–Server Architecture

```text
┌──────────────┐   HTTPS (REST: auth, content, character mgmt)   ┌──────────────────┐
│   Browser    │ ──────────────────────────────────────────────► │                  │
│   Phaser 4   │   WebSocket (WS: gameplay, zone sync, combat)   │  Game/API Server │ ──► SQLite
│   client     │ ──────────────────────────────────────────────► │  (authoritative) │
└──────────────┘                                                 └──────────────────┘
        ▲                                                                   │
        └──────────────── client renders server state ─────────────────────┘
```

- The browser **never** connects to SQLite directly (see [`design/architecture.md`](design/architecture.md)).
- HTTP for login/register, character list/create, static content, health checks.
- WebSocket for all gameplay: zone join/leave, movement, interaction, combat, quests,
  inventory, dungeon sessions.
- Both channels are authenticated: WS carries a session token; HTTP carries JWT
  (see [`design/network-protocol.md`](design/network-protocol.md)).

## 4. Authoritative Ownership Rules

The server is the single source of truth. Client input is **untrusted**.

| Concern | Owned by | Why |
|---|---|---|
| Position / movement | Server (validates speed, collision, teleport sanity) | Anti-cheat, consistency |
| Health / damage / defeat | Server (all combat math) | Anti-cheat, fair PvE |
| Quest state & completion | Server (validates prerequisites & delivery) | Chain integrity |
| Inventory & item ownership | Server (validate quantity, stack, slots) | Economy integrity |
| Currency (Stamps) | Server (audited via economy events) | Economy integrity |
| Character stats / progression | Server (SQLite) | Persistence |
| Client settings (audio, UI) | Client (localStorage) | Non-authoritative |

**Client rights:** render state, send intents, show predicted movement (reconciled with
server), local settings.

## 5. Multiplayer Requirements

- Presence: players in the same zone see each other (avatar + name tag).
- Zone sync: join/leave broadcasts; per-player snapshots at a fixed rate (see
  [`design/network-protocol.md`](design/network-protocol.md)).
- Movement: client sends `move_intent`; server validates and rebroadcasts snapshots.
- Disconnect/reconnect: session token survives reconnect; player rejoins the zone they
  were in (grace period), else returns to Main Village.
- Zone capacity: cap concurrent players per zone (e.g. 32) with graceful queueing.
- Scalability: server processes are zone-sharded (Phase 8+), sharing the SQLite file.

## 6. Class System

Chosen at character creation; stored in SQLite (`character_classes`). Three classes —
see [`design/classes.md`](design/classes.md) for full cards.

| Class | Animal | Role | Primary resource | Basic attack | Starter ability |
|---|---|---|---|---|---|
| Warrior | Bear | Melee tank/damage | Stamina | Swipe (melee) | Bear Hug (taunt + shield) |
| Mage | Cat | Ranged magic burst | Mana | Spark (ranged bolt) | Moonbeam (AoE) |
| Archer | Fox | Ranged sustain | Focus | Arrow shot | Quick Volley (3 arrows) |

All stats derive from the class template + level in SQLite (`character_stats`).

## 7. Combat System

See [`design/combat.md`](design/combat.md). Summary:

- **Server-computed** damage: `damage = attack − defense`, modifiers, crit, level scaling.
- Health, defeat (HP ≤ 0 → respawn at Main Village, no item loss), monster respawn timers.
- Attacks are cooldown-gated intents (`attack` message); server validates target in range,
  alive, and cooldown elapsed.
- Cozy guardrails: no PvP, no permanent death, no XP loss on defeat.

## 8. Monster Maps

See [`design/monsters.md`](design/monsters.md). Rules:

- **Monsters cannot spawn inside the protected Main Village** (safe hub).
- Outdoor maps (Happy Valley) contain monsters by zone + level range.
- First family: **Happy Valley Critters** (boar, fox, hare, deer, black grouse) — level 1–3.
- Respawn: fixed timers per monster type; loot drops to the defeating player.

## 9. Quest-Chain System

See [`design/quests.md`](design/quests.md). Summary:

- Quests have prerequisites (quest and/or friendship/reputation gates).
- Ordered quest states: locked → available → active → complete.
- Rewards: Stamps, XP, items, reputation, and **unlocks** (next quest, parcel/letter).
- **Delivery gating:** a parcel/letter quest can only be *started* once its prerequisite
  chain is complete — NPCs refuse to hand over mail early.
- **Completion is validated server-side**: quest giver, required items, prerequisites,
  and delivery target are all checked by the server, never trusted from the client.

## 10. Delivery System

- Delivery quests involve: sender NPC → parcel/letter item → recipient NPC.
- The parcel item is **locked into the character's inventory** while the quest is active
  (cannot be sold/dropped).
- Delivery validation on the server: interact with the correct recipient while holding
  the correct item and the quest state is active.
- Reward: Stamps + XP + reputation; chain completions unlock higher-tier deliveries.

## 11. Inventory & Equipment

- Server-authoritative inventory: slots, stacks, item ownership (per character).
- Equipment slots: head, body, weapon, accessory. Gear modifies `character_stats`.
- Item transactions (buy, sell, equip, quest reward, loot) are server-validated and
  audited via `audit_economy_events`.
- See [`design/database-schema.md`](design/database-schema.md) (`inventories`,
  `inventory_items`, `equipment`) and [`design/network-protocol.md`](design/network-protocol.md)
  (`equip_item`).

## 12. Dungeon System

See [`design/dungeons.md`](design/dungeons.md). Summary:

- **Instanced**: each run gets its own zone instance; isolated from outdoor maps.
- Entry requirements: level + quest-chain prerequisite (e.g. "Den of the Great Boar").
- Party or solo; instance lifecycle: create → enter → run → complete/fail → destroy.
- Encounters: trash packs + boss; rewards: gear-crafting materials + upgrade materials.
- Failure = respawn at dungeon entrance or instance reset (no permanent loss).

## 13. Crafting & Upgrade Materials

See [`design/crafting.md`](design/crafting.md). Summary:

- **Gear materials** (dungeon drops) → craft equipment.
- **Upgrade materials** (monster drops + dungeon) → upgrade existing gear levels.
- Recipes live in SQLite (`item_definitions` + recipe fields) and are validated server-side:
  materials present, station used, level cap respected.
- One crafting station in the MVP (in Main Village).

## 14. SQLite Persistence

- SQLite is the only persistence layer for **player state** (accounts, characters,
  stats, inventory, quests, friendships, dungeon runs, economy audit).
- **localStorage is limited to non-authoritative client settings** (audio, UI,
  controls) — never gameplay state.
- All queries server-side; credentials in server env/secrets only.
- Schema + entity ownership: [`design/database-schema.md`](design/database-schema.md).
- Migrations are versioned and run by the server at boot (Phase 1).

## 15. Authentication Requirements

- Register + login with email/password; **passwords never stored in plain text**
  (argon2/bcrypt hashing).
- Session model: short-lived JWT/access token (HTTP) + refresh token (server-held,
  rotated); WebSocket authenticated with the same session token.
- Token handling, revocation, and secret management: see
  [`design/database-schema.md`](design/database-schema.md) (§Auth) and
  [`design/architecture.md`](design/architecture.md) (§Auth flow).
- Reconnect: token re-auth within a grace window resumes the session/zone.

## 16. Testing Strategy

- **Unit** (server): stat math, combat validation, quest-chain state machine, inventory
  rules, token handling.
- **Integration** (server + SQLite in CI): persistence, auth flow, economy events.
- **Multiplayer integration** (Phase 8): two+ clients, movement sync, combat events,
  reconnect, dungeon lifecycle.
- **Load tests**: N concurrent connections per zone; snapshot rate under load.
- **Client tests**: existing Vitest suites stay for content/map validation; add
  protocol-message encode/decode tests.
- **Security review** before public alpha.

## 17. Deployment Requirements

- **Single-process hosting (locked):** one Node process serves the built client
  (`dist/` via `server/src/static/client.ts`) + the HTTP API + the WebSocket endpoint
  on one port. The client uses same-origin relative URLs (`/api/*`,
  `ws(s)://same-origin/ws`), so no CORS or proxy layer is needed in production.
- **Host:** any always-on Node host — Render (web service), Fly.io, a VPS, or Oracle
  Cloud Always-Free — running `npm run build && npm run start:server`.
  Vercel/Netlify can host the client alone, but the game server (long-lived
  WebSockets + SQLite writes) **cannot** run on serverless: functions cap connection
  lifetime and the filesystem is read-only/ephemeral.
- **Secrets:** `server_config.json` is gitignored; PaaS deploys generate it from env
  vars via `scripts/write-server-config.mjs` (see `render.yaml` blueprint).
- **Port:** PaaS hosts inject the listen port via `$PORT`; the config honors it
  (`server_config.json` port is the local default).
- **Migrations:** run on deploy (or a one-shot job), versioned, idempotent.
- **Observability:** structured logs + health check endpoint + error reporting
  (see [`design/architecture.md`](design/architecture.md)).
- **Public alpha checklist:** security review, load test, browser matrix, deployment doc
  (Phase 8).

## 18. Security Requirements

- Client input untrusted everywhere; server validates all intents.
- No direct DB access from browser; CORS + CSP on HTTP; origin checks on WS.
- Rate limiting on auth endpoints and message spam; input length limits.
- Password hashing (argon2id/bcrypt), token rotation, expiry, revocation.
- Economy/ownership validation: every item/currency mutation is server-validated and
  audited.
- Secrets managed via env/secrets store, never committed.

## 19. Phased Milestones

### Phase 0 — Pivot Documentation & Architecture Spike — ✅ built (docs)
- [x] Archive contradictory single-player plans → [`docs/archive/`](docs/archive/)
- [x] Rewrite `BuildPlan.md` and `design/decisions.md`
- [x] Add `design/architecture.md`, `design/database-schema.md`, `design/network-protocol.md`
- [x] Add `design/classes.md`, `design/combat.md`, `design/quests.md`, `design/monsters.md`,
      `design/dungeons.md`, `design/crafting.md`
- [x] Lock the 2.5D approach (isometric/pseudo-3D, Phaser 4)
- [x] Define server boundaries, DB ownership, first WS protocol, vertical-slice scope

### Phase 1 — Online Foundation — ✅ built
- [x] Create server application (Node/TS, same monorepo or sibling package)
- [x] Configuration + environment handling
- [x] SQLite connection + versioned migrations (001–004)
- [x] Health check endpoint + structured server logging
- [x] Account & character data models
- [x] Authentication foundation (ASHAT Hub OIDC + JWT sessions)

### Phase 2 — Multiplayer Village — ✅ built
- [x] Connect client to server (HTTP + WS)
- [x] Authenticate a player; join Main Village
- [x] Synchronize player presence (other players visible)
- [x] Synchronize movement (`move_intent` + snapshots)
- [x] **Validate movement server-side** (speed, collision, teleport sanity)
- [x] Handle disconnects and reconnects (grace window, zone resume)
- [x] Courier desk (character create/select) + in-game courier menu

### Phase 3 — Classes and Combat — ✅ built
- [x] Add Bear Warrior, Cat Mage, Fox Archer (stats from SQLite)
- [x] Add health and defeat states
- [x] Add one monster map (Happy Valley outdoor) + one monster family
- [x] Add basic attacks (cooldown-gated, server-computed)
- [x] Add damage validation + monster respawn + player respawn

### Phase 4 — Quest Chains and Deliveries — 🟡 in progress
- [x] Scope the first chain to Clover Village as a safe tutorial
- [x] Seed the five-step Clover Village Courier Circuit
- [x] Add server-created, quest-bound tutorial parcels
- [x] Add persisted quest state, delivery validation, and Stamp/XP/reputation rewards
- [x] Add WebSocket quest acceptance, NPC interaction, and quest updates
- [x] Add a client tutorial tracker and delivery feedback
- [ ] Add richer NPC quest dialogue and optional local side quests
- [ ] Expand quest content outward into Happy Valley after the tutorial is stable

### Phase 5 — Inventory and Equipment

> The tutorial includes only the minimal locked parcel slice needed for delivery quests; full inventory/equipment interactions remain Phase 5.
- Add server-authoritative inventory
- Add item ownership validation
- Add equipment slots + gear stats
- Add item rewards + secure item transactions (audited)

### Phase 6 — First Dungeon and Crafting
- Add one dungeon (instanced, isolated)
- Add dungeon entry requirements + encounters
- Add dungeon rewards (gear + upgrade materials)
- Add gear-crafting materials + upgrade materials
- Add one crafting station + a small recipe set

### Phase 7 — 2.5D Presentation and Content
- Replace placeholder visuals with class/monster/NPC sprites
- Add depth sorting + animations + effects + audio
- Add map polish + responsive UI polish

### Phase 8 — Testing and Online Release
- Multiplayer integration tests, combat tests, quest validation tests
- Database persistence tests, reconnection tests, load tests
- Security review, browser compatibility testing
- Deployment documentation + public alpha checklist

## 20. Quality Gates

| Phase | Gate |
|---|---|
| Every phase | `npm run typecheck` · `npm test` · `npm run validate` · `npm run build` pass (client); server: `tsc` + its own test suite |
| Phase 1 | Server boots, connects to SQLite, migrations run, health check 200, register/login works |
| Phase 2 | Two browsers see each other move; movement validation rejects teleports/speed hacks |
| Phase 3 | Combat math server-side; monster + player respawn work; damage validated |
| Phase 4 | Clover Village tutorial chain gating works end-to-end; delivery validated server-side |
| Phase 5 | Inventory/equipment owned & validated server-side; economy audited |
| Phase 6 | Dungeon instance lifecycle + crafting recipe validation pass |
| Phase 7 | No critical-path placeholders; depth sorting correct |
| Phase 8 | Security review passed; load + reconnection tests green; alpha checklist complete |

## 21. MVP / Vertical-Slice Definition of Done

**Vertical slice (Phases 1–3, first playable online):**
- [x] A player can register, log in, create a Bear/Cat/Fox character.
- [x] Two players in Main Village can see each other and move (server-validated).
- [x] A player can go to Happy Valley, fight wild critters, defeat/respawn, and be
      defeated and respawn at the village.

**MVP (Phases 1–6 complete):**
- One quest chain with a **gated delivery** completes end-to-end (server-validated).
- Inventory + equipment + crafting at the village station produce a craftable item.
- One dungeon run can be entered (solo or party), fought through, and looted.
- Progression (XP, Stamps, reputation, items) persists across logout/login in SQLite.
- Reconnect works within the grace window; no permanent progress loss.
- Server-validated: no client can grant itself items, HP, or quest completion.
- Runs at 60 FPS desktop / 30–60 FPS mobile for the client; snapshot sync smooth at
  zone cap.

## Design doc map

| Doc | Contents |
|---|---|
| [`design/decisions.md`](design/decisions.md) | Locked decisions (incl. 2.5D, authority, classes) |
| [`design/architecture.md`](design/architecture.md) | Client/server/DB responsibilities, lifecycle, errors |
| [`design/database-schema.md`](design/database-schema.md) | SQLite entities, ownership, auth/secrets |
| [`design/network-protocol.md`](design/network-protocol.md) | WS/HTTP messages, validation, failure cases |
| [`design/classes.md`](design/classes.md) | Warrior / Mage / Archer cards |
| [`design/combat.md`](design/combat.md) | Damage, health, defeat, respawn, validation |
| [`design/quests.md`](design/quests.md) | Chains, prerequisites, gated deliveries |
| [`design/monsters.md`](design/monsters.md) | Happy Valley critter family, spawn, loot, respawn |
| [`design/dungeons.md`](design/dungeons.md) | Instance lifecycle, encounters, rewards |
| [`design/crafting.md`](design/crafting.md) | Materials, recipes, station, validation |
| [`docs/archive/`](docs/archive/) | 🗃 Historical single-player docs (non-authoritative) |
