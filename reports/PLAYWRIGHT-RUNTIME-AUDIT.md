# Playwright Runtime Audit — Paws & Parcels

**Date:** 2026-09-21
**Scope:** browser/runtime verification previously blocked as `REQUIRES SEELLE/BROWSER VERIFICATION`
**Tooling:** Playwright 1.63 driving the system Chrome (headless), real Vite client + isolated game server
**Result:** **14 / 14 specs passing** in 3.2 minutes (`npm run e2e`); `npm run verify` green

---

## 1. What was verified

| Spec | Tests | Result |
| --- | --- | --- |
| `auth.spec.ts` | 1 | ✅ dev-login issues a session, strips `?dev-login`, reaches a valid desk/game outcome |
| `boot.spec.ts` (first milestone) | 2 | ✅ canvas, WS authenticate + zone join, Clover Village live, clean runtime, reload repeatability |
| `hud.spec.ts` | 3 | ✅ no pre-auth HUD, exactly one authenticated HUD, no duplicates after reload |
| `inventory.spec.ts` | 2 | ✅ `I` and the HUD button open the courier ledger, singleton modal, Escape closes, no movement side effects |
| `map.spec.ts` | 1 | ✅ `M` opens the Local Map, locations render, search filters, waypoint disabled ("Coming Soon") |
| `movement.spec.ts` | 2 | ✅ WASD moved the courier, `move_intent` frames sent, snapshots streamed, bounds held |
| `interact.spec.ts` | 1 | ✅ walked to Pip, `E` opened dialogue, panel advanced and closed |
| `combat.spec.ts` | 1 | ✅ walked to Happy Valley, `J` produced a server `combat_event`, client HP bar mirrored the server |
| `reconnect.spec.ts` | 1 | ✅ reload restored session/socket/HUD, no duplicate presence |

**Tests failed:** none in the final run. (Intermediate failures during development are all traced below to the four defects plus harness issues.)

### Runtime assertion rules actually enforced

Fail on: uncaught page exceptions, console errors, failed WebSocket authentication, `5xx` from `/api/*`, and `404` for built client assets under `/static/`.
Tolerated: the 404s the dev client expects for optional resources (production-only `client-config.txt`, legacy font formats).

**Console errors observed in the final run:** none.
**Network errors observed in the final run:** none.

---

## 2. Runtime defects found and fixed

### D1 — `I` key and HUD InventoryButton were silent no-ops (HIGH, fixed)

- **Reproduction:** dev-login → boot to Overworld → press `I`, or click the HUD inventory button. Nothing happens; no panel, no error.
- **Affected files:** `src/ui/CharacterProfilePanel.ts`, `src/main.ts`
- **Expected:** the courier ledger (Character Profile) opens — the HUD advertises `Inventory (I)`.
- **Observed:** `.profile-panel` never appeared in the DOM; the click and the key both silently did nothing. The courier-menu path ("◈ Character, bag & skills") worked, which is why the defect survived source review.
- **Likely cause:** `CharacterProfilePanel.instance` is assigned **only** inside `mount()`, and `mount()` was only reachable through `open()`. The scene's `openInventory()` and the HUD button both go through `CharacterProfilePanel.instance?.open(...)`, so with a null static the optional chain no-op'd.
- **Fix:** register the singleton at startup (`profilePanel.mount()` in `main.ts`), so the panel exists before the world boots.
- **Verified:** `inventory.spec.ts` passes; an instrumented browser probe showed `panelHidden: false` immediately after the `I` keypress.
- **Note:** this is exactly the gap the PRE-SEELLE audit flagged as "deterministic source coverage exists; live keyboard behavior remains REQUIRES SEELLE/BROWSER VERIFICATION" — the source-level fix was incomplete and only a real browser could catch it.

### D2 — Local Map search filter had no visual effect (MEDIUM, fixed)

- **Reproduction:** boot → `M` → type "post" in the map search.
- **Affected files:** `src/styles/game-ui.css` (behaviour in `src/ui/LocalMapPanel.ts` was correct)
- **Expected:** only "Post Office" remains visible.
- **Observed:** the filter set `hidden` on non-matching buttons, but every button still displayed — all six rendered `display: flex`. A browser probe confirmed the attribute was set on 5 of 6 buttons while none were hidden.
- **Likely cause:** `.local-map-panel__location { display: flex }` out-specifies the user-agent `[hidden] { display: none }` rule, so the attribute had no effect.
- **Fix:** add `.local-map-panel__location[hidden] { display: none; }`.
- **Verified:** `map.spec.ts` asserts exactly one location stays unhidden (the match), that it renders, and that a non-match is genuinely hidden.

### D3 — Courier menu actions unreachable with a full roster (MEDIUM, fixed)

- **Reproduction:** sign in to an account with ~15 couriers → open the in-game courier menu. The bottom actions ("＋ Create a new courier", "Sign out") cannot be reached.
- **Affected file:** `src/styles/character-menu.css`
- **Expected:** every menu action stays reachable.
- **Observed:** Playwright reported `element is outside of the viewport` and could not scroll to the action; the panel grew taller than the viewport with no scroll container.
- **Likely cause:** `.character-menu__panel` had no `max-height` and no `overflow-y`.
- **Fix:** `max-height: calc(100vh - 96px); overflow-y: auto; overscroll-behavior: contain;`.
- **Verified:** the harness's fresh-courier flow (which needs that exact action) now drives it reliably; the panel scrolls instead of clipping.

### D4 — `POST /api/npc/talk` returned 404 for every NPC when the server ran from a different working directory (MEDIUM, fixed)

- **Reproduction:** start the game server from any directory other than the repo root, then interact with an NPC.
- **Affected file:** `server/src/routes/npc.ts`
- **Expected:** `{ line: null, source: "canned" }` (200) when the AI engine is disabled.
- **Observed:** `404 UNKNOWN_NPC` because the NPC catalog path was resolved from `process.cwd()`; the browser logged a failed-resource console error and the endpoint never reached its canned fallback.
- **Likely cause:** `resolve(process.cwd(), "src/data/npcs.json")` — the repo's own `ws/zoneData.ts` documents the opposite rule ("resolve relative to this module, never `process.cwd()`").
- **Fix:** resolve the catalog from the module URL (`import.meta.url`), matching `zoneData.ts`.
- **Verified:** `interact.spec.ts` exercises the NPC dialogue path with no console or network errors.

### Pre-existing test-suite breakage (fixed so the gate means something)

`tests/systems/network-hud-lifecycle.test.ts` **failed 6/6 at `HEAD` before this work**: it imports `NetworkSystem`, which pulls Phaser's ESM build (and the Phaser scene graph via `GameConfig`) into a `node`-environment test, raising `ReferenceError: window is not defined`. Phaser's version was unchanged (`4.2.1` in both `HEAD` and the working tree), so this was not dependency drift. The test now mocks `phaser`, `GameConfig`, `RemotePlayer`, and `Monster` — matching its existing mock pattern — and all 6 tests pass in 66 ms. The behaviour it guards is *also* confirmed in a real browser by `hud.spec.ts`.

**Item #1 (HUD lifecycle) status:** the source-level guard was already correct (mount after auth, single mount, teardown on shutdown) and is now verified live: no pre-auth HUD, exactly one authenticated HUD, no duplicates after reload.

---

## 3. Screenshots captured

Stable paths under `artifacts/playwright/` (gitignored):

| File | Contents |
| --- | --- |
| `clover-village-baseline.png` | authenticated Clover Village (first-milestone baseline) |
| `auth-desk.png` | dev-login hand-off / Character Desk |
| `hud.png` | authenticated HUD (top bar, status card, tracker, skill bar, inventory button, chat, minimap) |
| `character-profile.png` | Character Profile with the inventory ledger open |
| `local-map.png` | Local Map panel with locations and the disabled waypoint control |
| `movement.png` | courier after WASD movement through the server-validated path |
| `dialogue.png` | Pip dialogue panel open |
| `happy-valley.png` | Happy Valley after the southern transition |
| `combat-state.png` | post-attack combat state (server-confirmed damage) |
| `reconnect.png` | restored session after page reload |

---

## 4. How it runs (and the environment constraints discovered)

```bash
npm run e2e          # full suite
npm run e2e:headed   # watch it drive a window
npm run e2e:report   # HTML report
```

- **Isolated backend.** The suite starts its own game server on **3004** (`tests/e2e/env/server/server_config.json`, `devLoginEnabled: true`) with a throwaway SQLite database that is **wiped before every run** (`reset-e2e-db.mjs`). The developer's own 3003 server, its database, and all production credentials are never touched.
- **Proxy.** `vite.config.ts` proxy targets now come from `PAWS_GAME_SERVER` (default `http://127.0.0.1:3003`, matching the local server layout); the e2e stack points it at 3004.
- **Browser.** Playwright's browser CDN is unreachable from this machine (`cdn.playwright.dev` times out), so the suite uses the **system Chrome** via `use.channel`. Override with `PLAYWRIGHT_CHANNEL=msedge`, or `PLAYWRIGHT_CHANNEL=chromium` after a successful `node node_modules/playwright/cli.js install chromium`.
- **npm shims.** The repo path contains `&`, which breaks npm's `.bin` shims on Windows; the e2e scripts invoke the Playwright CLI through an explicit node path, like the existing `tsc`/`vitest` scripts.
- **dev-login entry.** `http://localhost:5173/?auth=1&dev-login=1` — **both** params are required: the client only opens its login overlay with `auth=1`, and the dev shortcut additionally needs `dev-login=1` (localhost-only).
- **Cold Vite.** A cold dev server (dependency re-optimization, entry graph transforms) can outlast a navigation budget; `tests/e2e/support/global-setup.ts` now warms the server before the first spec.
- **Test isolation.** Every spec creates its own fresh courier, so no spec inherits another's persisted zone or position (an earlier run had `combat` leave its courier in Happy Valley, which poisoned every later spec).

---

## 5. Requires human visual review (not machine-assertable)

Playwright deliberately makes **no** claims about these — they remain `REQUIRES SEELLE/BROWSER VERIFICATION`:

- camera feel, follow smoothing, and zoom behavior in Clover Village and Happy Valley;
- art direction, depth sorting, prop scale, and whether the village reads as "cozy";
- animation quality (walk cycle, attack timing, monster motion) and combat-effect appeal;
- dialogue panel and HUD layout aesthetics, typography, and readability at real sizes;
- audio (not exercised at all — the suite runs muted headless);
- accessibility beyond roles/labels (focus order, screen-reader narration, contrast);
- mobile/touch feel: the drag joystick, tap-to-interact, and responsive HUD at phone widths.

## 6. Remaining untested areas

- **Equip / unequip through the UI** — a freshly created courier owns no gear, so `inventory.spec.ts` leaves this unasserted (it does not fail; it simply does not cover it). Needs a test item granted via the server API.
- **Mid-session socket drop** — the reload path is covered; a raw socket kill without reload is not (the client's reconnect ladder is unit-tested in `tests/net/game-socket.test.ts`).
- **Quests, chat, and NPC delivery flows** — only the Pip dialogue-open path is exercised.
- **Defeat / respawn** — not driven intentionally (no attempt to die), though the defeat freeze is reachable in Happy Valley.
- **Multiple real clients in one zone** — presence is verified for a single session only; remote-player rendering is unverified with two browsers.
- **Admin Control Panel**, **AI game engine**, **Visual Director** — out of scope for this suite.
- **Dungeons and crafting** — planned Phase 6 systems, not implemented.
