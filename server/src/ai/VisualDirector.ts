/** Strict visual review contracts for the 450M VL art-direction loop. */
import type { BrainUserPart, GameBrain } from "./GameBrain.ts";
import type { VisualSceneMetadata } from "../../../src/types/VisualSceneMetadata.ts";
export type { VisualSceneMetadata } from "../../../src/types/VisualSceneMetadata.ts";

export type VisualIssueCategory =
  | "composition"
  | "depth"
  | "scale"
  | "palette"
  | "asset-placement"
  | "ui"
  | "readability"
  | "performance";

export type VisualSeverity = "low" | "medium" | "high";

export type VisualRecommendationType =
  | "camera-zoom"
  | "set-piece-scale"
  | "set-piece-offset"
  | "depth-offset"
  | "palette-contrast"
  | "palette-noise"
  | "npc-scale"
  | "ui-spacing";

export interface VisualRecommendation {
  type: VisualRecommendationType;
  target: string;
  value: number;
  axis?: "x" | "y";
  rationale?: string;
}

export interface VisualIssue {
  category: VisualIssueCategory;
  severity: VisualSeverity;
  target: string;
  evidence: string;
  confidence: number;
  recommendation?: VisualRecommendation;
}

export interface VisualDirectorReport {
  status: "ok" | "unavailable" | "invalid";
  overall: number;
  summary: string;
  issues: VisualIssue[];
  reviewedAt: string;
}

export interface VisualReviewRequest {
  imageDataUrl: string;
  metadata: VisualSceneMetadata;
}

const ISSUE_CATEGORIES = new Set<VisualIssueCategory>([
  "composition",
  "depth",
  "scale",
  "palette",
  "asset-placement",
  "ui",
  "readability",
  "performance",
]);
const SEVERITIES = new Set<VisualSeverity>(["low", "medium", "high"]);
const RECOMMENDATION_TYPES = new Set<VisualRecommendationType>([
  "camera-zoom",
  "set-piece-scale",
  "set-piece-offset",
  "depth-offset",
  "palette-contrast",
  "palette-noise",
  "npc-scale",
  "ui-spacing",
]);

/** Prompt used for one bounded screenshot + metadata review. */
export function visualDirectorSystemPrompt(): string {
  return [
    "You are the visual director for Paws & Parcels, a polished cozy 2.5D animal MMORPG.",
    "Review the attached game view and the structured scene metadata.",
    "Judge professional composition, readable Y-depth ordering, consistent world scale,",
    "storybook palette harmony, asset placement, NPC readability, and UI composition.",
    "Be concrete and conservative: recommend only small presentation-level changes.",
    "Never recommend changing collision, map topology, quests, server authority, or assets.",
    "Return JSON ONLY with this shape:",
    'Return an object like {"overall":3,"summary":"short string","issues":[{"category":"composition|depth|scale|palette|asset-placement|ui|readability|performance","severity":"low","target":"id or global","evidence":"short visible evidence","confidence":0.8,"recommendation":{"type":"camera-zoom|set-piece-scale|set-piece-offset|depth-offset|palette-contrast|palette-noise|npc-scale|ui-spacing","target":"id or global","value":0.8}}]}. The recommendation object is optional.',
    "Omit recommendation when no bounded tuning is justified. Keep issues to the five most important.",
  ].join(" ");
}

/** Build the text portion of the VL request from trusted scene metadata. */
export function visualDirectorUserText(metadata: VisualSceneMetadata): string {
  return [
    "Scene metadata:",
    JSON.stringify(metadata),
    "Evaluate only what is visible or supported by this metadata. Do not invent missing assets.",
  ].join("\n");
}

/** Ask the existing GameBrain for one normalized visual report. */
export async function reviewVisualScene(
  brain: GameBrain,
  request: VisualReviewRequest,
  now = new Date(),
): Promise<VisualDirectorReport> {
  const user: BrainUserPart[] = [
    { type: "text", text: visualDirectorUserText(request.metadata) },
    { type: "image_url", image_url: { url: request.imageDataUrl } },
  ];
  const parsed = await brain.completeJson(visualDirectorSystemPrompt(), user, 900);
  if (parsed === null) {
    return emptyReport("unavailable", now);
  }
  const normalized = normalizeVisualReport(parsed, now);
  return normalized ?? emptyReport("invalid", now);
}

/** Normalize untrusted model output and reject unsafe or malformed actions. */
export function normalizeVisualReport(
  value: unknown,
  now = new Date(),
): VisualDirectorReport | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const rawOverall = typeof raw.overall === "string" ? Number(raw.overall) : raw.overall;
  const overall = numberInRange(rawOverall, 1, 5);
  const summary = stringLimit(raw.summary, 240);
  if (overall === null || summary === null) return null;

  const issues: VisualIssue[] = [];
  const rawIssues = Array.isArray(raw.issues) ? raw.issues : [];
  for (const rawIssue of rawIssues.slice(0, 5)) {
    const issue = normalizeIssue(rawIssue);
    if (issue !== null) issues.push(issue);
  }
  return {
    status: "ok",
    overall,
    summary,
    issues,
    reviewedAt: now.toISOString(),
  };
}

function normalizeIssue(value: unknown): VisualIssue | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isSetValue(ISSUE_CATEGORIES, raw.category) || !isSetValue(SEVERITIES, raw.severity)) {
    return null;
  }
  const target = stringLimit(raw.target, 80);
  const evidence = stringLimit(raw.evidence, 300);
  const confidence = numberInRange(raw.confidence, 0, 1);
  if (target === null || evidence === null || confidence === null) return null;
  const issue: VisualIssue = {
    category: raw.category,
    severity: raw.severity,
    target,
    evidence,
    confidence,
  };
  if (raw.recommendation !== undefined) {
    const recommendation = normalizeRecommendation(raw.recommendation);
    // Keep the visual finding even when its suggested tuning is unsafe; the
    // dry-run report should preserve evidence without carrying an unsafe patch.
    if (recommendation !== null) issue.recommendation = recommendation;
  }
  return issue;
}

function normalizeRecommendation(value: unknown): VisualRecommendation | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isSetValue(RECOMMENDATION_TYPES, raw.type)) return null;
  const target = stringLimit(raw.target, 80);
  const valueNumber = typeof raw.value === "number" && Number.isFinite(raw.value) ? raw.value : null;
  if (target === null || valueNumber === null || !withinRecommendationBounds(raw.type, valueNumber)) {
    return null;
  }
  const axis = raw.axis === "x" || raw.axis === "y" ? raw.axis : undefined;
  const rationale = stringLimit(raw.rationale, 180) ?? undefined;
  return { type: raw.type, target, value: valueNumber, axis, rationale };
}

/** Bounds prevent a dry-run report from becoming an unsafe future patch. */
function withinRecommendationBounds(type: VisualRecommendationType, value: number): boolean {
  const bounds: Record<VisualRecommendationType, [number, number]> = {
    "camera-zoom": [0.6, 1.2],
    "set-piece-scale": [0.1, 1.2],
    "set-piece-offset": [-96, 96],
    "depth-offset": [-0.2, 0.2],
    "palette-contrast": [-0.5, 0.5],
    "palette-noise": [-0.5, 0.5],
    "npc-scale": [0.1, 1.2],
    "ui-spacing": [-64, 64],
  };
  const [min, max] = bounds[type];
  return value >= min && value <= max;
}

function emptyReport(status: "unavailable" | "invalid", now: Date): VisualDirectorReport {
  return {
    status,
    overall: 0,
    summary: status === "unavailable" ? "The visual model was unavailable." : "The visual model returned an invalid report.",
    issues: [],
    reviewedAt: now.toISOString(),
  };
}

function isSetValue<T extends string>(set: ReadonlySet<T>, value: unknown): value is T {
  return typeof value === "string" && set.has(value as T);
}

function stringLimit(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : null;
}

function numberInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}
