// Deterministic, no-LLM triage heuristic. Extracted from scripts/triage-bot.ts so it can be
// imported both by the production bot (as its fallback when no LLM key is configured) and by
// the eval-lab eval adapter (scripts/eval-adapter.ts) that exercises this SAME logic in CI via
// `uses: edgeorgie/eval-lab@main`. No logic is duplicated between production and eval.
import type { Issue } from "./github.ts";
import { findSimilar } from "./similar.ts";
import { labelCounts } from "./tools.ts";
import type { TriageResult } from "./triage.ts";

export function heuristicTriage(target: Issue, pool: Issue[]): TriageResult {
  const text = `${target.title}\n${target.body}`.toLowerCase();
  const dup = findSimilar(target, pool, 1)[0];
  const bugWords = ["bug", "error", "crash", "exception", "broken", "fails", "fail ", "doesn't work", "does not work", "traceback", "stack trace"];
  const featureWords = ["feature", "feature request", "would be nice", "could you add", "please add", "support for", "enhancement"];
  const questionWords = ["how do i", "how to", "is it possible", "question", "?"];
  const docsWords = ["docs", "documentation", "readme", "typo"];
  const sevWords = ["crash", "data loss", "security", "outage", "cannot start", "won't start", "critical"];

  let kind: TriageResult["kind"] = "other";
  if (bugWords.some((w) => text.includes(w))) kind = "bug";
  else if (featureWords.some((w) => text.includes(w))) kind = "feature";
  else if (docsWords.some((w) => text.includes(w))) kind = "docs";
  else if (questionWords.some((w) => text.includes(w))) kind = "question";
  else kind = "support";

  let priority: TriageResult["priority"] = "p2";
  if (kind === "bug" && sevWords.some((w) => text.includes(w))) priority = "p0";
  else if (kind === "bug") priority = "p1";
  else if (kind === "feature") priority = "p3";

  const existingLabels = new Set(labelCounts(pool).map(([l]) => l));
  const wanted = [kind, priority];
  const labels = wanted.filter((l) => existingLabels.has(l)).length === wanted.length ? wanted : [...new Set([...wanted])];

  const needsInfo: string[] = [];
  if (kind === "bug") {
    if (!/step|repro/i.test(text)) needsInfo.push("Steps to reproduce");
    if (!/version|v\d/i.test(text)) needsInfo.push("Package/app version");
    if (!/expect/i.test(text)) needsInfo.push("Expected vs. actual behavior");
  }

  const dupLine = dup ? ` This looks similar to #${dup.number} ("${dup.title}") — please check if it's the same issue.` : "";
  const reply =
    kind === "bug"
      ? `Thanks for the report! I've filed this as a ${priority} bug.${dupLine}${needsInfo.length ? ` To help us investigate, could you add: ${needsInfo.join(", ")}?` : ""}`
      : kind === "feature"
        ? `Thanks for the suggestion! I've tagged this as a feature request (${priority}).${dupLine} A maintainer will review and prioritize it.`
        : `Thanks for opening this! I've triaged it as "${kind}" (${priority}).${dupLine} A maintainer will follow up.`;

  return {
    kind,
    priority,
    labels,
    duplicateOf: dup && dup.score >= 0.35 ? dup.number : null,
    summary: `${kind} report: ${target.title}`.slice(0, 600),
    needsInfo,
    reply: `${reply}\n\n_Automated heuristic triage (no LLM key configured) — see Production usage in README._`,
    confidence: dup ? Math.min(0.6, 0.3 + dup.score) : 0.4,
  };
}
