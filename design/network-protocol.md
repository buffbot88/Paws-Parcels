# Paws & Parcels — Network Protocol (Design)

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`architecture.md`](architecture.md).
>
> This defines the first set of WebSocket + HTTP messages for the MMORPG pivot.
> **Client sends intent; server decides.** All messages are JSON-encoded.
> Protocol version: `1.1` (Phase 3 adds combat). Delivery: at least once; duplicate
> intents are idempotent where possible.
>
> **Wire set (implemented in `server/src/ws/gameServer.ts`): 13 client intents + 15
> server frames.** `leave_zone` and `request_inventory` have server handlers and client
> APIs, but the current client never sends them in normal play.

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
- **Failure cases:** invalid token, expired token, account banned, character deleted;
  a second `authenticate` on an already-authenticated socket (`ALREADY_AUTHENTICATED` —
  open a new socket to switch characters).

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
- **Failure cases:** unknown zone (`ZONE_NOT_FOUND`), zone at capacity (`ZONE_FULL`),
  zone not reachable from the current zone (`ZONE_UNREACHABLE` — switching zones
  requires the server-side position to be within 1 tile of an authored transition
  to the requested zone; `leave_zone` does not reset this). Re-joining the current
  zone is always allowed. A cross-zone join places the courier on the transition's
  authored `spawn` tile (map spawn if unwalkable). Rejections leave the courier in
  their current zone.

### move_intent
```json
{
  "type": "move_intent",
  "dx": 1,
  "dy": 0
}
```
- **Validation:** `dx, dy ∈ {-1, 0, 1}`, `|dx + dy| ≤ 1` (4-direction for MVP);
  velocity ≤ max speed (config, class-based); resulting tile is walkable (server
  collision check); no teleport (delta from last accepted pos ≤ 2 tiles; difference
  beyond that = reset to server pos). The client emits one intent per move interval
  (`1000/(speed/48)` ms); the field is not timestamped — the server enforces the cap
  from its own clock.
- **Expected response:** None directly — the server rebroadcasts a `player_snapshot` to
  all zone clients including this player's updated position.
- **Failure cases:** speed cap (`COOLDOWN_ACTIVE`), collision (`MOVE_COLLISION`, position
  unchanged, snapshot repeats last valid pos), teleport detected (`MOVE_TELEPORT_DETECTED`).

### interact
```json
{
  "type": "interact",
  "targetId": "npc-pip",
  "kind": "npc"
}
```
- **Validation:** target must be a valid NPC in the character's current zone and within
  interaction range (≤ 2 tiles); `kind` is accepted but only NPC interaction is wired.
- **Behavior:** if the NPC is a pending `additionalStops` entry of the active delivery and the
  courier holds its bound parcel, the stop is recorded (`quest_updated` with
  `action: "stop_visited"`). Otherwise the server attempts to complete an active quest at that
  NPC (`quest_updated` with `action: "delivery"` on success); if nothing completes, it
  returns `npc_interaction` with the current quest offers/state for the NPC, followed by a
  `quest_notice` when the target is right but the objective is unfinished (kills remaining, or
  a stop still to visit — the notice names it). Stops may be visited in any order.
- **Failure cases:** out of range, target not in zone, invalid targetId.

### zone_chat
```json
{
  "type": "zone_chat",
  "text": "Hello, village!"
}
```
- **Validation:** authenticated + in a zone; text trimmed and capped at 240 characters;
  rate-limited to one message per second per character.
- **Expected response:** `zone_chat` broadcast to every connected player in the same
  zone (including the sender).
- **Failure cases:** `INVALID_CHAT` (empty), `CHAT_RATE_LIMIT`, `NOT_IN_ZONE` — each
  error frame carries `requestType: "zone_chat"` so the client treats it as
  gameplay feedback rather than a broken connection.

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

### move_item
```json
{
  "type": "move_item",
  "itemInstanceId": 42,
  "targetSlot": 5
}
```
- **Validation:** item must belong to the authenticated character, be unlocked and
  unequipped, and target an empty slot within the effective inventory capacity.
- **Expected response:** `inventory_updated` with the complete inventory/equipment snapshot.
- **Failure cases:** item not owned, item locked/equipped, invalid or occupied slot.

### equip_item
```json
{
  "type": "equip_item",
  "itemInstanceId": 42,
  "slot": "weapon"
}
```
- **Validation:** item must exist in character's inventory, be unlocked and unequipped,
  belong to a valid JSON-authored equipment category for that slot, and satisfy any
  class/level restrictions. Existing gear in the slot is atomically swapped back into
  the incoming item's inventory slot.
- **Expected response:** `inventory_updated` with equipment, derived stats, and effective
  slot capacity.
- **Failure cases:** item not owned, locked/equipped, wrong slot, class restricted,
  insufficient level.

### unequip_item
```json
{
  "type": "unequip_item",
  "slot": "weapon"
}
```
- **Validation:** the slot must contain gear owned by the character and an effective
  inventory slot must be available.
- **Expected response:** `inventory_updated`.
- **Failure cases:** invalid/empty slot, inventory full.

### request_inventory
```json
{ "type": "request_inventory" }
```
- **Expected response:** the complete authoritative `inventory_updated` snapshot.
- **Note:** implemented server-side and on `GameSocket`, but the current client never
  sends it — inventory snapshots arrive with `zone_state` and every mutation.

### leave_zone
```json
{
  "type": "leave_zone"
}
```
- **Validation:** Character must be in a zone (idempotent if not).
- **Expected response:** `player_left` broadcast to remaining zone clients (if any).
- **Failure cases:** none.
- **Note:** implemented server-side and on `GameSocket`, but the current client never
  sends it — zone switches and shutdown simply drop the connection and rely on the
  server's 60s reconnect grace.

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

### zone_chat
```json
{
  "type": "zone_chat",
  "characterId": 5,
  "name": "Mochi",
  "text": "Hello, village!"
}
```
- **Payload:** a chat message broadcast to every connected player in the sender's zone.
- **Client action:** append the message to the zone chat panel; messages whose
  `characterId` matches the local courier are the player's own sends.

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
  "zoneId": "zone-clover-village",
  "pos": { "x": 15, "y": 13 },
  "hp": 100,
  "maxHp": 100
}
```
- **Payload:** the defeated player was respawned at the safe hub with full HP + a short
  invulnerability window. Sent to the defeated player's connection only.
- **Client action:** transition the player to the respawn zone/position and restore the
  HP chip.

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
- **Payload:** a server-validated quest transition. `action` is `accepted`, `searched`, `delivery`, `stop_visited` (a multi-stop delivery stop was recorded), or `progress` (a monster kill advanced the killer's kill-count objective; sent only to the killing courier and never past the count). Side-quest snapshots include the search object, friendship gate, and reward item metadata. Every snapshot also carries `defeat` (`{ monsterKey, monsterName, count }` or `null`; `progress`/`requiredQuantity` hold the kill tally), `additionalStops`, and `visitedStops` (NPC ids). Clients that ignore these fields keep working.
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
  "equipment": [],
  "slotCount": 12,
  "stats": { "attack": 10, "defense": 8, "speed": 150, "parcelCapacity": 0 },
  "stamps": 5
}
```
- **Payload:** the complete current inventory/equipment state. Item definitions, gear
  stats, and courier effects originate in JSON; ownership and slots originate in SQLite.
  The payload is idempotent and safe to apply repeatedly.
- **Client action:** update inventory UI and derived courier stats; play loot sound if new items.

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
- **Payload:** a monster or loot-source produced items for the character. Sent only to
  the killer, listing only items actually stored (nothing when the inventory is full).
- **Client action:** play loot animation and UI notification. The server commits the
  item grant and emits a full `inventory_updated` snapshot.

### xp_gained
```json
{
  "type": "xp_gained",
  "xp": 20,
  "progression": {
    "level": 2, "previousLevel": 1, "levelsGained": 1, "experience": 120,
    "skillPoints": 2, "courierRank": "Trainee", "rankPromotion": null
  }
}
```
- **Payload:** monster-kill XP the server just committed, sent only to the killer (never
  broadcast). `xp` is the amount granted (after `exp_rate`), not the new total;
  `progression` has the same shape as `quest_updated.progression` (`rankPromotion` is
  always `null` for kills). Not sent when the grant fails. Additive: older clients ignore it.
- **Client action:** show an XP toast; when `levelsGained > 0`, update the status card's
  level and show the level-up banner exactly as for a delivery.

### error
```json
{
  "type": "error",
  "code": "MOVE_TELEPORT_DETECTED",
  "message": "Move intent rejected: client-server position delta exceeds maximum.",
  "requestType": "move_intent"
}
```
- **Payload:** a server-rejected intent, including the original message type (when the
  rejection was a response to a specific intent) and an error code for UI display.
- **Client action:** trust the server; revert any predicted state; optionally surface a
  brief error toast. `requestType` set = gameplay rejection; absent = connection-level
  failure (the client reserves its "connection failed" panel for those).
- **Error codes:** auth `INVALID_TOKEN`, `ALREADY_AUTHENTICATED` · session `NOT_AUTHENTICATED`, `NOT_IN_ZONE`,
  `RATE_LIMITED` · zone `ZONE_NOT_FOUND`, `ZONE_FULL`, `ZONE_UNREACHABLE` · movement `MOVE_COLLISION`,
  `MOVE_TELEPORT_DETECTED`, `INVALID_DIRECTION`, `COOLDOWN_ACTIVE` · combat
  `INVALID_TARGET`, `OUT_OF_RANGE`, `TARGET_DEAD` · quests `QUEST_NOT_AVAILABLE`,
  `QUEST_PREREQUISITES_NOT_MET`, `QUEST_ALREADY_ACTIVE`, `QUEST_ALREADY_COMPLETE`,
  `QUEST_NOT_ACTIVE`, `QUEST_ITEM_MISSING`, `WRONG_DELIVERY_TARGET`, `INVENTORY_FULL` ·
  inventory/equipment `ITEM_NOT_OWNED`, `ITEM_LOCKED`, `ITEM_EQUIPPED`, `INVALID_SLOT`,
  `SLOT_OCCUPIED`, `CLASS_RESTRICTED`, `LEVEL_REQUIRED`, `NOT_EQUIPPED` · chat
  `INVALID_CHAT`, `CHAT_RATE_LIMIT` · framing `INVALID_MESSAGE`, `INTERNAL_ERROR`