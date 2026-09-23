# End-to-end runtime validation (Playwright)

Real-browser verification for Paws & Parcels: the client boots against an
isolated game server in headless Chrome, drives the game with real keyboard
input, inspects console/network/WebSocket behavior, and captures screenshot
checkpoints.

This replaces "ask the agent to look at the game". It asserts only what a
browser can prove deterministically.

## Run it

```bash
npm run e2e            # full suite
npm run e2e:headed     # watch it drive a real window
npm run e2e:report     # open the HTML report
```

Everything is orchestrated by `playwright.config.ts`, which starts two servers:

| Server | Port | Notes |
| --- | --- | --- |
| isolated game server | 3004 | `tests/e2e/env/server/server_config.json`, `devLoginEnabled: true`, throwaway SQLite, AI off |
| Vite dev client | 5173 | proxy pointed at the isolated server via `PAWS_GAME_SERVER` |

The developer's own server (3003), its database, and all production credentials
are never touched. `tests/e2e/env/server/reset-e2e-db.mjs` wipes the throwaway
database before each run so results do not depend on a previous run.

### Local requirements

- **A Chromium browser.** The Playwright browser CDN is not reachable from every
  environment, so the suite defaults to the system Chrome
  (`use.channel = "chrome"`). Override with
  `PLAYWRIGHT_CHANNEL=msedge npm run e2e`, or install the bundled build with
  `node node_modules/playwright/cli.js install chromium` and use
  `PLAYWRIGHT_CHANNEL=chromium`.
- **Free ports 3004 and 5173.** The run fails fast rather than silently reusing
  a stale server (`reuseExistingServer: false`), because a reused Vite instance
  would proxy to the wrong backend.
- The dev-login harness needs `server.nodeEnv = "development"` and
  `auth.devLoginEnabled = true` — already set in `tests/e2e/env/server/server_config.json`.

Note: the repository path contains `&`, which breaks npm's `node_modules/.bin`
shims on Windows, so the npm scripts invoke the Playwright CLI through an
explicit node path (same reason as `tsc`/`vitest`).

## Suites

Nothing after `boot` should be treated as green until `boot` is reliably green.

| Spec | What it proves |
| --- | --- |
| `auth.spec.ts` | dev-login issues a session, strips `?dev-login`, reaches the desk/game |
| `boot.spec.ts` | **first milestone** — canvas, WS authenticate + zone join, Clover Village live, clean runtime, baseline screenshot, reload repeatability |
| `hud.spec.ts` | no pre-auth HUD, exactly one authenticated HUD, no duplicates after reload |
| `inventory.spec.ts` | `I` and the HUD button open the courier ledger, singleton modal, Escape closes, no movement side effects |
| `map.spec.ts` | `M` opens the Local Map, locations render, search filters, waypoint is honestly disabled |
| `movement.spec.ts` | WASD moves the courier through server-validated intents; snapshots stream; bounds hold |
| `interact.spec.ts` | walking to Pip and pressing `E` opens dialogue, which advances and closes |
| `combat.spec.ts` | travel to Happy Valley, `1` produces a server `combat_event`, the client HP bar mirrors the server |
| `render3d.spec.ts` | the world renderer: the WebGL canvas fills the window, the sprite camera stepped aside, the HUD paints above it, and `?renderer=2d` still gives the sprite world |
| `reconnect.spec.ts` | reload restores session/socket/HUD with no duplicate presence |
| `visual-baseline.spec.ts` | **visual overhaul baseline** — the fixed set of review framings (see below) |

`tests/e2e/support/harness.ts` owns the shared plumbing: the dev-login boot
(all three desk steps, plus an optional `query` for non-authoritative boot
preferences such as `renderer=2d`), per-test fresh couriers (state isolation),
console / network / WebSocket collection with the failure rules below, white-box
probes into `window.game`, and screenshot helpers.

**Two canvases.** The 3D world renderer draws into its own canvas stacked over
Phaser's, so `#game-container > canvas` resolves to two elements. `SEL.spriteCanvas`
is Phaser's (`:not([data-renderer])`) and `SEL.world3dCanvas` is the world surface;
every spec that means "the game canvas" uses one of those by name.

## Failure rules

The suite **fails** on: uncaught JS exceptions, console errors, failed
WebSocket authentication, 5xx responses from `/api/*`, and 404s for built
client assets under `/static/`. It **tolerates** the 404s the dev client
expects for optional resources (the production-only `client-config.txt`, legacy
font formats).

## Screenshots

Stable filenames under `artifacts/playwright/` (gitignored): the Clover Village
baseline, auth desk, HUD, character profile, local map, movement, dialogue,
Happy Valley, combat state, and reconnect.

## Visual baseline captures

```bash
npm run visual:baseline
```

The visual overhaul (camera framing, HUD footprint, terrain integration,
landmark scale, density, depth, lighting) is reviewed against a **fixed set of
framings** rather than one screenshot at a time, so each pass can be compared
with the last. This spec produces them in a single run; it asserts nothing
about whether they look good, because Playwright cannot judge composition,
camera feel, or art direction.

| Capture | Framing |
| --- | --- |
| `town-centre` | Post Office as the dominant centre landmark, plaza, path exits |
| `cafe` | Café Biscuit frontage, seating, path approach |
| `florist` | Florist stall, flower beds, shopfront scale |
| `research-shop` | Research shop frontage and props against the terrain |
| `village-edge` | Southern gate, forest boundary, where terrain treatment stops |
| `happy-valley` | Second-zone arrival (skipped with a blocker note if travel is non-deterministic) |
| `inventory-open` | Courier ledger over the live world |
| `local-map-open` | Full-screen field guide |
| `spawn-framing` | **Real player view** on arrival, no camera override |
| `walk-framing` | **Real player view** mid-walk, camera following |

**Anchors are data-driven.** Landmark framings read the live scene's authored
`mapData` (interactables, transitions, NPC home tiles), so a map change moves
the captures with it instead of silently framing the wrong place.

**Camera-framed captures are rendering-only.** They stop camera follow and
centre it on an anchor tile, which touches no gameplay state: the courier's
server-owned position, collision, and presence are untouched, and no
production code is involved (the suite already probes `window.game`
deliberately). The two `player-view` captures are plain screenshots with the
camera following, so every run includes frames that are exactly what a player
sees.

Output: PNGs plus `manifest.json` under `artifacts/visual-baseline/`
(gitignored). The manifest records the zone, anchor, camera transform, and
viewport for each capture.

### HUD footprint

`hud.spec.ts` additionally asserts that the world HUD stays **inside the game
window** (every panel's box within the container, none clipped), that the
canvas fills the window instead of being displaced by a panel, and that the
HUD's union coverage of the window stays under a budget so the world remains
the dominant surface.

## Boundaries

Playwright verifies element presence/visibility, bounding boxes, console and
network behavior, interaction, deterministic state, and screenshots. It must
never assert subjective quality — camera feel, art direction, animation
quality, or whether combat effects are attractive. Those stay human
visual-review tasks, and any remaining gap is reported as
`REQUIRES SEELLE/BROWSER VERIFICATION` in `reports/PLAYWRIGHT-RUNTIME-AUDIT.md`.
