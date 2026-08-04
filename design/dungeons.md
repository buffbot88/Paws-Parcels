# Paws & Parcels — Dungeon Design

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`monsters.md`](monsters.md), [`combat.md`](combat.md), [`crafting.md`](crafting.md),
> [`database-schema.md`](database-schema.md).
> Status: ⬜ planned (Phase 6 implementation).

---

## 1. Principles

- **Instanced:** each run creates a private zone copy; no interference between parties.
- **Entry gated:** level requirement + quest-chain prerequisite.
- **Cozy difficulty:** failure = respawn at dungeon entrance or instance reset; no
  permanent loss, no inventory drop, no XP penalty.
- **Rewards focused on materials:** gear-crafting + upgrade materials, not guaranteed
  best-in-slot drops.

## 2. Instance lifecycle

1. **Create:** player (or party leader) interacts with the dungeon entrance → server
   creates a `dungeon_run` with `state: created`.
2. **Enter:** all party members join the instance zone.
3. **Run:** party clears encounters in sequence; boss is the final encounter.
4. **Complete:** boss defeated → rewards granted via `loot_received` + `quest_updated`
   (if applicable). Run transitions to `state: completed`.
5. **Fail:** all party members defeated → option to respawn at dungeon entrance
   (keeps progress) or reset (abandon run). Run transitions to `state: failed` on reset.
6. **Destroy:** instance cleaned up after 5 minutes idle or on party leave.

## 3. First MVP dungeon: Den of the Great Boar

- **Entry requirements:** level 3+; quest chain "Pip's First Delivery" completed.
- **Solo or party:** up to 3 players.
- **Zone size:** ~20×20 tiles, 2–3 rooms.

### Encounter structure

| Room | Monster(s) | Notes |
|---|---|---|
| Entrance den | 2 Wild Boars + 1 Meadow Hare | Introductory trash |
| Fox run | 2 Valley Foxes + 1 Black Grouse | Fast + ranged threat |
| The Den (boss) | **Great Boar** (unique boss) | See below |

### Boss: Great Boar

- **Key:** `monster-great-boar`
- **Level:** 4
- **HP:** 200
- **Attack:** 12
- **Defense:** 6
- **Abilities:**
  - Tusk Slam (melee AoE in a 1-tile radius, 150% damage)
  - Charge Stomp (roots the closest player in place for 3 s)
- **Loot table:**

| Item | Chance | Quantity |
|---|---|---|
| item-great-boar-tusk | 100% | 1 |
| item-valley-crown-shard | 50% | 1 |
| item-boar-hide | 80% | 2–3 |
| item-deer-antler | 60% | 1–2 |

## 4. Rewards

- **Gear-crafting materials:** `item-great-boar-tusk`, `item-valley-crown-shard` — used to
  craft a Valley Set weapon or accessory.
- **Monster materials:** `item-boar-hide`, `item-deer-antler` — general crafting.
- **XP:** per-encounter + boss completion bonus.
- **Stamps:** 25 on boss completion.

## 5. Failure and respawn

- **During run (non-boss):** party member defeated → respawns at dungeon entrance with
  full HP; run continues. No item/XP loss.
- **During boss:** party member defeated → respawns at entrance; if all members are
  defeated simultaneously = party wipe → option to retry from boss room entrance or
  abandon.
- **Abandon:** instance destroyed; no rewards; run marked `failed` in DB.
- **Cozy rule:** no permanent consequence for failure. Retry as many times as desired.