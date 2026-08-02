# Paws & Parcels — MVP World Map Sketch

Tile size **48×48**. Viewport ≈ 20×11.25 tiles at 960×540. All coordinates are in **tile units** (x, y), origin top-left. Exact maps will be built in Tiled during Phase 2.

## Zone: Clover Post Office (hub) — `zone-post-office`
Dimensions: 30×20 tiles. Safe, flat interior/exterior hybrid.

```
┌──────────────────────────────────────────────┐
│  0 1 2 3 4 5 6 7 8 9 . . . . . . . . . . .29│
│  ┌───────────────┐      ┌──────────────────┐ │  y0
│  │  (counter)    │      │   quest board    │ │  y3
│  │  pip@(5,5)    │      │   (interact)     │ │
│  └───────────────┘      └──────────────────┘ │
│                                               │
│   ┌─────────┐    ┌───────────────────────┐    │
│   │ mailbox │    │   shop corner         │    │
│   │ (save)  │    │   upgrades/shop UI    │    │
│   └─────────┘    └───────────────────────┘    │
│                                               │
│              player spawn @(15,14)            │
│                                               │
│   ════════════ transition south → bramble ═══ │  y19
└──────────────────────────────────────────────┘
```

Key objects (all `interactable`):
- `object-counter` @ (5,5) — Pip stands behind it; interaction opens quest list + deliveries
- `object-quest-board` @ (22,4) — view active/daily quests
- `object-mailbox` @ (5,13) — manual save trigger
- `object-shop` @ (22,13) — Stamps → upgrades/cosmetics
- `object-transition-bramble` @ south edge (~15,19) — zone change to Bramble Patch

Collision: building walls, counter front face, decorative posts.

## Zone: Bramble Patch — `zone-bramble-patch`
Dimensions: 40×26 tiles. Meadow with berry bushes, flower fields, a pond, rabbit burrows.

```
┌──────────────────────────────────────────────────────────────┐
│ 0 1 2 3 4 5 6 7 8 9 . . . . . . . . . . . . . . . . . . . .39│
│ ────────────────── transition north → post office ────────── │  y0
│   🌳🌳🌳   [rabbit burrows]    🌳🌳🌳                        │  y3
│   🌳  moss@(4,8)    [berry bushes]     biscuit@(32,7)        │  y6
│   [flower field]     🫐🫐🫐          [pond edge]             │
│   maple@(6,16)       [herb patches]    [picnic corner]       │
│   [pond]             lumi@(20,18)                            │
│   🐸 frog pond        [mushroom cluster]                     │
└──────────────────────────────────────────────────────────────┘
```

Key objects:
- `object-spawn-north` @ (~19,1) — arrival from post office
- Gathering nodes: `node-berry-bush` ×4, `node-flower-field` ×2, `node-herb-patch` ×3, `node-pond` ×1 (shells), `node-mushroom-cluster` ×2 (decor/resource later)
- NPCs: `npc-maple` @ (6,16) flower field · `npc-biscuit` @ (32,7) picnic corner · `npc-lumi` @ (20,18) near pond · `npc-moss` @ (4,8) rabbit burrows
- `object-transition-post-office` @ north edge

Collision: tree trunks, pond banks, burrow openings (can't enter, can inspect).

## Spawn/transition summary
| From | To | Tile |
|---|---|---|
| Post office south | Bramble north | (15,19) → (19,1) |
| Bramble north | Post office south | (19,1) → (15,14) |

## Content placement rules
- Gathering nodes regrow daily (respawn on new in-game day) — set in Phase 4.
- NPCs never move between zones in MVP; dialogue changes with friendship level.

## Lost-item spawn locations (errand quests)
| Quest | Item | findAt | Spawn tile |
|---|---|---|---|
| `quest-pip-letter-opener` | `item-letter-opener` | behind the counter | post office ~(4,6) |
| `quest-lost-pebble-moss` | `item-polished-pebble` | rabbit burrows | bramble ~(6,9) near burrow opening |
| `quest-lumis-lost-notebook` | `item-lumi-notebook` | pond edge | bramble ~(21,19) pond bank |
| `quest-golden-acorn-moss` | `item-golden-acorn` | hollow oak | bramble ~(26,11) tree west of picnic corner |
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
