/**
 * Fresh e2e database per run.
 *
 * The dev-login harness always authenticates the same local account
 * (`dev_courier`), so anything a previous run persisted — the last-played
 * courier, its zone, its position — would otherwise leak into the next run and
 * make results order-dependent. Deleting this directory before the isolated
 * server boots guarantees a known starting state.
 *
 * Only ever touches tests/e2e/env/server/data (never the developer's own
 * persist/ database).
 */
import { rmSync } from "node:fs";

rmSync(new URL("./data/", import.meta.url), { recursive: true, force: true });
