import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findClientEntry,
  writeClientVersion,
} from "../../scripts/write-client-version.mjs";

describe("findClientEntry", () => {
  it("extracts the exact static hashed entry from Vite HTML", () => {
    expect(
      findClientEntry(
        '<script type="module" src="./static/index-AbC_123.js"></script>',
      ),
    ).toBe("static/index-AbC_123.js");
  });

  it("accepts an entry in the root of the built document", () => {
    expect(findClientEntry('<script src="index-AbC123.js">')).toBe(
      "index-AbC123.js",
    );
  });

  it("returns null when the document has no safe hashed entry", () => {
    expect(findClientEntry('<script src="./static/main.js"></script>')).toBeNull();
    expect(findClientEntry("<!doctype html>")).toBeNull();
  });
});

describe("writeClientVersion", () => {
  it("writes the exact entry referenced by a temporary build", () => {
    const distDir = mkdtempSync(join(tmpdir(), "pnp-client-version-"));
    try {
      writeFileSync(
        join(distDir, "index.html"),
        '<script type="module" src="./static/index-Fresh_42.js"></script>',
      );
      expect(writeClientVersion(distDir)).toBe("static/index-Fresh_42.js");
      expect(readFileSync(join(distDir, "client-version.txt"), "utf8")).toBe(
        "static/index-Fresh_42.js\n",
      );
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});
