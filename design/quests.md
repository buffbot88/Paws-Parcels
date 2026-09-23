# Paws & Parcels — Quest Design

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`monsters.md`](monsters.md), [`database-schema.md`](database-schema.md).
> Status: ✅ Phase 4B — Clover Village tutorial loop and optional side-quest slice implemented; parcel conditions, friendship, and rewards are server-authoritative.

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

One welcome letter travels the whole circuit. Every leg requires the same bound item,
`item-village-welcome-card` (displayed as the welcome letter): each villager stamps it
and hands it on, so the tracker shows a single parcel carried from the post office back
to the post office. Finishing the chain visits all five main villagers — Pip, Biscuit,
Maple, Lumi, and Moss — and is tuned so a new courier who completes it arrives at
exactly **level 5** (400 XP, the level-5 threshold in `server/src/models/leveling.ts`).

| Position | Quest | Type | Route | Reward |
|---|---|---|---|---|
| 1 | `quest-village-welcome` | Delivery | Pip → Biscuit | Welcome letter; 8 Stamps, 40 XP, +1 Biscuit rep |
| 2 | `quest-fresh-bread-biscuit` | Delivery | Biscuit → Maple | Welcome letter; 12 Stamps, 60 XP, +1 Biscuit rep |
| 3 | `quest-flower-note-maple` | Delivery | Maple → Lumi | Welcome letter, fragile; 16 Stamps, 80 XP, +1 Maple rep |
| 4 | `quest-moon-note-lumi` | Delivery | Lumi → Moss | Welcome letter; 20 Stamps, 100 XP, +1 Lumi rep |
| 5 | `quest-garden-greeting-moss` | Delivery | Moss → Pip | Welcome letter, final stamp; 24 Stamps, 120 XP, +2 Pip rep; promotes Trainee → Courier |

The closing leg is where the courier's progress is celebrated on screen: the server's
`progression` block on the delivery frame reports the two levels it crossed and the rank it
granted, and the HUD turns that into the level-up/promotion banner, the status-card flash and
the chime (see `design/decisions.md` §1, "Level-ups are presented from server-reported
progression").

Onboarding never runs on a clock: no tutorial leg sets `timeLimitSeconds`, so a new
courier exploring Clover Village cannot lose the letter to a timer. Leg 3 is the only
conditioned step, and `fragile` can only reset on defeat — impossible in the
monster-free village — so it teaches the fragile badge without risk of a stall.
The one `urgent` route (`timeLimitSeconds`) now lives in the post-tutorial 4B set
(`quest-picnic-for-maple`), where the player already knows the map.

Quest definitions are authored in [`src/data/quests.json`](../src/data/quests.json),
which is the single source of truth for titles, routes, rewards, prerequisites, parcel
conditions, and rank unlocks. SQLite stores only per-character quest progress.

Quest-bound parcels are created by the server when a quest is accepted, marked
locked in the inventory stack metadata, and carry a tutorial `parcel_condition` of
`normal`, `fragile`, or `urgent`.

- `normal`: no additional handling rule.
- `fragile`: the parcel is reset and must be collected again if the courier is defeated.
- `urgent`: the JSON-defined time limit is shown in the tracker; expiration removes the
  parcel and returns the route to `available` for a retry.

They are removed only after the server validates
the active quest, recipient, and bound item. The existing Happy Valley gathering
and combat quests remain follow-up content rather than onboarding requirements.

## 7. Phase 4B — Village side quests

After the five-step circuit is complete, the server exposes the optional `phase: "4B"`
content from `src/data/quests.json`. Side quests are not inserted into SQLite as
content; SQLite stores only each character's state.

| Quest | Lesson | Completion |
|---|---|---|
| Moss's Lost Pebble | Search an authored village location | Find the pebble at the rabbit burrows, then return it to Moss |
| Pip's Missing Letter Opener | Search an authored village location | Find it behind the post counter, then return it to Pip |
| Biscuit's Ingredient Run | Gather a quantity at a route location | Search the blueberry bushes in Happy Valley, then return to Biscuit |
| Maple's Picnic Delivery | Carry an urgent parcel | Deliver Biscuit's warm basket to Maple before it cools |
| Lumi's Lost Notebook | Search an authored village location | Find it at the pond edge, then return it to Lumi |

Errand and gathering quests do not create locked parcels. The client sends a
`search_quest` intent when the courier interacts with the quest's authored search
object; the server validates the zone, range, active quest, and object ID before
creating the objective item. The final NPC interaction consumes that item and
awards Stamps, XP, and friendship.

Personal story rewards are friendship-gated and include Pip's Courier Cap, Maple's
Flower Crown, Biscuit's Golden Honey, Lumi's Moonlit Seed, and Moss's Garden Key.
Cosmetic and keepsake items are granted as normal unlocked inventory items and are
audited like every other item transaction.