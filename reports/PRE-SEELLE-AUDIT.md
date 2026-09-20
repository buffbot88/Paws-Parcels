# Paws & Parcels — Pre-Seele Audit

**Audit date:** 2026-09-20  
**Preparation stage:** Freebuff source-level cleanup and handoff  
**Target:** Seele AI / browser-capable gameplay iteration

## Executive summary

Paws & Parcels is an existing server-authoritative courier RPG baseline. The repository is prepared for visual/game-capable follow-up: known Batch 1 defects were fixed, Node 24 and CI gates were standardized, temporary diagnostics were cleaned, generated deployment output was documented, AI-facing guidance was added, and low-risk route/network boundaries were documented.

This report does **not** claim that the game has been visually inspected or manually played. Browser, accessibility, animation, camera, touch, layout, and gameplay-feel checks remain:

> **REQUIRES SEELLE/BROWSER VERIFICATION**

No production database, committed server configuration, or obvious secret artifact was found during this audit. Existing authored artwork and historical migrations were preserved.

## Repository health

### Verification gates

The final gate for this audit is:

```text
npm run verify
```

which runs:

```text
npm run typecheck
npm test
npm run validate
npm run build
```

Batch 1–5 verification completed successfully during preparation. Batch 6 reruns the complete gate after this report is written.

Additional health rails now present:

- `.github/workflows/ci.yml` runs on Node 24 with `npm ci`, an isolated secret-free test configuration, typecheck, tests, content validation, and build.
- `.node-version` declares Node 24.
- `package.json`, `package-lock.json`, Render configuration, and CI are aligned to the Node 24 baseline.
- `npm run verify` provides one repository health command.
- Fresh temporary SQLite migration coverage applies all current migrations and synchronizes static content.
- Migration checksum tests cover SHA-256 records and legacy length-checksum compatibility.

### Repository safeguards

- `AGENTS.md` exists with architecture, authority, testing, migration, secrets, and generated-file rules.
- `design/AI-HANDOFF.md` exists as the authoritative Seele introduction.
- `design/migrations.md` documents immutable migration history and the duplicate historical `005_` prefix.
- `design/network-ownership.md` documents the `GameSocket` versus `NetworkSystem` boundary.
- `tests/e2e/README.md` reserves a conservative browser-test location without adding a browser dependency.
- `reports/` contains the final audit and selected visual-review history.
- No production SQLite database, `server_config.json`, or `.env` secret file is tracked.

## Fixed items

### Batch 1 — known defects

#### CharacterMenu stylesheet integration

- **Issue:** CharacterMenu rules existed only in root-level `restore-tmp.css`, which was not imported by the client.
- **Files:** `src/styles/character-menu.css`, `src/main.ts`, `restore-tmp.css`.
- **Solution:** Moved the existing rules into the imported stylesheet and removed `restore-tmp.css` without redesigning the menu.
- **Status:** Source integration fixed. Appearance remains **REQUIRES SEELLE/BROWSER VERIFICATION**.

#### AI configuration validation ordering

- **Issue:** accumulated configuration errors could be checked before AI validation completed.
- **Files:** `server/src/config/index.ts`, `tests/server/config.test.ts`.
- **Solution:** all configuration sections are validated before the final failure check; coverage includes disabled/enabled AI, numeric bounds, and required model/projector paths.

#### Inventory keyboard action

- **Issue:** the HUD advertised `Inventory (I)` without an InputSystem action.
- **Files:** `src/systems/InputSystem.ts`, `src/scenes/OverworldScene.ts`, `src/ui/InventoryButton.ts`.
- **Solution:** added a queued inventory action consumed by the scene's existing inventory-opening path, with text-input and modal guards.
- **Status:** Deterministic source coverage exists; live keyboard behavior remains **REQUIRES SEELLE/BROWSER VERIFICATION**.

#### Navbar listener lifecycle

- **Issue:** repeated navbar/account setup could accumulate document-level listeners.
- **Files:** `src/ui/TopBar.ts`, `src/main.ts`.
- **Solution:** account rendering and listener ownership moved into stable `TopBar.setAccount`, `clearAccount`, and `destroy` lifecycle methods.

#### Inventory nested controls

- **Issue:** inventory slot buttons could contain Equip/Unequip buttons.
- **Files:** `src/ui/CharacterProfilePanel.ts`.
- **Solution:** inventory cells are non-button containers; actual actions remain separate buttons while drag/drop, labels, quantities, and equipment state remain supported.
- **Status:** DOM structure is source-level fixed; accessibility and browser interaction remain **REQUIRES ACCESSIBILITY/BROWSER VERIFICATION**.

#### Local Map unfinished controls

- **Issue:** the panel presented waypoint/pan/zoom behavior that was not implemented.
- **File:** `src/ui/LocalMapPanel.ts`.
- **Solution:** waypoint is disabled and marked `Coming Soon`; unsupported pan/zoom claims were removed.
- **Status:** The panel is intentionally incomplete. Finishing it is a Seele/browser task.

### Batch 2 — safety rails

- Standardized Node 24 in `package.json`, `package-lock.json`, `.node-version`, Render configuration, and CI.
- Added `npm run verify`.
- Added isolated CI configuration generation using `server_config.test.example.json`; no secrets are committed.
- Added fresh temporary SQLite migration/static-content integration coverage.
- Added SHA-256 migration checksums while preserving legacy decimal file-length checksum compatibility.
- Documented immutable migrations and preserved both historical `005_` files unchanged.
- Reconciled SQLite runtime documentation across README, knowledge, and database design docs.

### Batch 3 — repository cleanup

- Removed five tracked temporary diagnostics from `tmp/`.
- Preserved intentional historical reports under `reports/`.
- Audited deployment output without destructive bulk deletion.
- Documented generated families and source generators in `deploy/README.md`, `deploy/asset-catalog/README.md`, `deploy/BrowseAssets/README.md`, marker files, and `Asset Catalog/README.md`.
- Kept generated catalog output tracked because the current static deployment consumes it directly.

### Batch 4 — AI handoff and documentation reconciliation

- Added `AGENTS.md`.
- Added `design/AI-HANDOFF.md`.
- Corrected stale BuildPlan authentication wording from local email/password to ASHAT Hub OIDC and server-issued JWT sessions.
- Added handoff and agent-guide links to README/knowledge.
- Marked dungeons, crafting, Local Map behavior, experimental AI, generated tooling, and visual review boundaries honestly.

### Batch 5 — low-risk structural preparation

- Added a staged modular admin route boundary under `server/src/routes/admin/` for overview, players, inventory, settings/audit, roles, and items.
- Preserved `server/src/routes/admin.ts` as a compatibility barrel and retained the existing handler implementation in `admin/legacy.ts` to avoid a broad behavior-changing rewrite.
- Added `tests/server/admin-route-boundary.test.ts`.
- Documented `GameSocket` transport/protocol ownership versus `NetworkSystem` game-facing synchronization.
- Added source comments clarifying the network boundary.
- Added `tests/e2e/README.md` as a conservative future browser-test skeleton; no browser runner or brittle coordinate scripts were introduced.

## Remaining known issues

### Visual and browser issues — P0/P1 for Seele review

These cannot be validated by the Node/Vitest gate:

- CharacterMenu visual appearance and responsive layout.
- HUD overlap, profile/inventory presentation, modal focus behavior, and responsive DOM layout.
- Local Map presentation and the eventual waypoint/pan/zoom interaction design.
- Camera framing and zoom feel in Clover Village and Happy Valley.
- Depth sorting, sprite/prop alignment, scale, anchors, collision/art adjacency, and occlusion.
- Animation smoothness and class/NPC/monster presentation.
- Touch controls, mobile layout, keyboard behavior, and accessibility in a real browser.
- Overall playability, courier-loop clarity, encounter feel, and gameplay fun.

All items above are **REQUIRES SEELLE/BROWSER VERIFICATION**.

### Code and architecture issues

- `server/src/routes/admin/legacy.ts` still contains the complete admin handler implementation. The new route modules are a compatibility/staging boundary, not a completed full physical split. Future extraction should move one domain at a time with endpoint/permission/audit regression tests.
- `src/scenes/OverworldScene.ts` remains high-responsibility. Extract interaction, capture, or transition logic only as separate low-risk changes.
- `GameSocket` and `NetworkSystem` remain behaviorally coupled through callback payloads. The proposed pure-function extraction list is documented in `design/network-ownership.md`; do not perform a networking rewrite before browser/gameplay review.
- `src/game/ArchivedMaps.ts` is transitional but still used by `scripts/validate-content.ts` and `src/systems/MapValidator.ts`. It should not be deleted until compatibility callers are migrated and covered.
- The E2E directory is only a skeleton because no browser runner is currently configured.
- Some map/location labels and authored placement data remain intentionally code/data-local. A future content audit should separate reusable content from rendering-specific placement rather than data-driving everything blindly.

### Content and asset issues

- `design/assets/asset-inventory.json` and `asset-reviews.json` are large generated/reference metadata files and should not be treated as ordinary application context.
- `deploy/asset-catalog/` contains a large generated API/review/contact-sheet tree. It remains tracked for the current deployment workflow; a future CI/deployment change can publish generated artifacts without committing them.
- Six tracked visual-capture pairs remain under `server/data/visual-captures/`. They are diagnostic artifacts, not runtime source. They were not deleted in this audit because they may be useful historical review evidence; a deliberate artifact-retention decision should remove or relocate them later.
- Existing visual reports include unavailable/invalid model runs and one low-information successful report. They are historical diagnostics, not proof of visual quality.
- No authored artwork was replaced, renamed, or regenerated by this preparation pass.

### Security and operations

- No obvious token, secret, password, or authorization value is logged by the audited server logging patterns; OIDC logs report endpoint/status failures rather than token contents.
- Authentication is delegated to ASHAT Hub OIDC and remains central infrastructure. Do not introduce a local-password flow without an explicit architecture decision.
- Public-alpha security review, browser compatibility review, load testing, reconnect stress testing, and operational backup/restore procedures remain future gates.
- SQLite remains the selected persistence technology. No database-technology migration should occur without real load testing and a separate approved plan.

### Performance and scaling

- Current architecture is appropriate for the prototype/vertical slice, not a demonstrated large-scale MMO.
- Zone sharding, load testing, snapshot-rate tuning, and multi-process SQLite constraints remain Phase 8/P3 work.
- The visual asset catalog and generated deployment output are large and should be built/published as artifacts rather than loaded into normal AI code context.

## Requires Seele/browser verification

1. Boot the game in a supported browser and confirm the client reaches a stable playable state.
2. Verify CharacterMenu appearance, open/close behavior, account actions, and responsive layout.
3. Verify the `I` shortcut opens inventory and does not fire in text fields or active modal contexts.
4. Verify CharacterProfilePanel inventory semantics: no nested buttons, usable Equip/Unequip actions, drag/drop, focus order, and screen-reader labels.
5. Verify Local Map open/close behavior and confirm unfinished controls are clearly presented.
6. Inspect Clover Village and Happy Valley camera framing, map readability, ground presentation, props, NPCs, monsters, and transitions.
7. Inspect depth sorting, anchors, sprite scale, collision alignment, and interaction-art adjacency.
8. Test desktop and mobile/touch input, HUD overlap, modal keyboard behavior, and responsive layout.
9. Test multiplayer presence, movement reconciliation, reconnect behavior, combat, deliveries, inventory, and equipment in live browser sessions.
10. Review animations, effects, audio, pacing, and overall courier gameplay feel.

## Seele-safe areas

Seele can reasonably iterate on the following with browser/gameplay validation:

- Clover Village and Happy Valley visual composition and polish.
- Camera, depth, scale, sprite/prop alignment, animation presentation, and HUD layout.
- Mobile/touch controls and browser accessibility behavior.
- Local Map waypoint/pan/zoom interaction design.
- Reference-art selection and runtime art wiring after visual review.
- Courier delivery presentation and broader quest content while preserving server validation.
- First dungeon and crafting design after confirming Phase 6 scope.

## Seele-restricted areas

These areas require careful source-level review and should not be casually rewritten:

- ASHAT Hub OIDC authentication, JWT sessions, ownership checks, and account status enforcement.
- Server authority for position, combat, HP, loot, inventory, equipment, quests, deliveries, rewards, and persistence.
- WebSocket protocol semantics and reconnect/zone synchronization.
- SQLite schema, migration filenames, migration checksums, and static-content synchronization.
- Admin permission gates, step-up checks, CSRF enforcement, audit writes, and live-session disconnects.
- Deterministic fallbacks and failure boundaries for the optional AI game engine.
- Existing authored artwork, source paths, and the reference archive.

## Final handoff checklist

- [x] Batch 1 known defects fixed.
- [x] Node 24 standardized.
- [x] CI and `npm run verify` present.
- [x] Fresh migration/static-content test present.
- [x] SHA-256 migration checksums with legacy compatibility present.
- [x] Migration immutability documented.
- [x] Tracked temporary diagnostics removed.
- [x] Generated deployment families documented.
- [x] `AGENTS.md` present.
- [x] `design/AI-HANDOFF.md` present.
- [x] Network ownership documented.
- [x] Conservative E2E skeleton present.
- [ ] Browser/gameplay/visual verification completed by Seele or a browser-capable reviewer.
- [ ] Public-alpha security, load, reconnect, and browser-matrix gates completed.
- [ ] Generated visual captures receive a deliberate retention/removal decision.

**Freebuff preparation conclusion:** source-level baseline ready for Seele ingestion; visual/gameplay verification is the next required stage.
