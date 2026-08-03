# Paws & Parcels — Class Design

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`combat.md`](combat.md), [`database-schema.md`](database-schema.md).
> Status: ⬜ planned (Phase 3 implementation).

---

## 1. Bear Warrior

- **Animal:** Bear
- **Role:** Melee tank / damage
- **Primary resource:** Stamina (regen 5/s, max 100)
- **Basic attack:** Swipe — melee, 1-tile range, single target, 3s cooldown
- **Starter ability:** Bear Hug — taunt target (forces aggro 3s) + gain a shield (20% of
  max HP for 5s), 10s cooldown, 20 Stamina cost
- **Strengths:** Highest HP and defense; good at holding aggro; forgiving for beginners
- **Weaknesses:** Slowest speed; melee-only; low burst damage
- **Intended playstyle:** Walk into packs, hold attention, absorb damage while party or
  ranged attacks clean up. Solo: slow but steady.

**Starting stats:**
| Stat | Value |
|---|---|
| Max HP | 120 |
| Attack | 10 |
| Defense | 8 |
| Speed | 150 px/s |
| Crit chance | 2% |
| Crit multiplier | 1.5× |

## 2. Cat Mage

- **Animal:** Cat
- **Role:** Ranged magic burst
- **Primary resource:** Mana (regen 10/s, max 120)
- **Basic attack:** Spark — ranged bolt, 4-tile range, 2.5s cooldown
- **Starter ability:** Moonbeam — AoE (3×3 tiles) centered on target, 180% basic-attack
  damage, 12s cooldown, 40 Mana cost
- **Strengths:** Highest burst damage; AoE clear; ranged safety
- **Weaknesses:** Lowest HP and defense; resource-dependent (Mana management); bad in
  close quarters
- **Intended playstyle:** Stay at range, dump resources into AoE packs, kite when
  cornered. Solo: strong but fragile.

**Starting stats:**
| Stat | Value |
|---|---|
| Max HP | 70 |
| Attack | 14 |
| Defense | 4 |
| Speed | 170 px/s |
| Crit chance | 5% |
| Crit multiplier | 2.0× |

## 3. Fox Archer

- **Animal:** Fox
- **Role:** Ranged sustain
- **Primary resource:** Focus (regen 8/s, max 100)
- **Basic attack:** Arrow shot — ranged, 5-tile range, 2s cooldown
- **Starter ability:** Quick Volley — fire 3 arrows rapidly (each 60% of basic attack),
  no focus cost, 8s cooldown
- **Strengths:** Steady DPS; longest range; good mobility; no resource cost on signature
  ability
- **Weaknesses:** No burst (except volley); no crowd control; vulnerable to rush-down
- **Intended playstyle:** Kite and sustain; weaken enemies before they close range.
  Solo: versatile and safe but slower to kill.

**Starting stats:**
| Stat | Value |
|---|---|
| Max HP | 85 |
| Attack | 11 |
| Defense | 5 |
| Speed | 190 px/s |
| Crit chance | 10% |
| Crit multiplier | 1.8× |