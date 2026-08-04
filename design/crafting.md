# Paws & Parcels — Crafting Design

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`monsters.md`](monsters.md), [`dungeons.md`](dungeons.md),
> [`database-schema.md`](database-schema.md).
> Status: ⬜ planned (Phase 6 implementation).

---

## 1. Principles

- **Server-validated:** all recipes are validated server-side (materials present, station
  in range, level cap respected).
- **Station-gated:** crafting requires being near a crafting station (placed in the world).
- **Gear materials come from dungeons** (boss drops, rare spawns); upgrade materials come
  from monsters + dungeons.
- **No gambling/crate mechanics:** recipes have fixed inputs and deterministic outputs.

## 2. Material types

| Type | Source | Used for |
|---|---|---|
| Gear material | Dungeon boss drops | Crafting new gear items |
| Upgrade material | Monster drops + dungeon | Upgrading existing gear level |
| Base material | Monster drops (common) | Low-level gear + consumables |

## 3. Crafting station (MVP)

One station in Main Village (near the shop counter: `object-crafting-station`). A player
within 2 tiles of the station can open the crafting UI and use recipes.

## 4. First recipe set

### Gear crafting

| Output | Materials required | Station |
|---|---|---|
| `item-valley-helmet` (head, gear) | 2 × `item-deer-antler`, 3 × `item-boar-hide` | Village station |
| `item-valley-bow` (weapon, gear) | 1 × `item-boar-tusk`, 3 × `item-grouse-feather` | Village station |
| `item-valley-cloak` (body, gear) | 2 × `item-fox-pelt`, 2 × `item-hare-fur` | Village station |

Gear items provide base stat bonuses when equipped (e.g. `valley-helmet` = +5 defense).

### Upgrade materials

| Input | Output | Materials |
|---|---|---|
| Any gear item + 1 upgrade | Gear level +1 | 2 × `item-boar-hide`, 50 Stamps |

Max gear level = 3 for MVP gear. Each upgrade level adds +10% to the gear's base stat.

## 5. Server-side validation

1. **Station check:** player must be within 2 tiles of a valid crafting station.
2. **Materials check:** inventory must contain all required items in the required
   quantities.
3. **Output check:** inventory must have a free slot for the output.
4. **Level/class check:** gear may have level or class restrictions.
5. **Transaction:** remove materials, create output item, log audit event.

All checks are server-side; the client only displays the recipe UI with requirements.
The `error` message `INSUFFICIENT_MATERIALS` or `INVENTORY_FULL` is returned on failure.

## 6. Future recipes (post-MVP)

- Consumables (potions, food buffs) — Phase 8+.
- Cosmetic crafting (dyes, accessories) — Phase 8+.
- Higher-tier gear requiring dungeon materials from multiple zones.
- Enchanting (add special properties to gear) — Phase 8+.