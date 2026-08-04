# Paws & Parcels — Combat Design

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`classes.md`](classes.md), [`monsters.md`](monsters.md), [`dungeons.md`](dungeons.md).
> Status: ⬜ planned (Phase 3 implementation).

---

## 1. Core principles

- **Server-computed:** all combat math runs on the server; the client renders results.
- **No PvP:** all combat is player vs. monster (PvE).
- **Cozy guardrails:** no permanent death, no XP loss on defeat, defeat = respawn with
  items kept.
- **Cooldown-gated:** abilities have cooldowns (basic attack ~2–3s, starter ability ~8–12s).
- **Resource-gated:** basic attacks are free; abilities cost Stamina/Mana/Focus.

## 2. Damage formula

```
raw_damage = attacker_attack - target_defense
min_damage = attacker_attack * 0.2  (floor — always deal at least 20% of attack)
damage = max(raw_damage, min_damage)

if crit_check (random < attacker_crit_chance):
    damage *= attacker_crit_multiplier

final_damage = round(damage)
```

All stats are server-side and level-scaled. No client contribution to damage.

## 3. Health, defeat, and respawn

- **Player HP:** determined by `character_stats.max_hp` (class base + level + gear).
- **Defeat (HP ≤ 0):** player is defeated → respawn at the Main Village spawn point.
  - No item loss, no XP loss.
  - HP restored to 100% on respawn.
  - A brief invulnerability window (3 s) after respawn.
- **Monster HP:** determined by monster definition; defeated → loot (see below) + respawn
  timer.

## 4. Monster combat

- **Aggro:** monsters detect players within a range (configurable per monster type;
  passive: no aggro, aggressive: chase within range, patrol: follow a path).
- **Attack:** monsters attack the nearest player in range, or the player with aggro
  (taunt from Bear Hug overrides).
- **Defeat:** monster HP ≤ 0 → death animation + loot drop + respawn timer.
- **Monster respawn:** fixed timer per monster type (e.g. 30 s for a Wild Boar);
  timer starts on death.

## 5. Loot

- Loot drops are defined per monster (`loot_table` in monster definitions).
- Loot is awarded to the player who dealt the most damage (or the party, Phase 6).
- Loot goes directly into the player's inventory; if full, a "loot on ground" mechanic
  is used (Phase 8+).
- Loot generation is server-side and deterministic (seeded RNG, not trustable).

## 6. Validation / anti-cheat

| Area | Server check |
|---|---|
| Attack range | `distance(target, player) ≤ range` for the ability |
| Target alive | `target.hp > 0` |
| Cooldown | `last_use_time + cooldown ≤ now` |
| Resource | `player.stamina/mana/focus ≥ cost` |
| Teleport | Each tick: `delta ≤ max_speed * tick_duration` |
| Defeat | `player.hp ≤ 0` computed server-side only |

All violations produce an `error` message with code (see protocol); no state change.

## 7. Future expansions (post-MVP)

- Abilities unlocked at levels 5, 10, 15.
- Gear provides active abilities and set bonuses.
- Status effects (poison, slow, daze) — Phase 8+.
- PvP dueling (optional, opt-in only).