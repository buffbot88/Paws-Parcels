#!/usr/bin/env node
/**
 * Compare archived Visual Director reports without calling the model.
 *
 * Usage:
 *   npm run visual:history
 *
 * Reports are read from reports/ and tmp/ and the consolidated result is
 * written to reports/visual-history.json. `visual:latest` archives each review
 * under reports/visual-review-<timestamp>.json. Malformed JSON is skipped safely.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVisualHistory, parseVisualDirectorReport } from "./visual-history.ts";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUTPUT_PATH = resolve(PROJECT_ROOT, "reports/visual-history.json");
const REPORT_NAME = /^visual-review[^/]*\.json$/;

function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function reportDirectories() {
  return [join(PROJECT_ROOT, "reports"), join(PROJECT_ROOT, "tmp")]
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .filter(isDirectory);
}

function reportPaths() {
  const paths = [];
  for (const directory of reportDirectories()) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !REPORT_NAME.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (path === OUTPUT_PATH) continue;
      paths.push(path);
    }
  }
  return paths.sort();
}

function readReports() {
  const sources = [];
  let skipped = 0;
  for (const path of reportPaths()) {
    try {
      const parsed = parseVisualDirectorReport(JSON.parse(readFileSync(path, "utf8")));
      if (parsed === null) {
        skipped += 1;
        console.warn(`[visual-history] skipped invalid report: ${relative(PROJECT_ROOT, path)}`);
        continue;
      }
      sources.push({ path: relative(PROJECT_ROOT, path), report: parsed });
    } catch (error) {
      skipped += 1;
      console.warn(`[visual-history] skipped unreadable report ${relative(PROJECT_ROOT, path)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { sources, skipped };
}

function safeOutputPath() {
  const parent = dirname(OUTPUT_PATH);
  if (existsSync(parent) && realpathSync(parent) !== parent) {
    throw new Error("History output directory may not be a symlink.");
  }
  if (existsSync(OUTPUT_PATH) && lstatSync(OUTPUT_PATH).isSymbolicLink()) {
    throw new Error("History output may not replace a symlink.");
  }
  return OUTPUT_PATH;
}

function main() {
  const outputPath = safeOutputPath();
  const { sources, skipped } = readReports();
  const history = buildVisualHistory(sources, new Date(), skipped);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(history, null, 2)}\n`);
  console.log(
    `[visual-history] compared ${history.reportCount} reports; ` +
      `${history.recurringIssues.length} recurring issues; ` +
      `wrote ${relative(PROJECT_ROOT, OUTPUT_PATH)}`,
  );
}

if (process.argv[1]?.endsWith("visual-history.mjs")) {
  try {
    main();
  } catch (error) {
    console.error(`[visual-history] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
