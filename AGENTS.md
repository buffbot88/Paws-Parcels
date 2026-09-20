# Paws & Parcels AI contribution guide

## Project

Paws & Parcels is an existing open-world courier RPG. Do not regenerate or replace it. Deliveries are the central progression and gameplay identity; combat supports the world.

## Architecture

- Client: Phaser 4, TypeScript, and Vite, with DOM-over-Canvas HTML/CSS UI.
- Server: Node + TypeScript.
- Network: HTTP for account/content operations and WebSocket for authoritative gameplay synchronization.
- Persistence: SQLite for server-side player state, ownership, progression, and audit history.
- Static content: versioned JSON under `src/data/`, synchronized into server lookup tables.

## Authority rules

The server is authoritative. Never make these client-authoritative:

- position validation and movement;
- combat, HP, damage, loot, and respawn;
- inventory, equipment, item ownership, and currency;
- quests, deliveries, friendship progression, and rewards;
- player/account ownership checks;
- persistence or audit records.

The client may render server state, send intent messages, and store non-authoritative preferences such as UI and audio settings.

## Required reading

Before changing architecture or gameplay, read:

- `VOWS.md`
- `README.md`
- `BuildPlan.md`
- `ROADMAP.md`
- `design/architecture.md`
- `design/decisions.md`
- the relevant system design document
- `design/AI-HANDOFF.md`

## Modification policy

- Fix confirmed defects and extend working systems; do not perform broad rewrites without an approved plan.
- Preserve the existing server-authoritative multiplayer architecture.
- Preserve existing authored artwork and source asset paths.
- Historical migrations are immutable. Do not rename, rewrite, reorder, or delete applied migrations.
- Do not commit secrets, production SQLite databases, tokens, temporary captures, or generated deployment output without a deliberate release reason.
- Treat `deploy/**`, asset catalogs, and temporary files as generated or operational context unless the relevant generator/source is being changed.
- Do not silently change unrelated behavior.
- Anything requiring visual judgment, browser interaction, or live gameplay must be marked `REQUIRES SEELLE/BROWSER VERIFICATION` unless an automated test actually proves it.

## Important current boundaries

- Authentication is delegated to ASHAT Hub OIDC; the game server verifies Hub tokens and issues its session JWT. Do not add a parallel local-password flow without an explicit architecture decision.
- Client transport lives in `src/net/GameSocket.ts`, while game-facing synchronization belongs in `src/systems/NetworkSystem.ts`; see `design/network-ownership.md`.
- Dungeons and crafting remain planned Phase 6 systems; do not present them as implemented.
- The local map panel is intentionally incomplete. Do not restore dead waypoint, pan, or zoom claims without implementing and testing them.
- The AI game engine and Visual Director are experimental and must retain deterministic fallbacks and dry-run boundaries.

## Verification gate

Run this before handing off a change:

```bash
npm run typecheck
npm test
npm run validate
npm run build
```

Prefer `npm run verify` when the full repository gate is appropriate. Add focused tests for deterministic server, content, network, or DOM behavior. Full visual appearance, keyboard behavior in a live browser, accessibility, animation quality, camera feel, and gameplay feel remain `REQUIRES SEELLE/BROWSER VERIFICATION`.

## Generated and temporary context

Normally ignore generated deployment output and large catalogs while reasoning about application code:

- `deploy/**`
- `design/assets/asset-inventory.json`
- `design/assets/asset-reviews.json`
- generated asset-catalog HTML/JSON
- `tmp/**`

Edit their source generators or metadata instead. See `deploy/README.md` and `design/assets/README.md` for details.
