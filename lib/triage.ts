export const KINDS = ["bug", "feature", "question", "docs", "support", "other"] as const;
export const PRIORITIES = ["p0", "p1", "p2", "p3"] as const;

export type Kind = (typeof KINDS)[number];
export type Priority = (typeof PRIORITIES)[number];

export interface TriageResult {
  kind: Kind;
  priority: Priority;
  labels: string[];
  duplicateOf: number | null;
  summary: string;
  needsInfo: string[];
  reply: string;
  confidence: number;
}

export const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: [...KINDS] },
    priority: { type: "string", enum: [...PRIORITIES], description: "p0 outage or data loss, p1 major bug, p2 normal, p3 nice to have" },
    labels: { type: "array", items: { type: "string" }, description: "Prefer labels that already exist in the repository" },
    duplicate_of: { type: ["integer", "null"], description: "Issue number this duplicates, only if clearly the same problem" },
    summary: { type: "string", description: "One or two sentences" },
    needs_info: { type: "array", items: { type: "string" }, description: "Specific missing details the reporter should add" },
    reply: { type: "string", description: "A short, kind, useful first response a maintainer could post" },
    confidence: { type: "number", description: "0 to 1" },
  },
  required: ["kind", "priority", "labels", "summary", "needs_info", "reply", "confidence"],
} as const;

/** Validates the submit_triage payload from the model. Returns an error string if it is unusable. */
export function parseTriage(input: unknown): TriageResult | string {
  if (typeof input !== "object" || input === null) return "Input must be an object.";
  const o = input as Record<string, unknown>;
  if (!KINDS.includes(o.kind as Kind)) return `kind must be one of ${KINDS.join(", ")}.`;
  if (!PRIORITIES.includes(o.priority as Priority)) return `priority must be one of ${PRIORITIES.join(", ")}.`;
  if (typeof o.summary !== "string" || !o.summary.trim()) return "summary is required.";
  if (typeof o.reply !== "string" || !o.reply.trim()) return "reply is required.";
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : []);
  const dup = typeof o.duplicate_of === "number" && Number.isInteger(o.duplicate_of) ? o.duplicate_of : null;
  const conf = typeof o.confidence === "number" ? Math.min(1, Math.max(0, o.confidence)) : 0.5;
  return {
    kind: o.kind as Kind,
    priority: o.priority as Priority,
    labels: strings(o.labels),
    duplicateOf: dup,
    summary: o.summary.trim(),
    needsInfo: strings(o.needs_info),
    reply: o.reply.trim(),
    confidence: conf,
  };
}
