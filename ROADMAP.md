# Paws & Parcels — Development Roadmap

> 🗃 **Legacy single-player roadmap:** retired from the active repository; current planning lives below.
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
- **SQLite persistence** (accounts, characters, progression).
- **No PvP, no grinding, no real-money transactions.**

**Current standing:** Phases 0–3 of the **original single-player plan** are built and
remain the client foundation. Phase 0 (pivot docs), Phase 1 (**Online Foundation** —
server app, SQLite migrations, health check, ASHAT Hub OIDC auth, account + character
data models, character list/create/classes endpoints), Phase 2 (**Multiplayer
Village** — WebSocket presence + movement sync, courier desk), and Phase 3 (**Classes
and Combat** — Happy Valley open-world monster map, server-authoritative combat loop)
are complete. Next up: **Phase 5 — Inventory and Courier Equipment**. Phase 4A's tutorial circuit and the Phase 4B village side-quest slice are now implemented before broader Happy Valley progression.

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
- **Test suite:** 417 passing (server + client + content + maps + systems)

### Phase 0 — Pre-Production ✅
- Locked decisions: 960×540 @ 48×48 tiles, Scale.FIT, ID conventions, economy, friendship thresholds
- Content data: 5 NPCs, 37 items, 23 quests, 3 upgrades, 6 dialogue sets
- Data models: `PlayerState`, `SaveData`, `ItemDefinition`, `QuestDefinition`, `NPC`, etc.
- Validation: `ContentValidator` + `scripts/validate-content.ts`

### Phase 1 — Project Foundation ✅
- Vite 8 + TypeScript + Phaser 4
- Boot → Preloader → Overworld scene flow; runtime placeholder textures
- Responsive DOM layout; error logging
- Gates: `npm run dev` / `build` / `typecheck` all pass

### Phase 2 — World & Player Movement ✅
- Custom JSON maps (`clover-village` hub) with collision, camera; placeholder maps until Phase 3 adds outdoor zones
- Player entity (Arcade sprite, 180 px/s, 28×20 body, facing)
- WASD/arrows + pointer-drag joystick input
- Client-only movement (no server validation yet)

---

## 2. Next ⏭ (online plan phases)

### Phase 1 — Online Foundation ✅
Goal: server application, SQLite, auth, health check.
- Server (Node/TS, `server/src`) + config loader with fail-fast validation
- SQLite connection + versioned migrations (runner in `server/src/db/migrate.ts`,
  schema 001–004 incl. OIDC account columns)
- Health check + structured logging (`/api/health`)
- Account & character data models (`Account.ts`, `Character.ts`, `CharacterClass.ts`)
- Auth via **ASHAT Hub OIDC** (authorization code + PKCE, JWKS-verified) + JWT sessions
- Character endpoints: `GET/POST /api/characters`, `GET /api/classes`
- Gate: server `tsc` + Vitest suite green

### Phase 2 — Multiplayer Village ✅ complete
Goal: players see each other in the Main Village.
- **Server-side WebSocket layer built** (`server/src/ws/`): 30s single-use handshake
  tokens (`GET /api/ws-token`), `authenticate` / `join_zone` / `move_intent` /
  `leave_zone`, 20 Hz `player_snapshot` broadcasts, 60s reconnect grace window
- **Authoritative movement validation** (`movement.ts`): 4-direction intents,
  speed cap, collision from the same map JSON the client renders, teleport sanity
- **Zone presence store** (`zoneStore.ts`) + per-zone `player_joined`/`player_left`
- **Client hookup** (`GameSocket` / `NetworkSystem` / `RemotePlayer`): browser WS
  client, connection status chip, lerp-interpolated courier avatars, move intents
- **Courier desk** (`CharacterDesk`): character creation (name + `GET /api/classes`
  picker, `POST /api/characters`) and a select screen for multi-character
  accounts; the chosen courier persists across reloads
- Best-effort position persistence to SQLite on zone leave/grace expiry **and
  periodically every 10s while moving** (`GameServer` dirty-flag flush)

### Phase 3 — Classes and Combat ✅ complete
Goal: first monster map, basic combat, class system.
- **Happy Valley** open-world map (`src/data/maps/happy-valley.json`,
  `zone-happy-valley`, 40×26 outdoor, `is_safe 0`) with a south transition out of
  Clover Village; monsters are forbidden in the safe hub
- **Monster family authored in JSON** (`src/data/monsters.json` + `items.json`): Wild Boar
  (aggro melee), Valley Fox (aggro melee), Meadow Hare (passive), Forest Deer
  (passive), Black Grouse (aggro ranged) + 10 monster-material loot items
- **Server-authoritative combat** (`server/src/ws/combat.ts` + `monsterStore.ts`):
  damage formula with 20% floor, crits, class-based range/cooldown, resource costs
- **Monster AI:** aggro/leash, chase, melee/ranged attacks, defeat → loot rolls + XP
  grant, fixed-timer respawn
- **Player defeat:** respawn at the Clover Village spawn with full HP + 3s invuln
- **WS protocol:** `attack` (C→S); `monster_snapshot`, `combat_event`,
  `loot_received`, `player_respawned` (S→C); error codes `INVALID_TARGET`,
  `OUT_OF_RANGE`, `COOLDOWN_ACTIVE`, `INSUFFICIENT_RESOURCE`, `TARGET_DEAD`
- **Client:** Monster entity with HP bars + damage numbers, attack key (1),
  player HP chip, defeat/respawn handling
- Gate: combat math server-side; monster + player respawn work; damage validated

### Phase 4A — Clover Village Tutorial Quest Chain ✅
Goal: teach movement, interaction, quest acceptance, parcel carrying, and local deliveries entirely inside the safe hub.
- Five-step `Clover Village Courier Circuit`: Pip → Biscuit → Maple → Lumi → Moss → Pip
- Server-bound parcels with normal, fragile, and urgent tutorial conditions
- JSON-authored acceptance/completion dialogue and Courier graduation scene
- Urgent deadlines with retry-on-expiration and fragile reset-on-defeat behavior
- Ordered prerequisites, persisted progress, Stamp/XP/reputation rewards
- Final delivery promotes the character from Trainee to Courier
- Client tutorial tracker and server-confirmed delivery feedback

### Phase 4B — Village Side Quests ✅
Goal: add optional local errands and friendship-gated stories before opening broader progression.
- Ten optional errands and deliveries after the Courier Circuit
- Server-validated search objectives in Clover Village and Happy Valley
- Friendship-gated personal stories with cosmetic and keepsake rewards
- JSON-authored content with persisted per-character quest/friendship state

### Phase 5 — Inventory and Equipment 🔄
Goal: server-authoritative inventory + equipment with gear stats.

Initial vertical slice implemented:
- JSON-authored equipment definitions and six gear slots
- Ownership/lock/class/level validation for inventory transactions
- Equip, unequip, move, and request-inventory WebSocket actions
- Derived combat and courier effects, including satchel capacity and movement
- Append-only audit events for item grants and equipment transactions

Remaining polish: weather-system integration and deeper navigation/parcel-condition rules.

### Admin Control Panel — Foundation + Player Tools ✅ (new)
Goal: internal management surface for operating the live game (spec: "Admin Control Panel — UI/UX Design Specification", phases 1–2 of 7).

Built:
- **Backend** (`server/src/admin/`, `server/src/routes/admin.ts`, `server/src/models/Admin.ts`, migration `014_admin_panel.sql`): admin tier mapping from ASHAT Hub roles (Developer→developer, Admin→admin, GM/Moderator→moderator, Support/LiveOps→support; overridable via `server_config.json` → `admin.roleTiers`), append-only `admin_audit_log` (action/category/target/before/after/reason/request-id/IP/environment), `server_settings` key-value store (exp/drop/honor rates, max concurrent players, level cap), and suspend/ban enforcement in the HTTP auth path (403 `ACCOUNT_SUSPENDED`)
- **Admin API** (all tier-gated, every mutation audited): `GET /api/admin/{tier,overview,health,zones/status,players,players/:id,audit,audit/:id,settings}`, `POST …/players/:id/{status,grant-item,adjust,teleport,kick}`, `POST /api/admin/inventory/:instanceId`, `PUT /api/admin/settings`
- **Live runtime bridge** (`server/src/ws/adminRuntime.ts` + `GameServer.onlineCount/zonePlayerCounts/disconnectCharacter`): real online counts, per-zone player counts, admin kicks, and disconnect-on-ban/suspend/teleport
- **Frontend** (`admin.html` + `src/admin/`, vanilla TS DOM like the game UI, built as a second Vite entry): hash-routed panel at `/admin.html` with the spec's design tokens (forest-green sidebar, warm near-white surface, clover/parcel-gold accents, LIVE banner), dashboard (KPIs, server health, zone status, recent activity), players list (search/filters/bulk-select/pagination), player profile (tabs: Overview/Character/Inventory/Quests/Account/Admin History; action rail: grant item, adjust EXP/stamps, teleport, kick; danger zone with Level-3 typed confirmation for suspend/ban), audit log with detail drawer, and server settings cards with reason+confirm (Level 2)

### Admin Control Panel — Roles & Permissions + Session Hardening ✅ (new)
- **Roles & permissions (spec §70–71):** migration `015_admin_roles.sql` (`admin_roles`, `admin_role_permissions`, `admin_role_assignments`) seeded with the six default roles and their matrix rows; the matrix lives in SQLite and is editable live from the Roles & Permissions screen (per-cell confirm), with `permissionLabel()` title-casing any permission the curated label map has not caught up with. `resolveActorWithPermission` is the gate — tier floor **and** permission, with tier defaults when an account holds no roles. Guardrail: the last role holding `manage_roles` can never lose it, and the check only applies to the role that actually holds it (so other roles stay editable). Admin Users screen handles assign/revoke; every matrix and assignment change is audited with before/after state. Built-in (system) roles stay editable by design — `is_system` is a catalog badge, not a lock, so the seeded §71 rows can be tuned without a migration; the failure union is exhaustive by type so no unreachable branch can linger again.
- **Session hardening:** CSRF double-submit protection on all admin mutations (`paws_csrf` cookie + `X-Admin-CSRF` header, enforced in middleware); short-TTL (5-min) single-use HMAC step-up tokens minted via `POST /api/admin/step-up` with mandatory reason (audited); Level 3 operations (suspend/ban) server-side require the `X-Admin-Step-Up` header (401 `STEP_UP_REQUIRED` / 403 `STEP_UP_REPLAYED` on replay); panel UX chains typed-phrase → re-auth reason modal → step-up → mutation.

### Admin Control Panel — Item Database + Item Editor ✅ (new)
Goal: author and police the item catalog from the panel (spec §25–26) without hand-editing JSON for every tweak.

Built:
- **Durable catalog edits:** migration `016_item_editor.sql` adds `source`/`is_deleted`/`updated_at`/`updated_by` to `item_definitions`, and `syncItems()` now skips `source='admin'` rows — so a panel edit (or archive) survives restarts and deploys instead of being overwritten by the JSON sync. Archiving is a soft delete, so an archived catalog item is never resurrected either.
- **Item Database screen:** search across key/name/description, category + rarity + source filters with live counts, show-archived toggle, sortable columns, pagination, and per-row source/archived/rarity badges with the icon key, stack size, value, and last editor.
- **Item Editor screen:** identity (immutable key), presentation (category/rarity/icon/stack/value), a category-gated Equipment section (slot, required class/level, combat-stat and courier-effect repeaters), a Usage panel showing blast radius (owners, equipped count, monster loot tables, quest hand-ins/rewards), a required audit reason on every save, and a Danger Zone where archiving is Level 3 (typed key confirmation → re-auth reason → step-up token).
- **API + permissions:** `GET/POST /api/admin/items`, `GET /api/admin/items/meta`, `GET/PUT/DELETE /api/admin/items/:id`, `POST /api/admin/items/:id/{duplicate,restore}`, all gated by the new `edit_items` permission (Developer/Administrator/Content Designer) with full before/after audit rows in the `content` category; archived items are excluded from grants and quest hand-ins.

Deferred to later admin phases: mob/drop/NPC/quest/dialogue editors, draft→review→publish versioning, market/seasons/events/zones management, global Ctrl+K search, node-based quest designer.

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
- **Phase 1:** Online Foundation — ✅ built (server, SQLite, OIDC auth, characters)
- **Phase 2:** Multiplayer Village — ✅ complete (WS presence + movement sync, character create/select, periodic position persistence)
- **Phase 3:** Classes and Combat — ✅ complete (Happy Valley monsters, server-authoritative combat, respawn)
- **Phase 4A:** Clover Village Tutorial Quest Chain — ✅ complete
- **Phase 4B:** Village Side Quests — ✅ complete (initial slice)
- **JSON content migration:** Items, classes, monsters, loot tables, zones, and skills — ✅ complete
- **Phase 5:** Inventory and Equipment — 🔄 vertical slice in progress
- **Admin Control Panel (Phases 1–2):** Foundation + Player Tools — ✅ complete (see §2); Roles & Permissions + session hardening — ✅ complete
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
