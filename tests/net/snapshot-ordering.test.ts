import { describe, expect, it } from "vitest";
import {
  isNewerSnapshotSequence,
  isSnapshotForZone,
} from "../../src/net/snapshotOrdering.ts";

describe("isNewerSnapshotSequence", () => {
  it("accepts a newer positive sequence", () => {
    expect(isNewerSnapshotSequence(8, 7)).toBe(true);
  });

  it("rejects duplicate and stale sequences", () => {
    expect(isNewerSnapshotSequence(7, 7)).toBe(false);
    expect(isNewerSnapshotSequence(6, 7)).toBe(false);
  });

  it("accepts legacy snapshots without sequence metadata only without prior authority", () => {
    expect(isNewerSnapshotSequence(0, 0)).toBe(true);
    expect(isNewerSnapshotSequence(0, 99)).toBe(true);
  });
});

describe("isSnapshotForZone", () => {
  it("rejects a late frame from the previous zone", () => {
    expect(isSnapshotForZone("zone-happy-valley", "zone-clover-village")).toBe(false);
  });

  it("accepts only the expected zone once a target is known", () => {
    expect(isSnapshotForZone("zone-clover-village", "zone-clover-village")).toBe(true);
    expect(isSnapshotForZone(undefined, "zone-clover-village")).toBe(false);
  });

  it("accepts zone-less legacy frames before a target zone is selected", () => {
    expect(isSnapshotForZone(undefined, null)).toBe(true);
  });
});
