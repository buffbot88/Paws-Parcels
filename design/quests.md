# Paws & Parcels — Quest Design

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`monsters.md`](monsters.md), [`database-schema.md`](database-schema.md).
> Status: ⬜ planned (Phase 4 implementation).

---

## 1. Quest chains

Quests are organized into **chains** — ordered sequences with prerequisites. A quest
cannot be started unless every prerequisite (quest, reputation, level) is met.

**Chain structure:**
```
quest-primer (gathering 3 berries)
  ↓ prerequisite
quest-warm-letter-maple (delivery: Pip → Maple)
  ↓ prerequisite
quest-maple-moonflower (delivery: Maple → Lumi, also requires friendship ≥ 1 with Maple)
  ↓ prerequisite
quest-lumis-letter (delivery: Lumi → Moss, rewards the parcel-quest unlock for next chain)
```

Each quest has a `chain_position` (1-indexed) and `next_quest_id` pointer.

## 2. Quest states

| State | Meaning |
|---|---|
| `locked` | Prerequisites not met; NPC shows gated dialogue hint |
| `available` | Prerequisites met; NPC offers the quest |
| `active` | Player accepted; must deliver/complete objective |
| `completed` | Player delivered/validated; rewards granted |

Transitions:
- locked → available: server checks prerequisites on relevant events (friendship change,
  quest completion, level up).
- available → active: `accept_quest` intent (server validates).
- active → completed: delivery/interaction intent (server validates).

## 3. Delivery gating

A parcel or letter quest may have a prerequisite chain whose last step is not a delivery
but an **unlock** — the sender NPC refuses to hand over the parcel until the prior
quest(s) are complete. The `requiredItemId` on the delivery quest only spawns/grants once
the chain condition is satisfied.

Example: Maple asks for help finding a lost moonflower before she's willing to write
a letter. The "write letter" quest is locked behind the moonflower quest. Only after
that is complete does the letter appear in Maple's dialogue.

## 4. Quest rewards

All rewards are granted server-side on `state → completed`:

- **Stamps:** currency grant, audited.
- **XP:** added to character's experience; level-up checked.
- **Reputation:** `friendships` table + level threshold check (no two-level jump).
- **Items:** quest reward item instance added to inventory; if parcel/letter was held,
  it is removed upon completion.
- **Chain unlock:** `next_quest_id` becomes `available`.

## 5. Server-side completion validation

Client sends `interact` with `targetId: recipient NPC` while holding the delivery item
and having the quest in `active` state. The server validates:

1. The character's quest state is `active` for this quest.
2. The required item is in the character's inventory.
3. The recipient NPC matches `delivery_target_npc_id`.
4. All prerequisites are still satisfied (chain consistency).
5. If valid: move quest to `completed`, remove delivery item, grant rewards.
6. If invalid: `error` with `QUEST_VALIDATION_FAILED`.

## 6. First MVP chain

**Chain: "Pip's First Delivery"** (introduces delivery gating)

> Note: the Bramble Patch map is deferred to Phase 3 (monsters) — its quests
> below land once the outdoor zone returns.

| Position | Quest | Type | Prerequisite | Reward |
|---|---|---|---|---|
| 1 | `quest-pip-intro` | Gather 3 berries from Bramble Patch | none | 10 Stamps, 50 XP |
| 2 | `quest-warm-letter-maple` | Deliver letter → Maple | `quest-pip-intro` completed | 15 Stamps, 80 XP, +1 Pip rep |
| 3 | `quest-maple-reply` | Deliver reply → Pip | `quest-warm-letter-maple` completed | 20 Stamps, 100 XP, +1 Maple rep |
| 4 | `quest-bramble-beetles` | Defeat 5 Bramble Beetles | `quest-maple-reply` completed | 25 Stamps, 150 XP, unlocks next village delivery chain |