# Network layer ownership

This document defines the current boundary without changing runtime behavior.

## `src/net/GameSocket.ts`

`GameSocket` owns transport and protocol concerns:

- fetches the short-lived WebSocket handshake token;
- opens, authenticates, closes, and reconnects the browser WebSocket;
- serializes client intent frames;
- decodes and normalizes server frames into typed callback payloads;
- throttles movement intents and tracks transport status;
- exposes no Phaser entity ownership and does not decide gameplay outcomes.

The server remains authoritative. Socket methods send intent; server responses are the source of truth.

## `src/systems/NetworkSystem.ts`

`NetworkSystem` owns game-facing integration:

- binds the socket to the active Phaser scene;
- creates, updates, reconciles, and destroys `RemotePlayer` and `Monster` entities;
- filters snapshots by expected zone and sequence;
- forwards quest, inventory, chat, combat, respawn, and connection events to scene/UI callbacks;
- updates the player status HUD and minimap-facing positions;
- translates gameplay requests from the scene into socket calls.

It must not duplicate server validation or invent authoritative state.

## Proposed low-risk migration list

Do not perform these as a single rewrite. Each move should preserve protocol payloads and have focused tests.

1. Extract pure frame normalization helpers from `GameSocket.ts` into a protocol-normalization module.
2. Extract socket lifecycle/reconnect state into a transport-focused module only after the existing reconnect tests cover every transition.
3. Extract `NetworkSystem` snapshot filtering and sequence reconciliation into pure functions; retain entity mutation in `NetworkSystem`.
4. Extract HUD/status forwarding from `NetworkSystem` only after scene-restart and callback lifecycle tests exist.
5. Keep `RemotePlayer`, `Monster`, Phaser scenes, and server authority outside the transport layer.

## Verification boundary

`tests/net/game-socket.test.ts` can prove serialization, token handling, lifecycle, throttling, and callback dispatch. It cannot prove browser rendering, animation quality, camera feel, touch behavior, or live multiplayer gameplay. Those remain `REQUIRES SEELLE/BROWSER VERIFICATION`.
