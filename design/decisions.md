# Paws & Parcels — Locked Design Decisions

> **Source of truth for implementation.** Every value here was locked in Phase 0 (Pre-Production) and approved by the user. If a Phase 1+ task conflicts with these decisions, stop and ask.

## Rendering & Viewport
- **Game resolution:** 960×540 (16:9). Phaser `Scale.FIT` + `CENTER_BOTH`, min width 320px (Spec §16).
- **Tile size:** **48×48** (user-confirmed; Spec §12 allows 32 or 48).
- Visible area ≈ 20×11.25 tiles. World maps must be designed to this viewport.
- Rendering: Phaser 3 Canvas/WebGL. UI is **DOM-over-Canvas** — all menus/dialogue/inventory are HTML/CSS overlays, never built in Phaser (BuildPlan §1, §10 risk).

## Zones
- MVP zones (locked): `zone-post-office` (hub) and `zone-bramble-patch` (exploration).
- **Discrepancy resolved:** Spec §17 says "two exploration zones," but BuildPlan MVP scope + DoD define exactly one exploration zone (Bramble Patch). **BuildPlan is authoritative** — Whispering Pines and Sunlit Clearing are post-MVP, but IDs are reserved.
- Zone transition: south edge of the post office → north entrance of Bramble Patch.

## ID Conventions (stable, kebab-case, prefixed)
| Prefix | Example |
|---|---|
| `zone-` | `zone-bramble-patch` |
| `npc-` | `npc-pip` |
| `item-` | `item-strawberry` |
| `quest-` | `quest-warm-letter-maple` |
| `upgrade-` | `upgrade-bigger-satchel` |
| `dialogue-` | `dialogue-npc-maple-greet` |

IDs are registered once in `src/data/*.json` and **must never be renamed** after a save exists (versioned save migration per BuildPlan §7).

## Economy & Inventory
- Currency: **Stamps**. Rewards tuned so no grinding is required (Spec §9).
- Inventory: 12 starting slots, +6 per `upgrade-bigger-satchel` (max stack per item in `items.json`).
- Delivery items cannot be discarded while their quest is active (Spec §8).
- Three MVP upgrades (costs tunable in `upgrades.json`):
  - `upgrade-bigger-satchel` — Bigger Satchel (+6 slots)
  - `upgrade-comfy-boots` — Comfy Boots (movement speed)
  - `upgrade-express-badge` — Express Badge (unlocks more delivery quests)

## Content Budget (MVP, locked)
- 5 NPCs · 2 zones · 19 quests · 19 items · 3 upgrades · 1 dialogue set per NPC greeting
- Quest mix: 12 core (delivery/gathering/errand + daily) + 2 friendship side quests (Pip L2, Biscuit L2) + 5 L4 Best Friend reward quests
- Friendship rewards are granted via small L4 quests (`rewardItemId`), not auto-grant (user decision). L4 quests have no item to deliver — they complete on first interaction with the giver once friendship reaches level 4

## Friendship & Leveling
- **Levels** (Spec §7): 0 Stranger · 1 Acquaintance · 2 Friend · 3 Close Friend · 4 Best Friend
- **Cumulative point thresholds (locked, user-approved):**

  | Level | Cumulative points needed | New points this level |
  |---|---|---|
  | 0 → 1 | 3 | 3 |
  | 1 → 2 | 7 | 4 |
  | 2 → 3 | 12 | 5 |
  | 3 → 4 | 18 | 6 |

- **Storage:** `SaveData.friendships` stores the **level** (0–4) per NPC, matching the Spec §15 example (`"pip": 2`). Points exist only at runtime; partial progress toward the next level is not persisted. (User decision over storing raw points.)
- **No two-level jump invariant:** a single quest's `friendshipReward` must never move a player up two levels. Worst case is a +3 reward (Moss L3 story quest) from the top of level 2 (11 pts → 14, still level 3). Enforced by `ContentValidator` (see `src/systems/ContentValidator.ts`) so future quests can't silently violate it.
- Daily quest generation (3 standard + 1 gathering + 1 friendship) pulls from quests tagged `daily: true` (Spec §6) — content pool must never produce impossible combinations (BuildPlan risk table). Daily quests must never carry a `requiresFriendship` gate (enforced by `scripts/validate-content.mjs`).

## Controls (Spec §10, locked for MVP)
- Desktop: WASD/Arrows move · Space/E interact · I inventory · J journal · Esc close
- Mobile: virtual movement pad + on-screen interact button; implemented in Phase 2, not tacked on later (BuildPlan §1 risk)

## Save System
- `localStorage` via singleton `GameManager`; versioned `SaveData` with migration support (BuildPlan §1, §5). Upgrade path to IndexedDB if size grows.

## Art (deferred, Phase 8)
- Placeholder geometric shapes until mechanics are verified; final art is Aseprite sprite sheets + JSON atlases, Tiled JSON maps (BuildPlan §4).
