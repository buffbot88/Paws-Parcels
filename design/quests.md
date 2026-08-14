# Paws & Parcels — Quest Design

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`monsters.md`](monsters.md), [`database-schema.md`](database-schema.md).
> Status: 🟡 Phase 4A — Clover Village tutorial foundation implemented.

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

The first chain is now a **Clover Village-only tutorial**, deliberately avoiding
Happy Valley until the player understands movement, interaction, quest acceptance,
parcel carrying, and delivery completion.

**Chain: "Clover Village Courier Circuit"**

| Position | Quest | Type | Route | Reward |
|---|---|---|---|---|
| 1 | `quest-village-welcome` | Delivery | Pip → Biscuit | 5 Stamps, 15 XP, +1 Biscuit rep |
| 2 | `quest-fresh-bread-biscuit` | Delivery | Pip → Biscuit | 8 Stamps, 20 XP, +1 Biscuit rep |
| 3 | `quest-flower-note-maple` | Delivery | Biscuit → Maple | 10 Stamps, 25 XP, +1 Maple rep |
| 4 | `quest-moon-note-lumi` | Delivery | Maple → Lumi | 12 Stamps, 30 XP, +1 Lumi rep |
| 5 | `quest-garden-greeting-moss` | Delivery | Lumi → Moss | 15 Stamps, 40 XP, +1 Moss rep |

Quest-bound parcels are created by the server when a quest is accepted, marked
locked in the inventory stack metadata, and removed only after the server validates
the active quest, recipient, and bound item. The existing Happy Valley gathering
and combat quests remain follow-up content rather than onboarding requirements.

## 7. Follow-up village content

Optional local errands can follow the tutorial: Moss's lost pebble, Pip's missing
letter opener, Biscuit's herb request, Maple's picnic delivery, and Lumi's lost
notebook. These should be added after the core circuit is playable and tested.