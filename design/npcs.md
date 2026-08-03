> ## 🗃 LEGACY REFERENCE (single-player context)
>
> These 5 NPC cards were designed for the original single-player cozy RPG. Their
> personalities, species, home zones, and favorite items are **retained** for the
> online game — they are the same characters. However:
>
> - **Friendship levels** are now part of the server-authoritative `friendships` table
>   and used as quest-chain gates (see [`design/quests.md`](quests.md)).
> - **Dialogue** is now served from the server, validated by quest state.
> - Combat NPCs (monsters) are a separate system — see [`design/monsters.md`](monsters.md).
> - The `homeTile` positions are still valid for client rendering.

# Paws & Parcels — NPC Design Cards (LEGACY — single-player)

Friendship levels (Spec §7): 0 Stranger · 1 Acquaintance · 2 Friend · 3 Close Friend · 4 Best Friend.

## npc-pip — Pip, the Hedgehog
- **Species:** Hedgehog · **Role:** Post office assistant (hub)
- **Personality:** Energetic, fast-talking, loves organization. Gives the tutorial delivery.
- **Favorite items:** `item-strawberry`, `item-polished-pebble`
- **Home:** `zone-clover-village` @ (8,4)
- **Unlocks (in data):** L2 → `quest-pip-letter-opener` (find his lost letter opener); L4 → `quest-pip-courier-cap` (rewards `item-courier-cap` cosmetic)

## npc-maple — Maple, the Deer
- **Species:** Deer · **Role:** Florist (Clover Village flower field)
- **Personality:** Shy, gentle, blushes easily. Sells nothing in MVP; receives flower deliveries.
- **Favorite items:** `item-moonflower`, `item-wildflower-bouquet`
- **Home:** `zone-clover-village` @ (25,9)
- **Unlocks (in data):** L3 → story scene (the moonflower memory); L4 → `quest-maple-flower-crown` (rewards `item-flower-crown` cosmetic)

## npc-biscuit — Biscuit, the Bear
- **Species:** Bear · **Role:** Café owner (Clover Village picnic corner; café itself is post-MVP Sunlit Clearing)
- **Personality:** Cheerful, warm, generous. Bakes between deliveries.
- **Favorite items:** `item-honey-jar`, `item-river-shell`
- **Home:** `zone-clover-village` @ (24,16)
- **Unlocks (in data):** L2 → `quest-biscuit-ingredient-run` (gather 3 blueberries); L4 → `quest-biscuit-golden-honey` (rewards `item-golden-honey` gift)

## npc-lumi — Lumi, the Moth
- **Species:** Moth · **Role:** Forest researcher (near pond)
- **Personality:** Mysterious, soft-spoken, night-oriented. Studies moonlight.
- **Favorite items:** `item-moonflower`
- **Home:** `zone-clover-village` @ (12,10)
- **Unlocks (in data):** L3 → story scene (the moonflower research); L4 → `quest-lumi-golden-acorn` (rewards `item-moonlit-seed`, distinct from Moss's golden acorn)

## npc-moss — Moss, the Frog
- **Species:** Frog · **Role:** Sleepy gardener (garden beds)
- **Personality:** Drowsy, kind, slow to wake. Loves polished pebbles.
- **Favorite items:** `item-polished-pebble`
- **Home:** `zone-clover-village` @ (8,16)
- **Unlocks (in data):** L2 → `quest-lost-pebble-moss` (one-time side quest, `daily: false`); L3 → `quest-golden-acorn-moss` (gated on friendship 3); L4 → `quest-moss-garden-key` (rewards `item-garden-key`, unlocks a hidden garden plot)

## Dialogue rules
- One `dialogue-<npc>-greet` set at friendship 0; variants at 1+ (implemented in `dialogue.json`).
- Daily conversation rotates from a small pool (Phase 5), never blocks progress.
- No quest can be permanently blocked (Spec §14, §20) — friendship gates unlock content, never lock it away.
