> ## 🗃 LEGACY REFERENCE (single-player context)
>
> This map sketch was created during the original single-player plan (Phase 0).
> The tile layouts and object positions are still valid for the **client
> rendering** of the hub, but they describe **no monsters**, **no combat**, and
> **no server-authoritative zone transitions**.
>
> **Current hub:** `zone-clover-village` (see `src/data/maps/clover-village.json`).
> The old Post Office + Bramble Patch maps were removed; **Happy Valley** is
> the Phase 3 open-world monster map. For the online game, see
> [`BuildPlan.md`](../BuildPlan.md) §8 (monster maps) and
> [`design/monsters.md`](monsters.md) for spawn rules.

# Paws & Parcels — MVP World Map Sketch (LEGACY — single-player)

Tile size **48×48**. Viewport ≈ 20×11.25 tiles at 960×540. All coordinates are in **tile units** (x, y), origin top-left. Exact maps will be built in Tiled during Phase 2.

## Zone: Clover Village (hub) — `zone-clover-village`
Dimensions: 30×20 tiles. Safe, flat interior/exterior hybrid. All five cozy NPCs live here (see `design/npcs.md`).

```
┌──────────────────────────────────────────────┐
│  0 1 2 3 4 5 6 7 8 9 . . . . . . . . . . .29│
│  ┌───────────────┐      ┌──────────────────┐ │  y0
│  │  post office  │      │  quest board     │ │  y3
│  │  pip@(8,4)    │      │  counter@(6,4)   │ │  y4
│  └───────────────┘      └──────────────────┘ │  y6
│                                               │
│        pond (west)   flower field (east)     │
│        lumi@(12,10)  maple@(25,9)            │
│                                               │
│            player spawn @(15,13)             │
│                                               │
│   mailbox@(18,14)   shop@(24,14)             │
│   moss@(8,16)  garden   biscuit@(24,16)      │
│        welcome sign @(13,17)                 │
└──────────────────────────────────────────────┘
```

Key objects (all `interactable`):
- `object-counter` @ (6,4) — Pip stands behind it; interaction opens quest list + deliveries
- `object-quest-board` @ (12,4) — view active/daily quests
- `object-mailbox` @ (18,14) — manual save trigger
- `object-shop` @ (24,14) — Stamps → upgrades/cosmetics
- `object-welcome-sign` @ (13,17) — village greeting

Collision: post office building walls, pond water, garden bushes (decorative), border trees.

## Zones: Happy Valley — planned (Phase 3)

The old `zone-bramble-patch` map was removed. The Phase 3 open-world monster map is
**Happy Valley** (`zone-happy-valley`), seeded from the Happy Valley art pack
(`src/data/maps/HappyValley/`). Full tile sketch lands with the map JSON in Phase 3
(see `design/monsters.md` for the critter family).

## Content placement rules
- Gathering nodes regrow daily (respawn on new in-game day) — set in Phase 4.
- NPCs never move between zones in MVP; dialogue changes with friendship level.

## Lost-item spawn locations (errand quests, deferred to the outdoor zone)
| Quest | Item | findAt | Spawn tile |
|---|---|---|---|
| `quest-pip-letter-opener` | `item-letter-opener` | behind the counter | hub ~(4,6) |
| `quest-lost-pebble-moss` | `item-polished-pebble` | garden | hub ~(6,9) near bushes |
| `quest-lumis-lost-notebook` | `item-lumi-notebook` | pond edge | hub ~(21,19) pond bank |
| `quest-golden-acorn-moss` | `item-golden-acorn` | hollow oak | hub ~(26,11) tree west of picnic corner |

Lost items only spawn while their quest is active, despawn on completion (set in Phase 5).

## Friendship quest rewards (L4 Best Friend)
Each NPC's L4 quest (`quest-*-<reward>`) hands out a special item on completion — these are content rewards, not world spawns. They have no `requiredItemId`/`findAt`: the QuestSystem completes them on first interaction with the giver after friendship level 4 is reached (no item to deliver).
| Quest | Reward item | Category |
|---|---|---|
| `quest-pip-courier-cap` | `item-courier-cap` | cosmetic |
| `quest-maple-flower-crown` | `item-flower-crown` | cosmetic |
| `quest-biscuit-golden-honey` | `item-golden-honey` | gift |
| `quest-lumi-golden-acorn` | `item-moonlit-seed` | quest (future chain seed) |
| `quest-moss-garden-key` | `item-garden-key` | quest (unlocks hidden garden plot) |
