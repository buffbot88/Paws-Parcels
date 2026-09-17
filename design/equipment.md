# Paws & Parcels — Inventory & Equipment Design

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`combat.md`](combat.md), [`network-protocol.md`](network-protocol.md),
> [`database-schema.md`](database-schema.md).
> Status: 🔄 **Phase 5 vertical slice built** — server-authoritative inventory, six gear
> slots, equip/unequip/move transactions with audit events. Remaining: weather-system
> integration and deeper navigation/parcel-condition rules.

---

## 1. Principles

- **Server-authoritative:** inventory contents, slots, stacks, and equipment live on the
  server (`inventories`, `inventory_items`, `equipment` — see
  [`database-schema.md`](database-schema.md)); the client only renders snapshots.
- **Ownership is enforced:** every transaction validates that the item instance belongs to
  the authenticated character before anything mutates.
- **JSON-authored stats:** item definitions, gear stats, and courier effects originate in
  `src/data/items.json`; SQLite stores ownership and slot state only.
- **Audited:** item grants (loot, quest rewards, admin grants) and every equip/unequip/
  move transaction write to `audit_economy_events` / the admin audit log.
- **Locked parcels:** quest-bound parcels are locked instances — they cannot be equipped,
  moved, or dropped until delivered.

## 2. Six equipment slots

| Slot | Key | Example gear |
|---|---|---|
| Head | `head` | `item-valley-helmet` (planned) |
| Body | `body` | `item-valley-cloak` (planned) |
| Weapon | `weapon` | `item-valley-bow` (planned) |
| Accessory | `accessory` | Valley Set accessory (planned) |
| Boots | `boots` | courier boots |
| Courier bag | `courier-bag` | satchels that raise parcel capacity |

Gear definitions carry `equipment_slot`, `equipment_stats` (combat), `courier_effects`
(courier), `required_class`, and `required_level`. The item catalog is editable at
runtime via the Admin Item Editor (durable `source='admin'` rows — see `knowledge.md`).

## 3. WebSocket actions

Implemented in `server/src/ws/gameServer.ts`; payload shapes and failure codes in
[`network-protocol.md`](network-protocol.md):

| Intent | Validates | Success response |
|---|---|---|
| `move_item` | owned, unlocked, unequipped, target slot empty + within capacity | `inventory_updated` |
| `equip_item` | owned, unlocked, unequipped, correct slot category, class + level requirements | `inventory_updated` (atomic swap with slot gear) |
| `unequip_item` | slot filled, effective inventory slot available | `inventory_updated` |
| `request_inventory` | — | full `inventory_updated` snapshot |

Error codes: `ITEM_NOT_OWNED`, `ITEM_LOCKED`, `ITEM_EQUIPPED`, `INVALID_SLOT`,
`SLOT_OCCUPIED`, `CLASS_RESTRICTED`, `LEVEL_REQUIRED`, `NOT_EQUIPPED`, `INVENTORY_FULL`.

`inventory_updated` is idempotent and always carries the **complete** inventory +
equipment state, derived stats, effective slot capacity, and Stamps — the client never
patches partial state.

## 4. Derived effects

Equipment stats are folded into the server-computed combat math (attack/defense feed the
[`combat.md`](combat.md) damage formula) and into courier gameplay:

- **Satchel capacity** (`parcelCapacity`) — how many quest parcels can be carried.
- **Movement** — speed modifiers from gear.
- **Fragile/urgent parcels & weather/navigation rules** — 🔄 reserved for the remaining
  Phase 5 work.

## 5. Client UI

- Basic drag-and-drop inventory presentation (DOM-over-canvas, per the locked UI
  decision); equipment slots render from the same `inventory_updated` snapshot.
- Admin panel integration: the Item Database / Item Editor screens author the catalog;
  the admin player-detail Inventory tab reads through
  `GET /api/characters/:id/profile`.

## 6. Remaining Phase 5 work (⬜)

- Weather-system integration with courier effects.
- Deeper navigation / parcel-condition rules (e.g. condition degradation on routes).
