import type {
  VisualDirectorReport,
  VisualIssue,
  VisualRecommendation,
  VisualSeverity,
} from "../server/src/ai/VisualDirector.ts";

export interface VisualHistorySource {
  path: string;
  report: VisualDirectorReport;
}

export interface RecurringVisualIssue {
  key: string;
  category: VisualIssue["category"];
  target: string;
  occurrences: number;
  reportCount: number;
  firstSeen: string;
  lastSeen: string;
  latestSeverity: VisualSeverity;
  maxSeverity: VisualSeverity;
  averageConfidence: number;
  latestEvidence: string;
  latestRecommendation?: VisualRecommendation;
}

export interface VisualHistoryReport {
  status: "ok" | "insufficient-data";
  generatedAt: string;
  reportCount: number;
  okReportCount: number;
  unavailableReportCount: number;
  invalidReportCount: number;
  skippedReportCount: number;
  overallAverage: number | null;
  overallTrend: "improving" | "declining" | "stable" | "unknown";
  recurringIssues: RecurringVisualIssue[];
  sources: Array<{
    path: string;
    reviewedAt: string;
    status: VisualDirectorReport["status"];
    overall: number;
    issueCount: number;
  }>;
}

const SEVERITY_WEIGHT: Record<VisualSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/** Build a stable grouping key from the model-controlled issue identity fields. */
export function visualIssueKey(issue: Pick<VisualIssue, "category" | "target">): string {
  return `${issue.category}:${issue.target.trim().toLocaleLowerCase()}`;
}

/** Compare reports in review order and track issues that recur across reviews. */
export function buildVisualHistory(
  sources: VisualHistorySource[],
  generatedAt = new Date(),
  skippedReportCount = 0,
): VisualHistoryReport {
  const ordered = [...sources].sort((left, right) => {
    const timeOrder = Date.parse(left.report.reviewedAt) - Date.parse(right.report.reviewedAt);
    if (Number.isFinite(timeOrder) && timeOrder !== 0) return timeOrder;
    return left.path.localeCompare(right.path);
  });
  const validSources = ordered.filter((source) => isReport(source.report));
  const okSources = validSources.filter((source) => source.report.status === "ok");
  const issueGroups = new Map<string, {
    issue: VisualIssue;
    firstSeen: string;
    lastSeen: string;
    reportPaths: Set<string>;
  }>();

  for (const source of okSources) {
    const seenInReport = new Set<string>();
    for (const issue of source.report.issues) {
      const key = visualIssueKey(issue);
      // A report with repeated model entries counts once per review.
      if (seenInReport.has(key)) continue;
      seenInReport.add(key);
      const existing = issueGroups.get(key);
      if (existing === undefined) {
        issueGroups.set(key, {
          issue,
          firstSeen: source.report.reviewedAt,
          lastSeen: source.report.reviewedAt,
          reportPaths: new Set([source.path]),
        });
      } else {
        existing.issue = issue;
        existing.lastSeen = source.report.reviewedAt;
        existing.reportPaths.add(source.path);
      }
    }
  }

  const recurringIssues = [...issueGroups.entries()]
    .map(([key, group]) => {
      const matchingIssues = okSources.flatMap((source) => {
        const issue = [...source.report.issues]
          .reverse()
          .find((candidate) => visualIssueKey(candidate) === key);
        return issue === undefined ? [] : [issue];
      });
      const latest = group.issue;
      const maxSeverity = matchingIssues.reduce<VisualSeverity>(
        (max, issue) => (SEVERITY_WEIGHT[issue.severity] > SEVERITY_WEIGHT[max] ? issue.severity : max),
        "low",
      );
      return {
        key,
        category: latest.category,
        target: latest.target,
        occurrences: matchingIssues.length,
        reportCount: group.reportPaths.size,
        firstSeen: group.firstSeen,
        lastSeen: group.lastSeen,
        latestSeverity: latest.severity,
        maxSeverity,
        averageConfidence: round(
          matchingIssues.reduce((sum, issue) => sum + issue.confidence, 0) / matchingIssues.length,
        ),
        latestEvidence: latest.evidence,
        ...(latest.recommendation === undefined ? {} : { latestRecommendation: latest.recommendation }),
      } satisfies RecurringVisualIssue;
    })
    .filter((issue) => issue.reportCount >= 2)
    .sort((left, right) => {
      if (right.reportCount !== left.reportCount) return right.reportCount - left.reportCount;
      if (SEVERITY_WEIGHT[right.maxSeverity] !== SEVERITY_WEIGHT[left.maxSeverity]) {
        return SEVERITY_WEIGHT[right.maxSeverity] - SEVERITY_WEIGHT[left.maxSeverity];
      }
      return right.lastSeen.localeCompare(left.lastSeen);
    });

  const overallValues = okSources.map((source) => source.report.overall);
  return {
    status: okSources.length >= 2 ? "ok" : "insufficient-data",
    generatedAt: generatedAt.toISOString(),
    reportCount: validSources.length,
    okReportCount: okSources.length,
    unavailableReportCount: validSources.filter((source) => source.report.status === "unavailable").length,
    invalidReportCount: validSources.filter((source) => source.report.status === "invalid").length,
    skippedReportCount,
    overallAverage: overallValues.length === 0 ? null : round(average(overallValues)),
    overallTrend: trend(overallValues),
    recurringIssues,
    sources: validSources.map((source) => ({
      path: source.path,
      reviewedAt: source.report.reviewedAt,
      status: source.report.status,
      overall: source.report.overall,
      issueCount: source.report.issues.length,
    })),
  };
}

export function parseVisualDirectorReport(value: unknown): VisualDirectorReport | null {
  if (!isRecord(value)) return null;
  if (value.status !== "ok" && value.status !== "unavailable" && value.status !== "invalid") return null;
  if (
    typeof value.overall !== "number" ||
    !Number.isFinite(value.overall) ||
    value.overall < 0 ||
    value.overall > 5 ||
    (value.status === "ok" && value.overall < 1)
  ) return null;
  if (typeof value.summary !== "string" || !Array.isArray(value.issues)) return null;
  if (typeof value.reviewedAt !== "string" || !Number.isFinite(Date.parse(value.reviewedAt))) return null;
  if (!value.issues.every(isVisualIssue)) return null;
  return value as unknown as VisualDirectorReport;
}

function isVisualIssue(value: unknown): value is VisualIssue {
  if (!isRecord(value)) return false;
  const categories: readonly VisualIssue["category"][] = [
    "composition",
    "depth",
    "scale",
    "palette",
    "asset-placement",
    "ui",
    "readability",
    "performance",
  ];
  const severities: readonly VisualSeverity[] = ["low", "medium", "high"];
  if (
    !categories.includes(value.category as VisualIssue["category"]) ||
    !severities.includes(value.severity as VisualSeverity) ||
    typeof value.target !== "string" ||
    typeof value.evidence !== "string" ||
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    return false;
  }
  if (value.recommendation === undefined) return true;
  return isVisualRecommendation(value.recommendation);
}

function isVisualRecommendation(value: unknown): value is VisualRecommendation {
  if (!isRecord(value)) return false;
  const types: readonly VisualRecommendation["type"][] = [
    "camera-zoom",
    "set-piece-scale",
    "set-piece-offset",
    "depth-offset",
    "palette-contrast",
    "palette-noise",
    "npc-scale",
    "ui-spacing",
  ];
  if (
    !types.includes(value.type as VisualRecommendation["type"]) ||
    typeof value.target !== "string" ||
    typeof value.value !== "number" ||
    !Number.isFinite(value.value) ||
    (value.axis !== undefined && value.axis !== "x" && value.axis !== "y") ||
    (value.rationale !== undefined && typeof value.rationale !== "string")
  ) {
    return false;
  }
  const bounds: Record<VisualRecommendation["type"], [number, number]> = {
    "camera-zoom": [0.6, 1.2],
    "set-piece-scale": [0.1, 1.2],
    "set-piece-offset": [-96, 96],
    "depth-offset": [-0.2, 0.2],
    "palette-contrast": [-0.5, 0.5],
    "palette-noise": [-0.5, 0.5],
    "npc-scale": [0.1, 1.2],
    "ui-spacing": [-64, 64],
  };
  const [min, max] = bounds[value.type as VisualRecommendation["type"]];
  return value.value >= min && value.value <= max;
}

function isReport(report: VisualDirectorReport): boolean {
  return parseVisualDirectorReport(report) !== null;
}

function trend(values: number[]): VisualHistoryReport["overallTrend"] {
  if (values.length < 2) return "unknown";
  const midpoint = Math.floor(values.length / 2);
  const first = average(values.slice(0, midpoint));
  const last = average(values.slice(midpoint));
  if (Math.abs(last - first) < 0.25) return "stable";
  // Higher Visual Director scores are better.
  return last > first ? "improving" : "declining";
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
