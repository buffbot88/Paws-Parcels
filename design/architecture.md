# Paws & Parcels — Server Architecture

> Part of the online RPG design set. Companion docs: [`BuildPlan.md`](../BuildPlan.md),
> [`decisions.md`](decisions.md), [`database-schema.md`](database-schema.md),
> [`network-protocol.md`](network-protocol.md).

## 1. System diagram

```text
┌────────────────────────────┐        ┌────────────────────────────────────┐        ┌──────────┐
│  Browser client (Phaser 4) │  HTTPS  │   API Server (auth, character,     │        │          │
│  - renders server state    │ ──────► │   content, health, static content) │  SQL   │  SQLite   │
│  - sends intents (WS)      │  WSS    │────────────────────────────────────│ ─────► │  (single │
│  - local non-auth settings │ ──────► │  Game Server (authoritative)       │        │  writer) │
└────────────────────────────┘        │  - zone sync, movement validation  │        └──────────┘
                                      │  - combat, quests, inventory        │
                                      │  - dungeon instances                │
                                      └────────────────────────────────────┘
```

- The **browser never connects to SQLite** — all persistence flows through the server.
- API + game logic may be one process at MVP (vertical slice), split into services later.

## 2. Responsibilities

### Browser client
- Render zones/players/monsters/NPCs from server state; depth sorting (2.5D).
- Capture input (movement, interact, attack, UI) and send as **intents**.
- Predict movement locally; reconcile with authoritative snapshots.
- Display server-approved results (combat events, quest updates, inventory).
- Persist the non-authoritative auth session (JWT, lifetime per server config) in
  localStorage so page refreshes do not require another sign-in while the token is valid;
  gameplay state remains server-side.
- Never mutate gameplay state locally; never trust its own state for validation.

### Game/API server
- Authenticate sessions (JWT for HTTP, token handshake for WS).
- Own all gameplay state: positions, health, quests, inventory, economy, dungeon runs.
- Validate every intent: movement speed/collision/teleport sanity, attack cooldowns and
  range, quest prerequisites, item ownership, delivery targets.
- Compute combat outcomes and broadcast `combat_event`.
- Maintain per-zone player presence and broadcast `player_snapshot` at the tick rate.
- Load static game content from versioned `src/data/*.json` files; do not hand-author quest routes or parcel definitions in migrations.
- Persist progression to SQLite (via migrations, transactions, and audit events).
- Run the server tick/update loop (see §7).

### SQLite
- Persists accounts, sessions, characters, stats, inventory, quest progress, friendships,
  dungeon runs, monster state (where persistent), and audit/economy events.
- Static definitions (items, quests, parcel rules, classes, monsters, loot tables, zones,
  skills, recipes, and dialogue) are authored in versioned JSON content files.
- The server materializes JSON catalogs into relational lookup tables at boot for foreign
  keys and efficient queries; those tables are caches, not content-authoring surfaces.
- Serves as the **single writer** for player state; no other process writes.
- Owns schema migrations (versioned, run by the server at boot/deploy).
- Never exposed to clients; credentials only in server env/secrets.

## 3. HTTP endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/health` | Health check (liveness + DB ping) | none |
| GET | `/api/auth/login-url` | OIDC authorize URL (PKCE challenge) | none |
| POST | `/api/auth/oidc/callback` | Exchange code + PKCE verifier for a session JWT | none |
| GET | `/api/auth/me` | Validate the session JWT and return account + characters | access token |
| POST | `/api/auth/logout` | Revoke current session | access token |
| GET | `/api/characters` | List the account's characters | access token |
| GET | `/api/classes` | Class catalog | access token |
| POST | `/api/characters` | Create character (name, class, appearance) | access token |
| GET | `/api/characters/:characterId/profile` | Character + inventory + stats snapshot | access token |
| POST | `/api/characters/:characterId/skills/:skillKey/unlock` | Unlock a skill | access token |
| GET | `/api/ws-token` | Obtain a short-lived WS handshake token | access token |
| POST | `/api/npc/talk` | AI NPC dialogue line (world-brain) | access token |
| POST | `/api/admin/visual-capture` | Save an in-game visual review capture | access token (Admin) |

HTTP is for auth, character management, and content. All real-time gameplay is WebSocket.

## 4. WebSocket responsibilities

- One authenticated connection per player; all gameplay messages flow here.
- Envelope framing and message types are defined in
  [`network-protocol.md`](network-protocol.md).
- Server responsibilities on the socket:
  - Authenticate the handshake token; reject invalid/expired tokens.
  - Join/leave zone management; broadcast presence.
  - Receive intents (`move_intent`, `attack`, `interact`, `accept_quest`, `search_quest`, `equip_item`),
    validate, apply, and broadcast authoritative results.
  - Push `zone_state`, `player_snapshot`, `combat_event`, `quest_updated`,
    `inventory_updated`, `loot_received`, `error` to the affected clients.
- Rate limiting: cap messages/sec per connection; queue intents; drop-and-error spam.

## 5. Authentication flow (ASHAT Hub OIDC)

```text
client ── GET /api/auth/login-url (PKCE challenge) ──► server ──► { authorize URL }
client redirects to ASHAT Hub /authorize → Hub redirects back with the code
client ── POST /api/auth/oidc/callback { code, verifier } ──► server
server verifies the code + PKCE, validates the Hub's JWKS-signed ID token, upserts the account
server ── { accessToken (JWT, TTL per server config), account, characters } ──► client
client stores the JWT in localStorage (PKCE state/verifier remain tab-scoped and die with the tab)
client ── GET /api/ws-token ──► server ──► { wsToken (30s) }
client ── WS connect + { type: "authenticate", token: wsToken } ──► server
server validates wsToken → binds socket to account+character → sends "authenticated"
```

- **Passwords:** none stored locally — identity is delegated to ASHAT Hub (authorization
  code + PKCE, JWKS-verified ID tokens); no password hashing happens in this server.
- **Sessions:** a signed JWT access token whose TTL comes from server config
  (`auth.accessTokenTtlSeconds`); the client stores it and sends it as `Authorization`
  for HTTP and to mint WS handshake tokens.
- **Secrets:** `JWT_SECRET`, DB credentials, OIDC `clientId`/`discoveryUrl`/`issuer`
  (public PKCE client — no client secret) — env/secrets store only; never in the repo
  (`docs/` and `.env*` excluded from commits; `.gitignore` updated in Phase 1).

## 6. Reconnection behavior

- **Grace window:** if the socket drops, the player's character stays in the zone
  (invisible or "idle") for **60 seconds** (configurable).
- **Reconnect:** client reconnects, re-authenticates, and sends `join_zone` for the zone
  it was in → server returns `zone_state` with the player's character restored.
- **Expired grace:** character is removed from the zone; on next login the player spawns
  at the zone's default spawn (Main Village).
- **Combat during disconnect:** the character becomes non-targetable during grace; no
  damage is taken while offline.

## 7. Server tick / update model

- **Tick rate:** 20 Hz server tick for gameplay updates (configurable).
- **Movement:** server integrates `move_intent` (direction + timestamp) against the last
  accepted state; validates per-tick distance against max speed; applies collision from
  the zone's tile data.
- **Snapshots:** every tick (or every Nth tick), server sends `player_snapshot` for all
  players in the zone to all clients in the zone.
- **Combat:** cooldowns and damage resolved on the tick when the `attack` intent is
  processed; `combat_event` broadcast immediately.
- **Persistence:** important transitions (quest complete, loot, level-up, purchase) are
  written to SQLite immediately; position is persisted periodically (10 s, only when the
  player has moved since the last write) and on zone leave/logout.

## 8. Validation & anti-cheat boundaries

| Input | Client sends | Server validates |
|---|---|---|
| Movement | direction/delta | speed ≤ max, no teleport, collision-legal, in-zone |
| Attack | target entity | in range, alive, cooldown elapsed, target exists |
| Interact | object/NPC id | in range, object exists, dialogue allowed |
| Accept quest | quest id | available state, prerequisites met |
| Deliver | quest id + recipient | active quest, correct item held, correct recipient |
| Equip item | item id + slot | item owned, slot valid, level requirements |
| Craft | recipe id | materials owned, station in range, level cap |

Anything that fails validation → `error` message, no state change, optional audit log.

## 9. Error handling

- **Client:** surface `error` messages with friendly text; never trust a rejected intent.
- **Server:** every handler validates input; failures produce typed error codes
  (see protocol); unexpected exceptions are caught, logged, and answered with a generic
  `error` (no stack traces leaked to clients).
- **DB errors:** fail-soft — gameplay continues in memory; persistence retried with
  backoff; critical persistence failures trigger a connection-health event.

## 10. Logging & observability

- **Structured logs** (JSON): request/socket lifecycle, zone events, combat summaries,
  economy events, auth events, errors.
- **Health check** `/api/health`: liveness + DB reachability.
- **Metrics:** connections, messages/sec, zone population, tick duration, DB latency
  (Phase 8).
- **Never log:** passwords, tokens, full payloads of sensitive messages.
