import { defineConfig } from "@playwright/test";

/**
 * Playwright runtime-validation config (tests/e2e).
 *
 * Two servers are started for the suite:
 *   1. An isolated game server (port 3004, tests/e2e/env/server) with the
 *      dev-login auth harness enabled and a throwaway SQLite database — the
 *      developer's own server (3003) and database are never touched.
 *   2. The Vite dev client (port 5173) with its /api + /ws proxy pointed at
 *      the isolated server via PAWS_GAME_SERVER.
 *
 * Browsers: Chromium only. `channel: "chrome"` uses the system Chrome install
 * (the Playwright browser CDN is not reachable from every dev environment);
 * set PLAYWRIGHT_CHANNEL=chromium to use the downloaded Playwright build.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:5173",
    channel: (process.env.PLAYWRIGHT_CHANNEL ?? "chrome") as
      | "chrome"
      | "chromium"
      | "msedge",
    viewport: { width: 1280, height: 800 },
    // Keep the run deterministic: no permission prompts, fixed locale/timezone.
    permissions: [],
    locale: "en-US",
    timezoneId: "UTC",
    actionTimeout: 10_000,
    // The dev client's first cold load (Vite dep optimization + the eager art
    // pack) can outrun a 30s window; explicit state waits do the real gating.
    navigationTimeout: 60_000,
  },
  webServer: [
    {
      // Wipe the throwaway e2e database first so every run starts from a
      // known account state (no cross-run courier/zone bleed).
      command: 'node reset-e2e-db.mjs && node --import tsx ../../../../server/src/index.ts',
      cwd: "tests/e2e/env/server",
      url: "http://127.0.0.1:3004/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "development" },
    },
    {
      command: "node node_modules/vite/bin/vite.js",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PAWS_GAME_SERVER: process.env.PAWS_GAME_SERVER ?? "http://127.0.0.1:3004",
      },
    },
  ],
});
