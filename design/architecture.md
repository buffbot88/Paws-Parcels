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
- Persist only non-authoritative settings (audio, UI, controls) in localStorage.
- Never mutate gameplay state locally; never trust its own state for validation.

### Game/API server
- Authenticate sessions (JWT for HTTP, token handshake for WS).
- Own all gameplay state: positions, health, quests, inventory, economy, dungeon runs.
- Validate every intent: movement speed/collision/teleport sanity, attack cooldowns and
  range, quest prerequisites, item ownership, delivery targets.
- Compute combat outcomes and broadcast `combat_event`.
- Maintain per-zone player presence and broadcast `player_snapshot` at the tick rate.
- Persist progression to SQLite (via migrations, transactions, and audit events).
- Run the server tick/update loop (see §7).

### SQLite
- Persists accounts, sessions, characters, stats, inventory, quests, friendships,
  zones, dungeon runs, monster state (where persistent), and audit/economy events.
- Serves as the **single writer** for player state; no other process writes.
- Owns schema migrations (versioned, run by the server at boot/deploy).
- Never exposed to clients; credentials only in server env/secrets.

## 3. HTTP endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Create account (email, password, name) | none (rate-limited) |
| POST | `/api/auth/login` | Exchange credentials for access + refresh token | none (rate-limited) |
| POST | `/api/auth/refresh` | Rotate refresh token → new access token | refresh token |
| POST | `/api/auth/logout` | Revoke current session | access token |
| GET | `/api/characters` | List the account's characters | access token |
| POST | `/api/characters` | Create character (name, class, appearance) | access token |
| GET | `/api/health` | Health check (liveness + DB ping) | none |
| GET | `/api/content/:kind` | Static content (items, quests, monsters, recipes) | access token |
| GET | `/api/zones/:zoneId` | Zone metadata (tiles, spawns, transitions) | access token |
| GET | `/api/ws-token` | Obtain a short-lived WS handshake token | access token |

HTTP is for auth, character management, and content. All real-time gameplay is WebSocket.

## 4. WebSocket responsibilities

- One authenticated connection per player; all gameplay messages flow here.
- Envelope framing and message types are defined in
  [`network-protocol.md`](network-protocol.md).
- Server responsibilities on the socket:
  - Authenticate the handshake token; reject invalid/expired tokens.
  - Join/leave zone management; broadcast presence.
  - Receive intents (`move_intent`, `attack`, `interact`, `accept_quest`, `equip_item`),
    validate, apply, and broadcast authoritative results.
  - Push `zone_state`, `player_snapshot`, `combat_event`, `quest_updated`,
    `inventory_updated`, `loot_received`, `error` to the affected clients.
- Rate limiting: cap messages/sec per connection; queue intents; drop-and-error spam.

## 5. Authentication flow

```text
client ── POST /api/auth/login ──► server ──► SQLite (verify hash)
server ── { accessToken (JWT, 15m), refreshToken (random, 7d) } ──► client
client stores tokens (localStorage/sessionStorage; gameplay state stays server-side)
client ── GET /api/ws-token ──► server ──► { wsToken (30s) }
client ── WS connect + { type: "authenticate", token: wsToken } ──► server
server validates wsToken → binds socket to account+character → sends "authenticated"
```

- **Passwords:** hashed with **argon2id** (or bcrypt) — never plain text, never logged.
- **Refresh tokens:** random, stored hashed in SQLite (`refresh_tokens`), rotated on each
  refresh, revocable on logout/compromise.
- **Access tokens:** short-lived JWTs signed with a server secret from env.
- **Secrets:** `JWT_SECRET`, DB credentials, token-pepper — env/secrets store only;
  never in the repo (`docs/` and `.env*` excluded from commits; `.gitignore` updated in
  Phase 1).

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
