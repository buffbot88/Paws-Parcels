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

Tile size **48×48**. Viewport ≈ 20×11.25 tiles at 960×540 (the game zooms to 0.8 for the village, ≈25×14 tiles). All coordinates are in **tile units** (x, y), origin top-left.

## Zone: Clover Village (hub) — `zone-clover-village`
Dimensions: **75×75 tiles** (NEW authored layout matching the approved reference overview — generate with `node scripts/generate-clover-village.mjs`, seed 7; the earlier plaza-at-`(37,38)` generation is retired). Courier Square plaza at `(37,28)` with spawn `(37,31)`: two-story Post Office (Building 17) north, Café (Building 16) west, Research Shop (Building 5) east, Florist (Building 3) southeast, a fenced open garden for Moss south of the plaza, two background cottages, NW pond + Rabbit Burrow landmark, SW Hollow Oak clearing, SE pond + picnic clearing, and a lamp-lined southern road through a banner gate to Happy Valley at `(37,74)`. All five cozy NPCs live here (see `design/npcs.md`). Landmark objects: `object-welcome-sign` `(39,8)`, `object-rabbit-burrows` `(18,11)` (adjacent to its landmark art), `object-pond-edge` `(49,56)`, `object-hollow-oak` `(14,59)`, `object-picnic-blanket` `(65,57)`.

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

## Zones: Happy Valley — authored meadow zone

The old `zone-bramble-patch` map was removed. The open-world monster map is
**Happy Valley** (`zone-happy-valley`), a 40×26 meadow with Mossy Pond, a blueberry
patch, and the southern transition to Clover Village (valley entrance at `(20,0)`,
village gate at `(37,74)`).

**Art pass:** set pieces come exclusively from the valley's own pack
(`reference/assets/maps/HappyValley/Map/PNG`) — blue banner at the entrance, short
shore dressing (stump/rocks/bush) beside `object-valley-pond-sign`, a bush cluster
framing `object-valley-blueberries`, and meadow dressing (campfire, trees, rock).
Placement tables live in `src/game/happyValleyPlacements.ts` (Phaser-free, imported
by the parity tests); rendering glue in `src/game/happyValleyAssets.ts`.
`tests/data/happy-valley-art-parity.test.ts` guarantees every valley interactable
has dedicated adjacent art, via the shared harness in
`tests/data/interactable-art-parity-harness.ts` (Clover Village enforces the same
guarantee through it).

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
