// Generates server_config.json for PaaS deploys (Render/Railway/Fly) from
// environment variables, merging in the committed example for everything else.
//
// Usage (Render build step, with JWT_SECRET + optional PUBLIC_URL set):
//   node scripts/write-server-config.mjs
//
// Env vars:
//   JWT_SECRET        (required, >= 32 chars) — replaces the placeholder
//   PUBLIC_URL        base URL of the deployed site, e.g. https://app.onrender.com
//                     (falls back to Render's auto-provided RENDER_EXTERNAL_URL)
//   CORS_ORIGINS      optional comma-separated list overriding corsAllowedOrigins
//   OIDC_REDIRECT_URI optional; defaults to PUBLIC_URL/oidc-callback.html
//   DB_FILE           optional; defaults to the committed SQLite file
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const examplePath = resolve(process.cwd(), "server_config.example.json");
const outPath = resolve(process.cwd(), "server_config.json");

let example;
try {
  example = JSON.parse(readFileSync(examplePath, "utf-8"));
} catch (err) {
  console.error(`Could not read ${examplePath}: ${String(err)}`);
  process.exit(1);
}

const jwtSecret = process.env.JWT_SECRET ?? "";
if (jwtSecret.length < 32) {
  console.error(
    "Missing required env var JWT_SECRET (must be at least 32 characters).",
  );
  process.exit(1);
}

const publicUrl = (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? "")
  .trim()
  .replace(/\/+$/, "");
if (publicUrl === "") {
  console.warn(
    "WARNING: no PUBLIC_URL/RENDER_EXTERNAL_URL — CORS + OIDC redirect stay at localhost defaults.",
  );
}

const serverRaw = example.server ?? {};
const authRaw = example.auth ?? {};
const oidcRaw = example.oidc ?? {};

const config = {
  server: {
    ...serverRaw,
    corsAllowedOrigins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [...(serverRaw.corsAllowedOrigins ?? []), publicUrl].filter(Boolean),
  },
  db: {
    ...(example.db ?? {}),
    file: process.env.DB_FILE ?? example.db?.file ?? "server/data/paws-and-parcels.sqlite",
  },
  auth: {
    ...authRaw,
    jwtSecret,
  },
  oidc: {
    ...oidcRaw,
    redirectUri:
      process.env.OIDC_REDIRECT_URI ?? (publicUrl ? `${publicUrl}/oidc-callback.html` : oidcRaw.redirectUri),
  },
};

writeFileSync(outPath, JSON.stringify(config, null, 2) + "\n");
console.log(`Wrote ${outPath} from environment.`);
