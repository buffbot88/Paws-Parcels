import { describe, expect, it } from "vitest";
import {
  buildVisualHistory,
  parseVisualDirectorReport,
  visualIssueKey,
  type VisualHistorySource,
} from "../../scripts/visual-history.ts";
import type { VisualDirectorReport } from "../../server/src/ai/VisualDirector.ts";

const generatedAt = new Date("2026-08-10T15:00:00.000Z");

function report(
  reviewedAt: string,
  overall: number,
  issues: VisualDirectorReport["issues"],
): VisualDirectorReport {
  return {
    status: "ok",
    overall,
    summary: "review",
    issues,
    reviewedAt,
  };
}

function source(path: string, value: VisualDirectorReport): VisualHistorySource {
  return { path, report: value };
}

describe("Visual history", () => {
  it("groups the same category and target across reports and tracks its trend", () => {
    const history = buildVisualHistory(
      [
        source(
          "reports/visual-review-1.json",
          report("2026-08-08T10:00:00.000Z", 2, [
            {
              category: "depth",
              severity: "high",
              target: "tree-1",
              evidence: "foreground tree clips the courier",
              confidence: 0.8,
            },
          ]),
        ),
        source(
          "reports/visual-review-2.json",
          report("2026-08-09T10:00:00.000Z", 3, [
            {
              category: "depth",
              severity: "medium",
              target: "TREE-1",
              evidence: "overlap is reduced",
              confidence: 0.6,
              recommendation: {
                type: "depth-offset",
                target: "tree-1",
                value: 0.05,
                rationale: "Lift the foreground tree slightly.",
              },
            },
          ]),
        ),
        source(
          "reports/visual-review-3.json",
          report("2026-08-10T10:00:00.000Z", 4, [
            {
              category: "palette",
              severity: "low",
              target: "ground",
              evidence: "path contrast is soft",
              confidence: 0.7,
            },
          ]),
        ),
      ],
      generatedAt,
    );

    expect(history.status).toBe("ok");
    expect(history.reportCount).toBe(3);
    expect(history.overallAverage).toBe(3);
    expect(history.overallTrend).toBe("improving");
    expect(history.recurringIssues).toEqual([
      {
        key: "depth:tree-1",
        category: "depth",
        target: "TREE-1",
        occurrences: 2,
        reportCount: 2,
        firstSeen: "2026-08-08T10:00:00.000Z",
        lastSeen: "2026-08-09T10:00:00.000Z",
        latestSeverity: "medium",
        maxSeverity: "high",
        averageConfidence: 0.7,
        latestEvidence: "overlap is reduced",
        latestRecommendation: {
          type: "depth-offset",
          target: "tree-1",
          value: 0.05,
          rationale: "Lift the foreground tree slightly.",
        },
      },
    ]);
  });

  it("requires two valid reports for a history and records unavailable reports", () => {
    const history = buildVisualHistory([
      source("tmp/visual-review.json", {
        status: "unavailable",
        overall: 0,
        summary: "offline",
        issues: [],
        reviewedAt: "2026-08-10T10:00:00.000Z",
      }),
    ]);

    expect(history.status).toBe("insufficient-data");
    expect(history.okReportCount).toBe(0);
    expect(history.unavailableReportCount).toBe(1);
    expect(history.overallAverage).toBeNull();
    expect(history.overallTrend).toBe("unknown");
  });

  it("does not count repeated entries in one report as recurring reviews", () => {
    const repeated = report("2026-08-10T10:00:00.000Z", 3, [
      {
        category: "ui",
        severity: "low",
        target: "minimap",
        evidence: "too close",
        confidence: 0.5,
      },
      {
        category: "ui",
        severity: "low",
        target: "minimap",
        evidence: "still too close",
        confidence: 0.5,
      },
    ]);

    const history = buildVisualHistory([source("reports/one.json", repeated)]);

    expect(history.recurringIssues).toEqual([]);
    expect(history.reportCount).toBe(1);
    expect(history.status).toBe("insufficient-data");
  });

  it("rejects malformed report envelopes and issue records", () => {
    expect(parseVisualDirectorReport({ status: "ok", overall: 3 })).toBeNull();
    expect(
      parseVisualDirectorReport({
        status: "ok",
        overall: 3,
        summary: "bad issue",
        issues: [{ category: "depth", target: "tree", confidence: 2 }],
        reviewedAt: "2026-08-10T10:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      parseVisualDirectorReport({
        status: "ok",
        overall: 8,
        summary: "bad score",
        issues: [],
        reviewedAt: "2026-08-10T10:00:00.000Z",
      }),
    ).toBeNull();
    expect(visualIssueKey({ category: "Scale" as never, target: " Post Office " })).toBe("Scale:post office");
  });
});
