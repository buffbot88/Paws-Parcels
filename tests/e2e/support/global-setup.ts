/**
 * Warm the Vite dev server before the suite runs.
 *
 * Vite re-optimizes dependencies (and re-transforms the entry graph) after a
 * lockfile/config change; the first page load of a cold server can take longer
 * than a test's navigation budget, which produced spurious `page.goto`
 * timeouts on the first spec. Fetching the entry once here makes the first
 * test deterministic.
 */
import { request } from "@playwright/test";

const WARM_PATHS = ["/", "/src/main.ts"];
const BASE_URL = "http://localhost:5173";

export default async function globalSetup(): Promise<void> {
  const context = await request.newContext({ baseURL: BASE_URL });
  try {
    for (const path of WARM_PATHS) {
      let lastError = "";
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          const res = await context.get(path, { timeout: 60_000, failOnStatusCode: false });
          if (res.ok()) {
            lastError = "";
            break;
          }
          lastError = `HTTP ${res.status()}`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      if (lastError !== "") {
        throw new Error(`Vite warm-up failed for ${path}: ${lastError}`);
      }
    }
  } finally {
    await context.dispose();
  }
}
