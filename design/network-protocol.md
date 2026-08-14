# Paws & Parcels — Network Protocol (Design)

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`architecture.md`](architecture.md).
>
> This defines the first set of WebSocket + HTTP messages for the MMORPG pivot.
> **Client sends intent; server decides.** All messages are JSON-encoded.
> Protocol version: `1.1` (Phase 3 adds combat). Delivery: at least once; duplicate
> intents are idempotent where possible.

---

## 1. WebSocket envelope

Every WS message is a JSON object with a `type` field:

```json
{ "type": "<message_type>", ...payload }
```

The server may send multiple message frames per tick (batch or per-event). The client
processes each message independently.

---

## 2. Client → Server Messages

### authenticate
```json
{
  "type": "authenticate",
  "token": "ws-token-string"
}
```
- **Validation:** Token must be valid (issued by server, not expired, not used).
- **Expected response:** `authenticated` on success; `error` on failure.
- **Failure cases:** invalid token, expired token, account banned, character deleted.

### join_zone
```json
{
  "type": "join_zone",
  "zoneId": "zone-clover-village"
}
```
- **Validation:** Zone must exist; character must have access (no level gate for the
  village hub).
- **Expected response:** `zone_state` (full zone snapshot for the character's new zone).
- **Failure cases:** unknown zone, zone full, character already in zone (idempotent).

### move_intent
```json
{
  "type": "move_intent",
  "dx": 1,
  "dy": 0,
  "tick": 1234
}
```
- **Validation:** `dx, dy ∈ {-1, 0, 1}`, `|dx + dy| ≤ 1` (4-direction for MVP);
  velocity-per-tick ≤ max speed (config, class-based); resulting tile is walkable
  (server collision check); no teleport (delta from last accepted pos ≤ 2 tiles in one
  tick; difference beyond that = reset to server pos).
- **Expected response:** None directly — the server rebroadcasts a `player_snapshot` to
  all zone clients including this player's updated position.
- **Failure cases:** speed hank (reset to server pos), collision (position unchanged,
  snapshot repeats last valid pos).

### interact
```json
{
  "type": "interact",
  "targetId": "npc-pip",
  "kind": "npc"
}
```
- **Validation:** target must be valid for the character's current zone (NPC exists,
  interactable object loaded from zone data); character must be in interaction range
  (≤ 2 tiles); target not in cooldown.
- **Expected response:** `dialogue_available` (with NPC lines, quest offers, delivery
  validation state).
- **Failure cases:** out of range, target not in zone, invalid targetId.

### interact
```json
{
  "type": "interact",
  "targetId": "npc-pip",
  "kind": "npc"
}
```
- **Validation:** target NPC must exist in the current zone and be within 2 tiles.
- **Behavior:** the server attempts to complete an active delivery at that NPC; if no delivery completes, it returns the current quest offers/state for the NPC.

### search_quest
```json
{
  "type": "search_quest",
  "objectId": "object-rabbit-burrows"
}
```
- **Validation:** The active quest must name this search object; the object must belong to the
  current zone and be within 2 tiles. The server creates the objective item and updates
  progress only after both checks pass.
- **Expected response:** `quest_updated` with `action: "searched"` plus `inventory_updated`.
- **Failure cases:** no active objective, wrong object, out of range, inventory full.

### accept_quest
```json
{
  "type": "accept_quest",
  "questId": "quest-village-welcome"
}
```
- **Validation:** quest must be `available` for this character (state machine:
  prerequisites met, not already active/completed, not locked by chain).
- **Expected response:** `quest_updated` (state → `active`).
- **Failure cases:** prerequisites not met, already active/completed, quest locked.

### attack
```json
{
  "type": "attack",
  "targetEntityId": "spawn-boar-1",
  "ability": "basic_attack"
}
```
- **Validation:** target must exist in the same zone, be alive, and be in attack range
  (melee 1 tile, ranged 3–5 tiles class-based); cooldown for the ability must have
  elapsed. Monster instance ids are the map's spawn-point ids (e.g. `spawn-boar-1`).
  Resource costs (stamina/mana/focus) are reserved for Phase 5 abilities — the
  basic attack is free, so `INSUFFICIENT_RESOURCE` is not yet emitted.
- **Expected response:** `combat_event` (damage dealt, target new HP, `resourceCost`
  is `{}` until abilities land).
- **Failure cases:** out of range, invalid target, target dead, cooldown not elapsed.

### equip_item
```json
{
  "type": "equip_item",
  "itemInstanceId": 42,
  "slot": "weapon"
}
```
- **Validation:** item must exist in character's inventory, be unequipped, belong to a
  valid equipment category for that slot, and have no level/class restrictions (or the
  character must meet them).
- **Expected response:** `inventory_updated` (item removed from inventory slot, equipped).
- **Failure cases:** item not owned, wrong slot, class restricted, insufficient level.

### leave_zone
```json
{
  "type": "leave_zone"
}
```
- **Validation:** Character must be in a zone (idempotent if not).
- **Expected response:** `player_left` broadcast to remaining zone clients (if any);
  client receives a no-op ack or an implicit zone_state for the next zone when re-joining.
- **Failure cases:** none.

---

## 3. Server → Client Messages

### authenticated
```json
{
  "type": "authenticated",
  "accountId": 1,
  "characterId": 5,
  "zoneId": "zone-clover-village"
}
```
- **Payload:** server-approved session confirms the character and sends the current zone.
- **Client action:** transition to the game scene for the current zone.

### zone_state
```json
{
  "type": "zone_state",
  "zoneId": "zone-clover-village",
  "players": [
    { "characterId": 5, "name": "Mochi", "classKey": "fox-archer", "pos": { "x": 15, "y": 14 } },
    { "characterId": 8, "name": "Birch", "classKey": "bear-warrior", "pos": { "x": 3, "y": 7 } }
  ],
  "monsters": [
    { "id": "spawn-boar-1", "key": "monster-wild-boar", "displayName": "Wild Boar",
      "pos": { "x": 16, "y": 8 }, "hp": 55, "maxHp": 55, "alive": true }
  ],
  "npcs": [ { "id": "npc-pip", "pos": { "x": 5, "y": 4 } } ],
  "objects": [ { "id": "object-mailbox", "pos": { "x": 5, "y": 13 } } ]
}
```
- **Payload:** full authoritative snapshot of the zone — players, monsters, NPCs, and
  interactables — upon joining.
- **Client action:** clear the scene and render all entities from server state.

### player_joined
```json
{
  "type": "player_joined",
  "characterId": 12,
  "name": "Rue",
  "classKey": "cat-mage",
  "pos": { "x": 15, "y": 8 }
}
```
- **Payload:** a new player entered the zone while the receiver was already in it.
- **Client action:** spawn the player entity without rebuilding the whole zone.

### player_left
```json
{
  "type": "player_left",
  "characterId": 12
}
```
- **Payload:** a player left the zone or disconnected.
- **Client action:** remove the player entity.

### player_snapshot
```json
{
  "type": "player_snapshot",
  "players": [
    { "characterId": 5, "pos": { "x": 16, "y": 14 } },
    { "characterId": 8, "pos": { "x": 4, "y": 7 } },
    { "characterId": 12, "pos": { "x": 15, "y": 9 } }
  ]
}
```
- **Payload:** periodic (every tick or every Nth tick) broadcast of the authoritative
  positions of all players in the zone.
- **Client action:** interpolate/reconcile local positions.

### monster_snapshot
```json
{
  "type": "monster_snapshot",
  "monsters": [
    { "id": "spawn-boar-1", "key": "monster-wild-boar", "displayName": "Wild Boar",
      "pos": { "x": 16, "y": 8 }, "hp": 55, "maxHp": 55, "alive": true }
  ]
}
```
- **Payload:** periodic (every Nth tick) authoritative state of all monsters in the
  zone — position, HP, alive flag.
- **Client action:** interpolate monster positions; update HP bars; hide defeated
  monsters and restore them when they respawn (`alive` flips back).

### combat_event
```json
{
  "type": "combat_event",
  "instigatorId": 5,
  "targetId": "spawn-boar-1",
  "ability": "basic_attack",
  "damage": 8,
  "targetHp": 42,
  "targetMaxHp": 55,
  "outcome": "hit",
  "resourceCost": {}
}
```
- **Payload:** result of a combat action (attack or damage managed server-side). When a
  monster is the instigator, `instigatorId` is the monster's entity id (string) and the
  target is a player character.
- **Client action:** play damage number/effect; update the monster's HP bar locally.
- **Variants:** `"outcome": "crit"`, `"outcome": "miss"`, `"outcome": "defeated"`.

### player_respawned
```json
{
  "type": "player_respawned",
  "characterId": 5,
  "zoneId": "zone-clover-village",
  "pos": { "x": 15, "y": 13 },
  "hp": 100,
  "maxHp": 100,
  "invulnUntil": 1764873600000
}
```
- **Payload:** a player was defeated and respawned at the safe hub with full HP and a
  short invulnerability window. Broadcast to the defeated player (and to others in the
  zone for the entity swap).
- **Client action:** transition the player to the respawn zone/position, restore the HP
  chip, and show the invuln state.

### npc_interaction
```json
{
  "type": "npc_interaction",
  "npcId": "npc-pip",
  "quests": [ /* quest snapshots */ ]
}
```
- **Payload:** current server-approved quest snapshots relevant to the interacted NPC.

### quest_updated
```json
{
  "type": "quest_updated",
  "action": "accepted",
  "quest": { "questId": "quest-village-welcome", "state": "active" },
  "quests": [ /* full tutorial state */ ],
  "inventory": [ /* quest-bound item snapshots */ ],
  "stamps": 5,
  "xp": 15,
  "message": "Quest accepted: Welcome to Clover Village"
}
```
- **Payload:** a server-validated quest transition. `action` is `accepted`, `searched`, or `delivery`. Side-quest snapshots include the search object, friendship gate, and reward item metadata.
- **Client action:** update the tutorial tracker and authoritative parcel state.

### quest_notice
```json
{
  "type": "quest_notice",
  "message": "The fragile parcel was damaged when you were defeated. Return to its sender to accept the route again."
}
```
- **Payload:** server-authored tutorial feedback that does not change the quest schema.
- **Client action:** show the notice in the quest tracker.

### inventory_updated
```json
{
  "type": "inventory_updated",
  "items": [
    { "itemInstanceId": 1, "itemKey": "item-village-welcome-card", "slot": 0, "quantity": 1, "locked": true }
  ],
  "stamps": 5
}
```
- **Payload:** the minimal quest/inventory snapshot emitted after accepting or completing a tutorial route.

### inventory_updated
```json
{
  "type": "inventory_updated",
  "items": [
    { "itemInstanceId": 1, "itemKey": "item-strawberry", "slot": 1, "quantity": 3 },
    { "itemInstanceId": 2, "itemKey": "item-letter", "slot": 2, "quantity": 1 }
  ],
  "stamps": 125
}
```
- **Payload:** the character's full current inventory state (idempotent; always the full
  list for the character — the client diffs locally).
- **Client action:** update inventory UI; play loot sound if new items.

### loot_received
```json
{
  "type": "loot_received",
  "sourceId": "spawn-boar-1",
  "items": [
    { "itemKey": "item-boar-hide", "quantity": 1 }
  ]
}
```
- **Payload:** a monster or loot-source produced items for the character.
- **Client action:** play loot animation; UI notification. **Note:** until Phase 5,
  this is an announcement + the monster's XP grant only — the item is not yet
  granted to the character's inventory (`inventory_updated` arrives with Phase 5).

### error
```json
{
  "type": "error",
  "code": "MOVE_TELEPORT_DETECTED",
  "message": "Move intent rejected: client-server position delta exceeds maximum.",
  "requestType": "move_intent"
}
```
- **Payload:** a server-rejected intent, including the original message type and an
  error code for UI display.
- **Client action:** trust the server; revert any predicted state; optionally surface a
  brief error toast.
- **Error codes (first set):** `INVALID_TOKEN`, `EXPIRED_TOKEN`, `INVALID_TARGET`,
  `OUT_OF_RANGE`, `COOLDOWN_ACTIVE`, `INSUFFICIENT_RESOURCE`, `TARGET_DEAD`,
  `MOVE_COLLISION`, `MOVE_TELEPORT_DETECTED`, `QUEST_NOT_AVAILABLE`,
  `QUEST_PREREQUISITES_NOT_MET`, `QUEST_ALREADY_COMPLETE`, `ITEM_NOT_OWNED`,
  `INVENTORY_FULL`, `INVALID_SLOT`, `CLASS_RESTRICTED`, `ZONE_FULL`,  `ZONE_NOT_FOUND`, `OUT_OF_RANGE`, `QUEST_NOT_AVAILABLE`, `QUEST_ALREADY_ACTIVE`,
  `QUEST_ALREADY_COMPLETE`, `QUEST_NOT_ACTIVE`, `QUEST_ITEM_MISSING`,
  `WRONG_DELIVERY_TARGET`, `INVENTORY_FULL`,
  `NOT_AUTHENTICATED`, `NOT_IN_ZONE`, `INTERNAL_ERROR`