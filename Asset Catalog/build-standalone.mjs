#!/usr/bin/env node
/**
 * Builds the full deploy/asset-catalog/ directory:
 *   - api/assets.js    (machine-readable, .js to bypass Apache .json block)
 *   - api/assets.json  (same data, plain JSON for non-browser consumers)
 *   - api/packs.json   (pack summaries)
 *   - contact-sheets/  (visual audit pages per pack)
 *   - index.html       (standalone with all data embedded)
 *
 * FTP layout:
 *   public_html/
 *     asset-catalog/          ← everything in deploy/asset-catalog/
 *     reference/assets/       ← the asset archive
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const deployDir = join(root, "deploy", "asset-catalog");

async function build() {
  console.log("Building Asset Catalog for deployment...");

  // Generate API files + contact sheets
  console.log("\n--- Generating API + contact sheets ---");
  const { execSync } = await import("node:child_process");
  execSync(`node "${join(__dirname, "generate-api.mjs")}"`, { stdio: "inherit" });

  // Build standalone index.html with embedded data
  console.log("\n--- Building standalone index.html ---");
  // Embed the full browse payload (api/assets.js) so the homepage can browse/search;
  // api/assets.json is a summary-only object and has no per-asset records.
  const assetsJs = await readFile(join(deployDir, "api", "assets.js"), "utf8");
  const assetsJson = JSON.parse(assetsJs.match(/window\.ASSETS_DATA\s*=\s*(\{.*\})\s*;?\s*$/s)[1]);

  const html = await readFile(join(__dirname, "index.html"), "utf8");
  const css = await readFile(join(__dirname, "styles.css"), "utf8");
  let js = await readFile(join(__dirname, "catalog.js"), "utf8");

  // Embed data directly so no fetch is needed
  const dataScript = `<script>window.INVENTORY_DATA = ${JSON.stringify(assetsJson)};</script>`;
  js = js.replace(
    'const INVENTORY_URL = "api/assets.js";',
    'const INVENTORY_URL = "api/assets.js"; /* standalone: data embedded below */'
  );

  let output = html;
  output = output.replace('<link rel="stylesheet" href="./styles.css" />', `<style>\n${css}\n</style>`);
  output = output.replace(
    '<script type="module" src="./catalog.js"></script>',
    `${dataScript}\n<script type="module">\n${js}\n</script>`
  );

  await writeFile(join(deployDir, "index.html"), output, "utf8");

  const stats = await readFile(join(deployDir, "index.html"));
  const fileCount = execSync(`find "${deployDir}" -type f | wc -l`, { encoding: "utf8" }).trim();

  console.log(`\n=== Deploy ready ===`);
  console.log(`  deploy/asset-catalog/index.html  (${(stats.length / 1024).toFixed(0)} KB, standalone)`);
  console.log(`  deploy/asset-catalog/api/         (assets.js + assets.json + packs.json)`);
  console.log(`  deploy/asset-catalog/contact-sheets/  (${fileCount} total files)`);
  console.log(`\nFTP everything in deploy/asset-catalog/ alongside reference/assets/`);
}

build().catch((error) => { console.error(error); process.exit(1); });
