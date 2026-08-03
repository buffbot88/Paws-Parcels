# Paws & Parcels — Locked Design Decisions

> **Source of truth for implementation.** Updated for the **online 2.5D MMORPG pivot**
> (Phase 3.5, 2026-08-03). If any task conflicts with these decisions, stop and ask.
> Each decision lists **Decision · Reason · Consequences · Status**.
> Status markers: ✅ built · ⏭ next · ⬜ planned · ⚠ blocked or undecided · 🗃 archived
>
> Historical single-player decisions were archived to
> [`docs/archive/decisions-single-player.md`](../docs/archive/decisions-single-player.md).

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
  - **Logical/server coordinates:** tile-based `(x, y)` per zone, authoritative in MySQL.
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

### MySQL is accessed only by the server
- **Decision:** MySQL is reachable **only** from the server process(es). The browser never
  connects to MySQL directly.
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

### Player progression is persisted in MySQL
- **Decision:** All player progression (XP/level, stats, currency, inventory, quests,
  friendships, dungeon runs) persists in **MySQL** keyed by account/character.
- **Reason:** Persistent accounts + cross-session progression require server-side storage;
  localStorage cannot provide multi-device or authoritative persistence.
- **Consequences:** Save system moves entirely server-side; migration scripts versioned.
- **Status:** ✅ decided.

### localStorage is limited to non-authoritative client settings
- **Decision:** localStorage may hold **only** client settings (audio volumes, text speed,
  UI toggles, control bindings, cached login hint). Never gameplay state.
- **Reason:** Gameplay state is authoritative and must live server-side; local copies would
  desync and invite cheating.
- **Consequences:** A save system is no longer a client feature; "progress survives
  refresh" is replaced by "progress persists on the server."
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

### Zones (carried over, now multiplayer)
- **Decision:** Existing zones remain: `zone-post-office` (Main Village hub — safe) and
  `zone-bramble-patch` (outdoor map — first monster map). Whispering Pines / Sunlit
  Clearing IDs stay reserved. The first dungeon is a new instanced zone.
- **Reason:** Phases 0–3 shipped these maps; reusing them keeps client work and content.
- **Consequences:** Bramble Patch gains monster spawns (excluded from the village);
  zone transitions become server-validated join/leave.
- **Status:** ✅ built (maps) / ⬜ planned (monster content).

### ID conventions (retained)
- **Decision:** Stable kebab-case prefixed IDs (`zone-`, `npc-`, `item-`, `quest-`,
  `upgrade-`, `dialogue-`) — never renamed once data exists.
- **Reason:** Already the backbone of content validation; MySQL keys reuse them.
- **Consequences:** New entities (classes, monsters, dungeons, recipes) adopt the same
  convention (`class-`, `monster-`, `dungeon-`, `recipe-`).
- **Status:** ✅ built.

### Economy (retained, now audited)
- **Decision:** Currency is **Stamps**, server-issued, with **audit/economy events** logged
  to MySQL for every grant/spend. Cozy tuning (no required grinding) is preserved.
- **Reason:** Stamps are already established; server-side audit adds anti-cheat.
- **Consequences:** Every economy mutation goes through one validated server path.
- **Status:** ✅ decided.

### Friendship/reputation (retained, server-side)
- **Decision:** NPC friendship levels 0–4 (thresholds 3 / 7 / 12 / 18) are retained as the
  reputation system, but **persisted server-side** (level stored, per NPC) and used as
  quest-chain gates.
- **Reason:** The cozy relationship loop is core to the identity; it becomes part of
  progression + quest prerequisites.
- **Consequences:** `friendships` table in MySQL; reputation changes are server-validated;
  the no-two-level-jump invariant still applies to rewards.
- **Status:** ✅ decided (content) / ⬜ planned (server persistence).

---

## 4. Controls (retained from single-player)

- **Decision:** Desktop: WASD/arrows move · E/Space interact · attack via mouse-click or
  hotkey per class · I inventory · J journal · Esc close. Mobile: virtual pad + on-screen
  interact/attack buttons.
- **Reason:** Shipped input already works; combat adds an attack input.
- **Consequences:** InputSystem gains attack intents; mobile gets an attack button.
- **Status:** ✅ built (movement/interact) / ⬜ planned (attack).

## 5. Open questions (⚠)

- Server language/framework within the TS ecosystem (Node + ws/µWebSockets vs. Deno) —
  decision deferred to Phase 1 implementation, **not** blocked.
- Zone capacity exact number and snapshot rate (16–32 players, 10–20 Hz) — tunable at
  load test (Phase 8).
- Account identity: email-only vs. username+email — Phase 1 detail.
- Whether existing `src/data` JSON remains the content source of truth or migrates to
  MySQL seed data — lean: JSON stays, MySQL mirrors it (content ≠ player state).
