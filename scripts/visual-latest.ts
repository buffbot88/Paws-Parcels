import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CAPTURE_NAME = /^paws-visual-([A-Za-z0-9_-]+)\.(png|json)$/;
type CaptureExtension = "png" | "json";

export interface VisualCapturePair {
  stamp: string;
  directory: string;
  png: string;
  json: string;
}

function isApprovedDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Return the newest complete pair, never combining files from different directories. */
export function findNewestCapturePair(directories: string[]): VisualCapturePair | null {
  const candidates = new Map<string, { stamp: string; directory: string; png?: string; json?: string }>();

  for (const directory of directories) {
    if (!existsSync(directory) || !isApprovedDirectory(directory)) continue;

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = CAPTURE_NAME.exec(entry.name);
      if (!match) continue;
      const [, stamp, extension] = match;
      const key = `${directory}\u0000${stamp}`;
      const candidate = candidates.get(key) ?? { stamp, directory };
      candidate[extension as CaptureExtension] = join(directory, entry.name);
      candidates.set(key, candidate);
    }
  }

  return [...candidates.values()]
    .filter((candidate): candidate is VisualCapturePair => Boolean(candidate.png && candidate.json))
    .sort((left, right) => {
      const timestampOrder = right.stamp.localeCompare(left.stamp);
      if (timestampOrder !== 0) return timestampOrder;
      return right.directory.localeCompare(left.directory);
    })[0] ?? null;
}
