# Paws & Parcels — Monster Design

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`combat.md`](combat.md), [`dungeons.md`](dungeons.md), [`database-schema.md`](database-schema.md).
> Status: ⬜ planned (Phase 3 implementation).
>
> **Map note:** Phase 3's open-world combat zone is **Happy Valley** (`zone-happy-valley`).
> The old Bramble Patch plan was dropped — the art pack shipped for Happy Valley instead
> (`reference/assets/maps/HappyValley/`), so the first monster family is built from its mobs.

---

## 1. Spawn zone rules

- **Monsters cannot spawn inside the protected Main Village** (`zone-clover-village`
  is `is_safe: true`).
- Outdoor maps (Happy Valley — a fresh map + zone key in Phase 3) contain monsters
  by zone + level range.
- Monsters are placed on the map by the server from spawn points defined in the zone data
  (or a global monster-spawn configuration).
- Spawn points are fixed per zone; each spawn point has a monster type, respawn timer,
  and patrol area (if applicable).

## 2. First monster family: Happy Valley Critters

Built from the Happy Valley art pack mobs (`reference/assets/maps/HappyValley/Mob/` — boar,
fox, hare, deer, black grouse).

| Species | Key | Level | HP | Attack | Defense | Behavior |
|---|---|---|---|---|---|---|
| Wild Boar | `monster-wild-boar` | 2–3 | 55 | 9 | 6 | Aggressive (4-tile aggro), melee charge |
| Valley Fox | `monster-valley-fox` | 2 | 32 | 8 | 3 | Aggressive (5-tile aggro), fast melee |
| Meadow Hare | `monster-meadow-hare` | 1 | 20 | 4 | 2 | Passive (attacks only if hit), melee |
| Forest Deer | `monster-forest-deer` | 1–2 | 45 | 5 | 4 | Passive (flees, never retaliates), melee |
| Black Grouse | `monster-black-grouse` | 2 | 30 | 7 | 3 | Aggressive (5-tile aggro), ranged peck |

- **Spawn zone:** Happy Valley (outdoor meadows away from the village transition).
- **Density:** ~6–10 spawn points per species, staggered respawns so the zone never feels
  empty or overwhelmed.
- **Loot table:**

| Monster | Drop | Chance | Quantity |
|---|---|---|---|
| Boar | item-boar-hide | 60% | 1 |
| Boar | item-boar-tusk | 20% | 1 |
| Fox | item-fox-pelt | 50% | 1 |
| Fox | item-sharp-claw | 30% | 1 |
| Hare | item-hare-fur | 50% | 1 |
| Hare | item-lucky-foot | 10% | 1 |
| Deer | item-deer-antler | 40% | 1 |
| Deer | item-deer-hide | 50% | 1 |
| Grouse | item-grouse-feather | 60% | 1 |
| Grouse | item-grouse-plume | 20% | 1 |

## 3. Respawn rules

- **Fixed timer:** each monster type has a `respawn_seconds` (e.g. Boar 30 s, Hare 20 s,
  Fox 35 s, Deer 40 s, Grouse 45 s). Timer starts at death.
- **Zone reset:** if no players are in the zone for 5 minutes, all monsters respawn
  immediately on next player entry.
- **No respawn:** in safe zones (village) — no monsters, no respawn.

## 4. Aggro behavior

- **Aggressive (boar, fox, grouse):** within detection range → chase the nearest player.
  If the player leaves the aggro range for 3 s, the monster returns to its spawn point.
- **Passive (hare):** does not attack or chase unless damaged. After being hit, it
  targets the attacker for 10 s, then resets.
- **Fleeing (deer):** never attacks; runs from the nearest player beyond a 2-tile
  approach radius. Cannot be looted unless defeated (low HP, easily caught with a chase).
- **Taunt override:** Bear Hug's taunt forces the monster to target the Bear for 3 s
  regardless of distance.

## 5. Attack behavior

- **Melee (boar, fox, hare, deer):** move to adjacent tile, deal damage on contact
  (1-tile range). Boar's charge is a slightly faster approach than walk.
- **Ranged (grouse):** stay at 2–3 tile distance, fire a peck projectile. Damage
  calculated server-side; projectile is a client animation.
- **Attack cooldown:** all monsters have a 2–3 s attack cooldown (per monster, not per
  player).

## 6. Loot drop rules

- Loot is awarded to the player who dealt the most damage (MVP loot).
- In a party (Phase 6+), loot is distributed per party loot rules.
- Loot is placed directly into the inventory; if the inventory is full, the item is
  dropped on the ground at the monster's death location (ground loot persists for 60 s
  before despawning).
- Loot generation is server-side deterministic RNG; no client influence.

## 7. Future monster families (post-MVP)

| Family | Zone | Level range | Theme |
|---|---|---|---|
| Whispering Pines Shades | Whispering Pines | 5–8 | Ghostly forest spirits |
| Sunlit Sprites | Sunlit Clearing | 8–12 | Mischievous light creatures |
| Deep Den Creatures | Den of the Great Boar (dungeon) | 4–6 | Boar-den cave dwellers |
