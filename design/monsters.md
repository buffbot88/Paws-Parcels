# Paws & Parcels — Monster Design

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`combat.md`](combat.md), [`dungeons.md`](dungeons.md), [`database-schema.md`](database-schema.md).
> Status: ⬜ planned (Phase 3 implementation).

---

## 1. Spawn zone rules

- **Monsters cannot spawn inside the protected Main Village** (`zone-clover-village`
  is `is_safe: true`).
- Outdoor maps (Bramble Patch — a fresh map + zone key in Phase 3) contain monsters
  by zone + level range.
- Monsters are placed on the map by the server from spawn points defined in the zone data
  (or a global monster-spawn configuration).
- Spawn points are fixed per zone; each spawn point has a monster type, respawn timer,
  and patrol area (if applicable).

## 2. First monster family: Bramble Bugs

| Species | Key | Level | HP | Attack | Defense | Behavior |
|---|---|---|---|---|---|---|
| Bramble Beetle | `monster-bramble-beetle` | 1–2 | 40 | 6 | 4 | Aggressive (4-tile aggro), melee |
| Bramble Grub | `monster-bramble-grub` | 1 | 25 | 4 | 2 | Passive (attacks only if hit), melee |
| Bramble Spitter | `monster-bramble-spitter` | 2–3 | 30 | 8 | 3 | Aggressive (5-tile aggro), ranged spit |

- **Spawn zone:** Bramble Patch (outdoor areas away from the north entrance).
- **Density:** ~6–10 spawn points per family, staggered respawns so the zone never feels
  empty or overwhelmed.
- **Loot table:**

| Monster | Drop | Chance | Quantity |
|---|---|---|---|
| Beetle | item-beetle-shell | 60% | 1 |
| Beetle | item-bramble-resin | 20% | 1 |
| Grub | item-soft-grub-silk | 50% | 1 |
| Grub | item-sticky-slime | 30% | 1 |
| Spitter | item-spitter-gland | 40% | 1 |
| Spitter | item-bramble-resin | 30% | 1–2 |

## 3. Respawn rules

- **Fixed timer:** each monster type has a `respawn_seconds` (e.g. Beetle 30 s, Grub 20 s,
  Spitter 45 s). Timer starts at death.
- **Zone reset:** if no players are in the zone for 5 minutes, all monsters respawn
  immediately on next player entry.
- **No respawn:** in safe zones (village) — no monsters, no respawn.

## 4. Aggro behavior

- **Aggressive (beetle, spitter):** within detection range → chase the nearest player.
  If the player leaves the aggro range for 3 s, the monster returns to its spawn point.
- **Passive (grub):** does not attack or chase unless damaged. After being hit, it
  targets the attacker for 10 s, then resets.
- **Taunt override:** Bear Hug's taunt forces the monster to target the Bear for 3 s
  regardless of distance.

## 5. Attack behavior

- **Melee (beetle, grub):** move to adjacent tile, deal damage on contact (1-tile range).
- **Ranged (spitter):** stay at 2–3 tile distance, fire a projectile. Damage calculated
  server-side; projectile is a client animation.
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
| Fungal Golems | Deep Bramble (dungeon) | 10–15 | Mushroom constructs |