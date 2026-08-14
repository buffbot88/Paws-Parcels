import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findNewestCapturePair } from "../../scripts/visual-latest.ts";

async function captureDirectory() {
  return mkdtemp(join(tmpdir(), "paws-visual-latest-"));
}

async function touchPair(directory: string, stamp: string) {
  await writeFile(join(directory, `paws-visual-${stamp}.png`), "png");
  await writeFile(join(directory, `paws-visual-${stamp}.json`), "{}");
}

describe("visual-latest capture discovery", () => {
  it("selects the newest complete pair and ignores incomplete captures", async () => {
    const directory = await captureDirectory();
    await touchPair(directory, "20260810120000");
    await writeFile(join(directory, "paws-visual-20260810130000.png"), "png");

    const pair = findNewestCapturePair([directory]);

    expect(pair).toEqual({
      stamp: "20260810120000",
      directory,
      png: join(directory, "paws-visual-20260810120000.png"),
      json: join(directory, "paws-visual-20260810120000.json"),
    });
  });

  it("does not combine matching timestamps from different directories", async () => {
    const first = await captureDirectory();
    const second = await captureDirectory();
    await writeFile(join(first, "paws-visual-20260810140000.png"), "png");
    await writeFile(join(second, "paws-visual-20260810140000.json"), "{}");

    expect(findNewestCapturePair([first, second])).toBeNull();
  });

  it("returns null when no capture files exist", async () => {
    const directory = await captureDirectory();

    expect(findNewestCapturePair([directory])).toBeNull();
  });
});
