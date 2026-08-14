import { describe, expect, it, vi } from "vitest";
import {
  normalizeVisualReport,
  reviewVisualScene,
  visualDirectorSystemPrompt,
  type VisualSceneMetadata,
} from "../../server/src/ai/VisualDirector.ts";
import type { GameBrain } from "../../server/src/ai/GameBrain.ts";

const now = new Date("2026-08-10T12:00:00.000Z");
const metadata: VisualSceneMetadata = {
  zoneId: "zone-clover-village",
  map: { width: 75, height: 75 },
  camera: { zoom: 0.8 },
};

function fakeBrain(result: unknown): GameBrain {
  return { completeJson: vi.fn(async () => result) } as unknown as GameBrain;
}

describe("VisualDirector", () => {
  it("requires the strict art-direction contract in its prompt", () => {
    const prompt = visualDirectorSystemPrompt();
    expect(prompt).toContain("JSON ONLY");
    expect(prompt).toContain("Never recommend changing collision");
    expect(prompt).toContain("camera-zoom");
  });

  it("normalizes valid issues and preserves bounded recommendations", () => {
    const report = normalizeVisualReport(
      {
        overall: 3,
        summary: "The village reads well but the post office dominates.",
        issues: [
          {
            category: "scale",
            severity: "medium",
            target: "post-office",
            evidence: "The roof overwhelms the neighboring buildings.",
            confidence: 0.86,
            recommendation: {
              type: "set-piece-scale",
              target: "post-office",
              value: 0.44,
              rationale: "Bring the silhouette closer to the cottage scale.",
            },
          },
        ],
      },
      now,
    );
    expect(report).toEqual({
      status: "ok",
      overall: 3,
      summary: "The village reads well but the post office dominates.",
      issues: [
        {
          category: "scale",
          severity: "medium",
          target: "post-office",
          evidence: "The roof overwhelms the neighboring buildings.",
          confidence: 0.86,
          recommendation: {
            type: "set-piece-scale",
            target: "post-office",
            value: 0.44,
            rationale: "Bring the silhouette closer to the cottage scale.",
          },
        },
      ],
      reviewedAt: now.toISOString(),
    });
  });

  it("rejects unsafe recommendation values instead of returning a patch", () => {
    const report = normalizeVisualReport(
      {
        overall: 5,
        summary: "unsafe",
        issues: [
          {
            category: "composition",
            severity: "high",
            target: "global",
            evidence: "large change",
            confidence: 1,
            recommendation: {
              type: "camera-zoom",
              target: "global",
              value: 4,
            },
          },
        ],
      },
      now,
    );
    expect(report?.status).toBe("ok");
    expect(report?.issues).toHaveLength(1);
    expect(report?.issues[0].recommendation).toBeUndefined();
  });

  it("coerces a numeric-string score and tolerates a missing issue list", () => {
    const report = normalizeVisualReport({
      overall: "3",
      summary: "The village reads clearly.",
    }, now);
    expect(report).toMatchObject({
      status: "ok",
      overall: 3,
      summary: "The village reads clearly.",
      issues: [],
    });
  });

  it("drops malformed issues but keeps the valid portion of a report", () => {
    const report = normalizeVisualReport(
      {
        overall: 4,
        summary: "Mostly readable.",
        issues: [
          { category: "unknown", severity: "high", target: "x", evidence: "x", confidence: 1 },
          { category: "depth", severity: "low", target: "tree-1", evidence: "clear overlap", confidence: 0.7 },
        ],
      },
      now,
    );
    expect(report?.issues).toHaveLength(1);
    expect(report?.issues[0].target).toBe("tree-1");
  });

  it("returns an unavailable report when the local model cannot answer", async () => {
    const report = await reviewVisualScene(
      fakeBrain(null),
      { imageDataUrl: "data:image/png;base64,placeholder", metadata },
      now,
    );
    expect(report.status).toBe("unavailable");
    expect(report.issues).toEqual([]);
  });
});
