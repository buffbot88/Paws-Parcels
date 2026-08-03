> ## 🗃 ARCHIVED — HISTORICAL DOCUMENT (non-authoritative)
>
> This is the **original single-player development roadmap**, preserved for history.
> It was superseded on **2026-08-03 (Phase 3.5 documentation pivot)** by the current
> [`ROADMAP.md`](../../ROADMAP.md) and [`BuildPlan.md`](../../BuildPlan.md), which
> track the **server-authoritative 2.5D multiplayer RPG/MMORPG** direction.
>
> Phases 0–3 listed here describe real, shipped single-player code that remains the
> **client foundation** for the new plan; phases 4–9 are **cancelled/superseded**.
> Status marker: 🗃 archived

# Paws & Parcels — Development Roadmap (ARCHIVED — single-player)

> Single source of truth for **what is built** and **what comes next**.
> Authoritative build plan: [`BuildPlan.md`](BuildPlan.md) · Locked decisions: [`design/decisions.md`](design/decisions.md) · Status markers: ✅ built · ⏭ next · ⬜ planned

## 0. Project vision (30-second version)

A cozy browser-based 2D RPG where the player is a tiny animal courier: **accept deliveries → explore zones → gather resources → talk to NPCs → deliver → earn Stamps & friendship → buy upgrades → return next in-game day**. No combat, no timers, no failure states. MVP = 5 NPCs · 2 zones · ~19 quests · 20 items · 3 upgrades · local save.

**Current standing:** Phases 0–3 complete. The game boots (Phaser 4), both MVP zones are walkable with collision, camera, and zone transitions, and all 5 NPCs plus the mailbox/signs are interactive with a DOM dialogue panel. Next up: **Phase 4 — Inventory & Gathering**.

---

## 1. Built ✅

### Phase 3 — Interaction & Dialogue ✅
Talk to the whole forest.
- **NPC entities:** `src/entities/NPC.ts` — 5 placeholder blobs tinted per NPC, name tags, gentle bob; placed from `npcs.json` `homeZone`/`homeTile` (3 home tiles corrected to walkable spots in Phase 3)
- **Interaction:** `src/systems/InteractionSystem.ts` + `findFocusedTarget` (nearest in-range, NPCs win ties); prompt shown above the player (E / Space / tap)
- **Input:** `InputSystem` gained tap-vs-drag disambiguation (joystick only engages past 8px) + E/Space interact edge
- **Dialogue:** `src/ui/DialoguePanel.ts` DOM overlay — multi-line, click/tap/Enter/E/Space advance, Esc closes, focus in/out; `DialogueService.selectDialogueSet` picks lines by friendship level (future-proof for Phase 6)
- **Map objects:** `interactables` added to map JSONs — counter, quest board, mailbox, shop, welcome sign (post office) + trail sign (Bramble), each with cozy flavor lines until its real system lands
- **Validation:** every NPC must have ≥1 dialogue set; interactables in-bounds/unique/reachable/wall-mounted OK; NPC home tiles must be walkable — all enforced by tests + CLI

**Test suite today:** 69 passing (content + map + systems).

### Phase 0 — Pre-Production ✅
Locked the smallest playable version before writing code.
- **Design docs:** `design/decisions.md` (960×540 @ 48×48 tiles, Scale.FIT, ID conventions, economy, friendship thresholds 3/7/12/18), `design/world-map.md` (both zones sketched in tile units), `design/npcs.md` (5 NPC cards)
- **Content data:** `src/data/{npcs,items,quests,upgrades,dialogue}.json` — 5 NPCs, 20 items, 19 quests, 3 upgrades, 6 dialogue sets; stable kebab-case IDs
- **Data models:** `src/types/*.ts` — `PlayerState`, `SaveData`, `ItemDefinition`, `QuestDefinition`, `NPC`, `UpgradeDefinition`, `DialogueSet`, `ContentData`
- **Validation:** `src/systems/ContentValidator.ts` + `scripts/validate-content.ts` CLI (duplicate IDs, broken refs, no-two-level friendship jump, etc.)

### Phase 1 — Project Foundation ✅
A running Phaser application with a reliable dev workflow.
- Vite 8 + TypeScript + **Phaser 4** (user-confirmed deviation from BuildPlan's Phaser 3)
- Boot → Preloader → Overworld scene flow; placeholder geometric textures generated at runtime (no binary assets until Phase 8)
- Responsive DOM layout (`index.html` + `src/styles/global.css`), error logging (`src/game/ErrorLog.ts`), dev README
- Gates: `npm run dev` / `build` / `typecheck` all pass

### Phase 2 — World & Player Movement ✅
Both zones explorable.
- **Maps:** `src/data/maps/{post-office,bramble-patch}.json` — custom JSON (ASCII rows → tileset sheet), 30×20 / 40×26, validated by `src/systems/MapValidator.ts`
- **Player:** `src/entities/Player.ts` — Arcade sprite, 180 px/s, small 28×20 body, facing tracking
- **Input:** `src/systems/InputSystem.ts` — WASD/arrows + pointer-drag virtual joystick (Phaser 4 has no built-in joystick)
- **World:** `src/scenes/OverworldScene.ts` — tilemaps from JSON, `setCollision` on walls/water/trees, camera `setBounds` + `startFollow`, tile-based zone transitions (`scene.restart({ zoneId, spawn })`)
- **Verified end-to-end in browser:** walls block, camera clamps, south walk → Bramble Patch at (19,1), north walk → post office at (15,14), zero console errors

**Test suite today:** 50 passing (content-validation + map-validation incl. crash-regression).

---

## 2. Next ⏭

### Phase 4 — Inventory & Gathering *(next phase)*
Goal: add exploration rewards and item collection (BuildPlan §6). Exit criteria: 5+ gatherable resources; 12-slot inventory; stack/capacity enforcement; gathering nodes respond after collection; inventory UI reflects state instantly.
- Item definitions (`src/data/items.json` already has 20) + inventory state
- Gathering nodes (berry bushes, flower fields, pond, herbs) tied to map tiles
- Inventory panel as a **DOM component**
- Pickup feedback, inventory-full handling, capacity rules (12 + 6/bag)

---

## 3. Planned ⬜ (Phases 4–9, per BuildPlan §6)

### Phase 4 — Inventory & Gathering
- Inventory state + capacity rules (12 slots, +6 per satchel upgrade)
- Gathering nodes (berry bushes, flower fields, pond, logs)
- Inventory panel (DOM) with quantities, stack limits, inventory-full feedback

### Phase 5 — Delivery Quest Loop *(the core loop)*
- Quest acceptance, active tracking, delivery validation
- Stamp + friendship rewards, completion feedback
- Daily quest generation (3 standard + 1 gathering + 1 friendship; impossible-combination guard)
- **This phase proves the MVP's central gameplay loop.**

### Phase 6 — Progression & Journal
- Friendship levels (0–4) with progress bars and dialogue unlocks
- Journal (active/completed quests, NPC relationships, discovered items)
- Shop + 3 upgrades (Bigger Satchel, Comfy Boots, Express Badge), cosmetic support

### Phase 7 — Save System & Settings
- Versioned `SaveData` in localStorage (migration support), autosave on quest completion / purchase / friendship change / zone change
- New Game / Continue / Delete flows, corrupt-save fallback
- Settings: audio volumes, text speed, high-contrast, reduced-motion

### Phase 8 — Art, Audio & Polish
- Replace placeholder shapes: player/NPC sprites, portraits, final tilesets, item icons
- Animations (walk/idle, mailbox, pickup, delivery handoff, rewards)
- Music + SFX with independent mute; UI transitions, reward effects, tutorial prompts, empty states

### Phase 9 — Testing & Release
- Functional / responsive / accessibility / performance testing
- Automated e2e (`tests/e2e/`: new-game, delivery-loop, save-load) + manual playtest (3 testers)
- **MVP Definition of Done** (BuildPlan §11): deployed to a public URL, complete delivery loop, progress survives refresh, 30+ FPS desktop & mobile

---

## 4. Post-MVP backlog (reserved, not in MVP scope)

- **Whispering Pines** & **Sunlit Clearing** zones — IDs already reserved (`zone-*`); Spec §17 discrepancy resolved: BuildPlan is authoritative, only Bramble Patch ships in MVP
- **V1.1** More stories (NPCs, quest chains, friendship scenes) · **V1.2** Crafting · **V1.3** Home customization · **V1.4** Seasonal events · **V1.5** Cloud saves
- Out of scope permanently: multiplayer, combat, accounts, procedural worlds, housing, real-money purchases

---

## 5. Quality gates & how we stay honest

| Gate | Check |
|---|---|
| Every phase | `npm run typecheck` · `npm test` · `npm run validate` · `npm run build` all pass |
| Every phase | Browser-verified (movement/collision/transitions; then dialogue, gathering, delivery…) |
| Code review | `code-reviewer-deepseek-flash` after each implementation pass |
| Content integrity | `node scripts/validate-content.ts` (content + maps) |
| Progress tracking | This file + `README.md` phase status table updated at the end of each phase |

**One rule from VOWS:** content-first discipline — keep the delivery loop playable before adding art/scope; placeholders stay until Phase 8.
