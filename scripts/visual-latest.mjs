#!/usr/bin/env node
/**
 * Review the newest complete live scene capture pair.
 *
 * Usage:
 *   npm run visual:latest
 *
 * Captures are searched in the project root, tmp/, reports/, and the server's
 * Admin capture directory. An incomplete PNG/JSON pair is ignored so an older
 * complete capture can still be reviewed.
 */
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { findNewestCapturePair } from "./visual-latest.ts";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function captureDirectories() {
  return [
    PROJECT_ROOT,
    join(PROJECT_ROOT, "tmp"),
    join(PROJECT_ROOT, "reports"),
    join(PROJECT_ROOT, "server/data/visual-captures"),
  ]
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .filter((path) => existsSync(path));
}

function describePath(path) {
  return relative(PROJECT_ROOT, path) || path;
}

function reserveArchivePath(stamp) {
  const reportsDirectory = join(PROJECT_ROOT, "reports");
  mkdirSync(reportsDirectory, { recursive: true });
  const base = `visual-review-${stamp}`;
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const path = join(
      reportsDirectory,
      `${base}${suffix === 0 ? "" : `-${suffix}`}.json`,
    );
    try {
      const descriptor = openSync(path, "wx");
      closeSync(descriptor);
      return path;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not reserve a unique Visual Director archive path.");
}

function main() {
  const pair = findNewestCapturePair(captureDirectories());
  if (!pair) {
    throw new Error(
      "No complete paws-visual PNG/JSON pair found in the project root, tmp/, reports/, " +
      "or server/data/visual-captures/. Use Ctrl+Shift+V in-game first.",
    );
  }

  console.log(
    `[visual-latest] reviewing ${describePath(pair.png)} + ${describePath(pair.json)}`,
  );
  const archivePath = reserveArchivePath(pair.stamp);
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(PROJECT_ROOT, "scripts/visual-director.mjs"),
      "--image",
      pair.png,
      "--metadata",
      pair.json,
      "--out",
      archivePath,
    ],
    { cwd: PROJECT_ROOT, stdio: "inherit" },
  );

  if (result.error) {
    unlinkSync(archivePath);
    throw result.error;
  }
  if (result.status !== 0) {
    unlinkSync(archivePath);
    process.exitCode = result.status ?? 1;
  } else {
    console.log(`[visual-latest] archived report as ${describePath(archivePath)}`);
  }
}

if (process.argv[1]?.endsWith("visual-latest.mjs")) {
  try {
    main();
  } catch (error) {
    console.error(`[visual-latest] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
