# End-to-end test skeleton

This directory reserves a home for browser-capable smoke tests for Seele or a later Playwright setup.

The repository currently does not include a browser runner. Do not add coordinate-based or pixel-based scripts here. Future tests should be deterministic and verify only stable contracts such as boot, HUD visibility, inventory opening, and map modal state after the application is served in a controlled browser.

Suggested future specs:

- `boot.spec.ts` — the client reaches a stable boot state;
- `hud.spec.ts` — core HUD controls are present and accessible;
- `inventory.spec.ts` — the inventory button and `I` shortcut open the profile panel;
- `map.spec.ts` — the map opens/closes and honestly exposes unfinished controls.

Until a browser runner is selected and configured, these checks remain `REQUIRES SEELLE/BROWSER VERIFICATION`.
