import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Extract Vite's hashed JavaScript entry from a built index document. */
export function findClientEntry(index) {
  const match = index.match(
    /<script[^>]+src="(?:\.\/)?((?:[^"/]+\/)?index-[A-Za-z0-9_-]+\.js)"/i,
  );
  return match?.[1] ?? null;
}

export function writeClientVersion(distDir = resolve(process.cwd(), "dist")) {
  const indexPath = resolve(distDir, "index.html");
  const index = readFileSync(indexPath, "utf8");
  const entry = findClientEntry(index);

  if (entry === null) {
    throw new Error(`Could not find the hashed client entry in ${indexPath}.`);
  }

  writeFileSync(resolve(distDir, "client-version.txt"), `${entry}\n`);
  return entry;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const entry = writeClientVersion();
  console.log(`Wrote dist/client-version.txt (${entry}).`);
}
