# Paws & Parcels — SQLite Database Schema (Design)

> Companion docs: [`BuildPlan.md`](../BuildPlan.md), [`decisions.md`](decisions.md),
> [`architecture.md`](architecture.md).
> Conventions: snake_case names, `INTEGER PRIMARY KEY AUTOINCREMENT` PKs, `created_at` /
> `updated_at` on player-state tables, `TEXT` for JSON/enum columns. **SQLite is only ever
> accessed by the server.** Static gameplay content is authored in `src/data/*.json`; SQLite
> stores player state, ownership, and audit records rather than hand-authored quest routes
> or dialogue. This is a design — exact DDL lands with Phase 1 migrations.

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
- **Ownership:** repository content in `src/data/classes.json`.
- **Indexes:** `UNIQUE(key)`
- **Type:** runtime lookup cache; synchronized from JSON at server boot

## 5. skill_definitions and character_skills

Skill definitions are authored in `src/data/skills.json` and synchronized into the
runtime lookup table at server boot. `character_skills` remains player-owned unlock
state; the server validates class, level, prerequisite, and skill-point requirements.

- `skill_definitions`: JSON-backed lookup cache keyed by `skill_key`.
- `character_skills`: player-state rows keyed by `character_id, skill_key`.

## 6. character_stats

Derived or stored stats for a character (base from class + gear + level).

- **PK:** `character_id` (1:1 with characters)
- **FK:** `character_id → characters.id`
- **Columns:** `max_hp`, `attack`, `defense`, `speed`, `crit_chance`, `crit_multiplier`,
  `stamina`/`mana`/`focus` (max + regen), `updated_at`
- **Ownership:** character-level; recomputed/validated by the server.
- **Indexes:** `PRIMARY KEY(character_id)`
- **Type:** player-state

## 7. inventories

One inventory per character.

- **PK:** `character_id` (1:1)
- **FK:** `character_id → characters.id`
- **Columns:** `slot_count` (e.g. 12 base + upgrades), `updated_at`
- **Ownership:** character-level.
- **Type:** player-state

## 8. inventory_items

What is actually in a character's inventory.

- **PK:** `id`
- **FK:** `character_id → characters.id`, `item_definition_id → item_definitions.id`
- **Columns:** `slot` (1..slot_count, nullable = unassigned), `quantity`, `stack_meta`
  (JSON, e.g. durability/upgrade level for equipment), `created_at`
- **Ownership:** character-level; every mutation server-validated and audited.
- **Indexes:** `INDEX(character_id, slot)`, `INDEX(character_id, item_definition_id)`
- **Type:** player-state

## 9. equipment

Equipped gear per character (slots: head, body, weapon, accessory, boots, courier-bag).

- **PK:** `character_id, slot`
- **FK:** `character_id → characters.id`,
  `item_instance_id → inventory_items.id` (the equipped instance)
- **Columns:** `slot` (`head`/`body`/`weapon`/`accessory`/`boots`/`courier-bag`), `equipped_at`
- **Ownership:** character-level; server-validated (owned item, valid slot).
- **Indexes:** `UNIQUE(character_id, slot)`, `UNIQUE(item_instance_id)`
- **Type:** player-state

## 10. item_definitions

Static catalog of items (deliveries, materials, gear, cosmetics, currency items).

- **PK:** `id`
- **FK:** — (static); `recipe_result` references recipes implicitly via crafting docs
- **Columns:** `key` (`item-…` kebab-case), `name`, `description`, `category`
  (`resource`/`gift`/`delivery`/`quest`/`cosmetic`/`material`/`equipment`), `max_stack`,
  `icon`, `base_stats` (JSON for gear), `equipment_slot`, `equipment_stats`,
  `courier_effects`, `required_class`, `required_level`, `rarity`, `value`
  (Stamps sell price)
- **Ownership:** repository content in `src/data/items.json`.
- **Indexes:** `UNIQUE(key)`, `INDEX(category)`
- **Type:** runtime lookup cache; synchronized from JSON at server boot

## 11. Quest content (JSON)

Quest definitions are authored in [`src/data/quests.json`](../src/data/quests.json),
including titles, routes, parcel types, prerequisites, rewards, and unlocks. The server
loads and validates this content at runtime; it is not hand-authored in SQLite.

- **Content key:** `id` (`quest-…`)
- **Important fields:** `giverId`, `targetId`, `requiredItemId`, `parcelCondition`,
  `stampReward`, `xpReward`, `reputationPoints`, `chainPosition`, `prerequisiteIds`
- **Ownership:** repository content, versioned with the client.
- **Type:** content (JSON)

## 12. character_quest_progress

Per-character quest state machine keyed by the stable JSON quest id.

- **PK:** `character_id, quest_key`
- **FK:** `character_id → characters.id`; `quest_key` resolves against JSON content
- **Columns:** `state` (`locked`/`available`/`active`/`completed`), `progress` (JSON),
  `delivered_item_id` (nullable), `accepted_at`, `completed_at`
- **Ownership:** character-level; transitions server-validated only.
- **Indexes:** `INDEX(character_id, state)`, `UNIQUE(character_id, quest_key)`
- **Type:** player-state

The legacy `quest_definitions`, `quest_prerequisites`, and `character_quests` tables are
retained only for migration compatibility and are no longer populated or read by gameplay.

## 14. friendships (reputation)

Per-character reputation with NPCs (0–4 levels, thresholds 3/7/12/18).

- **PK:** `character_id, npc_id`
- **FK:** `character_id → characters.id`, `npc_id → npcs.id`
- **Columns:** `level` (0–4), `points` (runtime progress toward next level), `updated_at`
- **Ownership:** character-level.
- **Indexes:** `UNIQUE(character_id, npc_id)`
- **Type:** player-state

## 15. zones

Static zone catalog + shared-world instance config. Authored in `src/data/zones.json`; the table is a runtime lookup cache for foreign keys and APIs.

- **PK:** `id`
- **FK:** — (static)
- **Columns:** `key` (`zone-…`), `display_name`, `kind` (`village`/`outdoor`/`dungeon`),
  `map_data_id`, `width_tiles`, `height_tiles`, `default_spawn_x`, `default_spawn_y`,
  `max_players`, `is_safe` (no monsters — true for the village)
- **Ownership:** repository content in `src/data/zones.json`; runtime population is server-memory.
- **Indexes:** `UNIQUE(key)`
- **Type:** runtime lookup cache; synchronized from JSON at server boot

## 16. dungeon_runs

Instance lifecycle for dungeon zones.

- **PK:** `id`
- **FK:** `zone_id → zones.id` (the dungeon template), `owner_character_id
  → characters.id`, `party_id` (nullable, party system Phase 6)
- **Columns:** `state` (`created`/`active`/`completed`/`failed`/`destroyed`),
  `entered_at`, `completed_at`, `run_meta` (JSON: cleared encounters, boss state)
- **Ownership:** run-level; owned by the party, isolated from shared world.
- **Indexes:** `INDEX(zone_id, state)`, `INDEX(owner_character_id)`
- **Type:** player-state

## 17. monsters (monster_definitions)

Static monster catalog with JSON-authored loot tables (`src/data/monsters.json`).

- **PK:** `id`
- **FK:** `zone_id → zones.id` (spawn zone; **never the safe village**),
  `family_id` (e.g. Happy Valley Critters)
- **Columns:** `key` (`monster-…`), `display_name`, `level_min`, `level_max`,
  `max_hp`, `attack`, `defense`, `speed`, `aggro_behavior`
  (`passive`/`aggro-range`/`patrol`), `attack_behavior` (`melee`/`ranged`/`spit`),
  `loot_table` (JSON: item key → drop chance), `respawn_seconds`, `experience_reward`
- **Ownership:** repository content in `src/data/monsters.json`; spawn/respawn state is server-memory with DB checkpoint.
- **Indexes:** `UNIQUE(key)`, `INDEX(zone_id)`
- **Type:** runtime lookup cache (spawn state: server-memory)

## 18. audit_economy_events

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

## 19. Relationships (summary)

```text
accounts 1─N sessions/refresh_tokens
accounts 1─N characters N─1 character_classes
characters 1─1 character_stats
characters 1─1 inventories 1─N inventory_items N─1 item_definitions
characters 1─N equipment (slot) 1─1 inventory_items
characters 1─N character_quest_progress N─1 JSON quest content
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
- **Backups:** the SQLite file is committed to the repo (git is the backup); restore is
  copy-in-place; `audit_economy_events` retained
  per retention policy.
