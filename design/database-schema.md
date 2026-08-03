# Paws & Parcels — MySQL Database Schema (Design)

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`architecture.md`](architecture.md).
> Conventions: snake_case names, `BIGINT UNSIGNED` auto-increment PKs, `created_at` /
> `updated_at` on player-state tables, `InnoDB`/`utf8mb4`. **MySQL is only ever accessed
> by the server.** This is a design — exact DDL lands with Phase 1 migrations.

## Conventions per entity

Each entity lists: **Primary key · Foreign keys · Important columns · Ownership ·
Indexes · Content vs. player state** (`content` = static, shipped with the game;
`player-state` = per-account/character, mutable).

---

## 1. accounts

Persistent identity for a human player.

- **PK:** `id`
- **FK:** — (self-contained)
- **Columns:** `email` (unique, normalized), `username` (unique, display login),
  `password_hash` (argon2id/bcrypt — **never plain text**), `status`
  (`active`/`banned`), `created_at`, `updated_at`, `last_login_at`
- **Ownership:** account-level; owned by the player, enforced by the server.
- **Indexes:** `UNIQUE(email)`, `UNIQUE(username)`
- **Type:** player-state

## 2. sessions / refresh_tokens

Long-lived sessions used to mint short-lived access tokens.

- **PK:** `id`
- **FK:** `account_id → accounts.id`
- **Columns:** `refresh_token_hash` (SHA-256 of the random token — never stored raw),
  `expires_at`, `revoked_at`, `created_at`, `last_used_at`, `user_agent`, `ip`
- **Ownership:** account-level; server-managed.
- **Indexes:** `UNIQUE(refresh_token_hash)`, `INDEX(account_id)`, `INDEX(expires_at)`
- **Type:** player-state

## 3. characters

One account may have multiple characters (class + appearance chosen at creation).

- **PK:** `id`
- **FK:** `account_id → accounts.id`, `class_id → character_classes.id`
- **Columns:** `name` (unique per account, display name), `class_id`, `appearance`
  (JSON: body/eye color, accessories), `zone_id` (current zone), `pos_x`, `pos_y`,
  `level`, `experience`, `stamps` (currency), `created_at`, `updated_at`
- **Ownership:** character-level; owned by the account, mutated only by the server.
- **Indexes:** `UNIQUE(account_id, name)`, `INDEX(account_id)`, `INDEX(zone_id)`
- **Type:** player-state

## 4. character_classes

Static class templates (Bear Warrior / Cat Mage / Fox Archer).

- **PK:** `id`
- **FK:** — (static)
- **Columns:** `key` (`bear-warrior`, `cat-mage`, `fox-archer`), `display_name`,
  `animal`, `role`, `primary_resource` (`stamina`/`mana`/`focus`), `base_stats`
  (JSON: hp, attack, defense, speed, crit), `description`
- **Ownership:** content.
- **Indexes:** `UNIQUE(key)`
- **Type:** content (seeded, immutable after release)

## 5. character_stats

Derived or stored stats for a character (base from class + gear + level).

- **PK:** `character_id` (1:1 with characters)
- **FK:** `character_id → characters.id`
- **Columns:** `max_hp`, `attack`, `defense`, `speed`, `crit_chance`, `crit_multiplier`,
  `stamina`/`mana`/`focus` (max + regen), `updated_at`
- **Ownership:** character-level; recomputed/validated by the server.
- **Indexes:** `PRIMARY KEY(character_id)`
- **Type:** player-state

## 6. inventories

One inventory per character.

- **PK:** `character_id` (1:1)
- **FK:** `character_id → characters.id`
- **Columns:** `slot_count` (e.g. 12 base + upgrades), `updated_at`
- **Ownership:** character-level.
- **Type:** player-state

## 7. inventory_items

What is actually in a character's inventory.

- **PK:** `id`
- **FK:** `character_id → characters.id`, `item_definition_id → item_definitions.id`
- **Columns:** `slot` (1..slot_count, nullable = unassigned), `quantity`, `stack_meta`
  (JSON, e.g. durability/upgrade level for equipment), `created_at`
- **Ownership:** character-level; every mutation server-validated and audited.
- **Indexes:** `INDEX(character_id, slot)`, `INDEX(character_id, item_definition_id)`
- **Type:** player-state

## 8. equipment

Equipped gear per character (slots: head, body, weapon, accessory).

- **PK:** `character_id, slot`
- **FK:** `character_id → characters.id`,
  `item_instance_id → inventory_items.id` (the equipped instance)
- **Columns:** `slot` (`head`/`body`/`weapon`/`accessory`), `equipped_at`
- **Ownership:** character-level; server-validated (owned item, valid slot).
- **Indexes:** `UNIQUE(character_id, slot)`, `UNIQUE(item_instance_id)`
- **Type:** player-state

## 9. item_definitions

Static catalog of items (deliveries, materials, gear, cosmetics, currency items).

- **PK:** `id`
- **FK:** — (static); `recipe_result` references recipes implicitly via crafting docs
- **Columns:** `key` (`item-…` kebab-case), `name`, `description`, `category`
  (`resource`/`gear`/`delivery`/`quest`/`cosmetic`/`material`), `max_stack`,
  `icon`, `base_stats` (JSON for gear), `rarity`, `value` (Stamps sell price)
- **Ownership:** content.
- **Indexes:** `UNIQUE(key)`, `INDEX(category)`
- **Type:** content

## 10. quest_definitions

Static quest catalog, including chain structure.

- **PK:** `id`
- **FK:** `giver_npc_id → npcs.id`, `delivery_target_npc_id → npcs.id` (nullable)
- **Columns:** `key` (`quest-…`), `title`, `description`, `type`
  (`delivery`/`combat`/`gathering`/`chain`), `required_item_definition_id`
  (nullable — the parcel/letter), `required_quantity`, `stamp_reward`, `xp_reward`,
  `reputation_reward_npc_id`, `reputation_reward_points`, `next_quest_id`
  (chain pointer), `chain_position`, `min_level`
- **Ownership:** content.
- **Indexes:** `UNIQUE(key)`, `INDEX(required_item_definition_id)`, `INDEX(next_quest_id)`
- **Type:** content

## 11. quest_prerequisites

Many-to-many prerequisites for quests (quest gates + reputation gates).

- **PK:** `quest_id, prerequisite_kind, prerequisite_id`
- **FK:** `quest_id → quest_definitions.id`; `prerequisite_id` points to a quest
  definition (kind=`quest`) or a reputation level (kind=`reputation`)
- **Columns:** `kind` (`quest`/`reputation`/`item`), `min_value` (e.g. quest completed =
  1, reputation level ≥ N)
- **Ownership:** content.
- **Indexes:** `INDEX(quest_id)`
- **Type:** content

## 12. character_quests

Per-character quest state machine.

- **PK:** `character_id, quest_id`
- **FK:** `character_id → characters.id`, `quest_id → quest_definitions.id`
- **Columns:** `state` (`locked`/`available`/`active`/`completed`), `progress` (JSON),
  `delivered_item_id` (nullable), `accepted_at`, `completed_at`
- **Ownership:** character-level; transitions server-validated only.
- **Indexes:** `INDEX(character_id, state)`, `UNIQUE(character_id, quest_id)`
- **Type:** player-state

## 13. friendships (reputation)

Per-character reputation with NPCs (0–4 levels, thresholds 3/7/12/18).

- **PK:** `character_id, npc_id`
- **FK:** `character_id → characters.id`, `npc_id → npcs.id`
- **Columns:** `level` (0–4), `points` (runtime progress toward next level), `updated_at`
- **Ownership:** character-level.
- **Indexes:** `UNIQUE(character_id, npc_id)`
- **Type:** player-state

## 14. zones

Static zone catalog + shared-world instance config.

- **PK:** `id`
- **FK:** — (static)
- **Columns:** `key` (`zone-…`), `display_name`, `kind` (`village`/`outdoor`/`dungeon`),
  `map_data_id`, `width_tiles`, `height_tiles`, `default_spawn_x`, `default_spawn_y`,
  `max_players`, `is_safe` (no monsters — true for the village)
- **Ownership:** content (map data); runtime population is server-memory.
- **Indexes:** `UNIQUE(key)`
- **Type:** content

## 15. dungeon_runs

Instance lifecycle for dungeon zones.

- **PK:** `id`
- **FK:** `zone_id → zones.id` (the dungeon template), `owner_character_id
  → characters.id`, `party_id` (nullable, party system Phase 6)
- **Columns:** `state` (`created`/`active`/`completed`/`failed`/`destroyed`),
  `entered_at`, `completed_at`, `run_meta` (JSON: cleared encounters, boss state)
- **Ownership:** run-level; owned by the party, isolated from shared world.
- **Indexes:** `INDEX(zone_id, state)`, `INDEX(owner_character_id)`
- **Type:** player-state

## 16. monsters (monster_definitions)

Static monster catalog.

- **PK:** `id`
- **FK:** `zone_id → zones.id` (spawn zone; **never the safe village**),
  `family_id` (e.g. Bramble Bugs)
- **Columns:** `key` (`monster-…`), `display_name`, `level_min`, `level_max`,
  `max_hp`, `attack`, `defense`, `speed`, `aggro_behavior`
  (`passive`/`aggro-range`/`patrol`), `attack_behavior` (`melee`/`ranged`/`spit`),
  `loot_table` (JSON: item key → drop chance), `respawn_seconds`, `experience_reward`
- **Ownership:** content; spawn/respawn state is server-memory with DB checkpoint.
- **Indexes:** `UNIQUE(key)`, `INDEX(zone_id)`
- **Type:** content (spawn state: server-memory)

## 17. audit_economy_events

Append-only ledger for every economy mutation (anti-cheat + tuning).

- **PK:** `id`
- **FK:** `character_id → characters.id` (nullable for system events),
  `item_definition_id → item_definitions.id` (nullable)
- **Columns:** `event_type` (`stamp_grant`/`stamp_spend`/`item_grant`/`item_remove`/
  `loot`/`quest_reward`/`craft`/`equip`), `quantity`, `balance_after`, `reason`,
  `created_at`
- **Ownership:** append-only; written by the server.
- **Indexes:** `INDEX(character_id, created_at)`, `INDEX(event_type)`
- **Type:** player-state (ledger)

---

## 18. Relationships (summary)

```text
accounts 1─N sessions/refresh_tokens
accounts 1─N characters N─1 character_classes
characters 1─1 character_stats
characters 1─1 inventories 1─N inventory_items N─1 item_definitions
characters 1─N equipment (slot) 1─1 inventory_items
characters 1─N character_quests N─1 quest_definitions
quest_definitions 1─N quest_prerequisites (self/NPC gates)
characters 1─N friendships N─1 npcs (reputation)
zones 1─N monsters (spawn zones; village excluded)
zones 1─N dungeon_runs N─1 characters (owner)
characters 1─N audit_economy_events
```

## 19. Authentication & secrets (requirements)

- **Passwords:** argon2id (preferred) or bcrypt; salted per-user; never stored or logged
  in plain text; never returned by any endpoint.
- **Refresh tokens:** 256-bit random; stored as SHA-256 hash in `refresh_tokens`;
  rotated on use; revoked on logout/security event.
- **Access tokens (JWT):** short-lived (15 min), signed with server secret; no player
  state claims beyond `sub` (account id) + `char` (character id).
- **WS handshake tokens:** short-lived (30 s), single-use, issued via `/api/ws-token`.
- **Secret management:** `JWT_SECRET`, DB credentials, argon2 pepper in environment /
  secrets store (never committed). `.env.example` documents names only, no values.
- **Backups:** MySQL nightly backups; restore tested; `audit_economy_events` retained
  per retention policy.
