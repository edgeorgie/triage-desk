#!/usr/bin/env node
// Local benchmark for heuristicTriage (lib/heuristic-triage.ts) against a self-labeled
// synthetic issue set. NOT run via GitHub Actions — run directly with:
//   node --experimental-strip-types tests-local/benchmark-triage.mjs
// Ground truth (expectedKind/expectedPriority) was assigned manually by reading
// lib/heuristic-triage.ts's own keyword rules — this is a SELF-LABELED test set,
// not an external/independent benchmark. See ACCURACY.md for full caveats.
import { heuristicTriage } from "../lib/heuristic-triage.ts";
import { performance } from "node:perf_hooks";

// Fixed pool issue used purely as duplicate-detection context (mirrors eval.config.json's pool).
const poolSeed = {
  number: 12,
  title: "App crashes on startup with a blank screen",
  body: "Opening the app shows a blank screen and then it crashes. Happens every time on v2.3.",
  labels: ["bug"],
  comments: 3,
  author: "someone",
  createdAt: "2024-01-01T00:00:00Z",
  url: "https://example.invalid/12",
};

const cases = [
  { id: "t1", title: "App crashes with a stack trace on launch", body: "Every time I open the app on v3.1 it crashes immediately. Here's the exception and stack trace from the logs. Steps to reproduce: install, open app, crash. Expected: app opens normally.", expectedKind: "bug", expectedPriority: "p0" },
  { id: "t2", title: "Export button fails silently", body: "Clicking the CSV export button does nothing, no error shown. This is a bug, it fails every time. Expected: a file download.", expectedKind: "bug", expectedPriority: "p1" },
  { id: "t3", title: "App won't start after the latest update", body: "After updating to v4.0 the app won't start at all, it's critical for our team. Steps: update, launch, nothing happens.", expectedKind: "bug", expectedPriority: "p0" },
  { id: "t4", title: "Typo in README installation section", body: "The documentation has a typo: 'instal' should be 'install' in the README.", expectedKind: "docs", expectedPriority: "p2" },
  { id: "t5", title: "Please add dark mode support", body: "It would be nice to have a dark theme. Could you add support for system-level theme detection too?", expectedKind: "feature", expectedPriority: "p3" },
  { id: "t6", title: "Feature request: CSV export", body: "Could you add an option to export the table as CSV? This would help a lot with reporting.", expectedKind: "feature", expectedPriority: "p3" },
  { id: "t7", title: "How do I configure the webhook URL?", body: "I have a question: how to set up the webhook endpoint for this app? Is it possible to use a custom domain?", expectedKind: "question", expectedPriority: "p2" },
  { id: "t8", title: "Is it possible to use custom auth providers?", body: "Is it possible to plug in a custom OAuth provider instead of the built-in one?", expectedKind: "question", expectedPriority: "p2" },
  { id: "t9", title: "App crashes right after opening, blank screen again", body: "Same as other reports: the app opens to a blank screen and then it crashes, every single time. Steps to reproduce: launch the app. Version: v2.3. Expected: normal startup.", expectedKind: "bug", expectedPriority: "p0", expectDuplicate: true },
  { id: "t10", title: "Dashboard feels slow and clunky lately", body: "Not sure if this is a bug or just me, but navigating the dashboard feels sluggish this week compared to before.", expectedKind: "support", expectedPriority: "p2" },
  { id: "t11", title: "Possible security exposure in the public API", body: "I noticed the public API endpoint returns more fields than it should for unauthenticated users. This could be a security issue worth a look.", expectedKind: "support", expectedPriority: "p2", note: "heuristic has no bug-keyword match here even though it's security-relevant; kind falls through to support, not flagged p0 despite sevWords containing 'security' — a real limitation, not a labeling mistake." },
  { id: "t12", title: "App crashes and causes data loss on export", body: "When I try to export a large file the app crashes and I lose my unsaved edits, this is a case of data loss.", expectedKind: "bug", expectedPriority: "p0" },
  { id: "t13", title: "Quick question about enabling dark mode", body: "Loving the product so far, just a question: how to enable dark mode in settings?", expectedKind: "question", expectedPriority: "p2" },
  { id: "t14", title: "Exception thrown when saving a draft", body: "Saving a draft throws an exception in the console. Doesn't happen every time, just sometimes.", expectedKind: "bug", expectedPriority: "p1" },
  { id: "t15", title: "Feature request: could you add bulk delete", body: "Feature request: would be nice to bulk delete multiple items at once instead of one by one.", expectedKind: "feature", expectedPriority: "p3" },
  { id: "t16", title: "README documentation is outdated", body: "The setup documentation is outdated and references an old config format, please update it.", expectedKind: "docs", expectedPriority: "p2" },
  { id: "t17", title: "Crash on launch, same issue as before", body: "This looks like a duplicate of the crash issue, it crashes every time right after launch on v2.3.", expectedKind: "bug", expectedPriority: "p0", expectDuplicate: true },
  { id: "t18", title: "Is this expected behavior with pricing tiers?", body: "I'm confused about how the pricing tiers work, is this expected behavior or a bug?", expectedKind: "question", expectedPriority: "p2" },
];

const RUNS = 3;
const allRunResults = [];

for (let run = 1; run <= RUNS; run++) {
  const results = [];
  for (const c of cases) {
    const target = { number: 9000 + Number(c.id.slice(1)), title: c.title, body: c.body, labels: [], comments: 0, author: "eval", createdAt: new Date().toISOString(), url: `https://example.invalid/${c.id}` };
    const pool = [target, poolSeed];
    const start = performance.now();
    const result = heuristicTriage(target, pool);
    const ms = performance.now() - start;
    const kindCorrect = result.kind === c.expectedKind;
    const priorityCorrect = result.priority === c.expectedPriority;
    const dupCorrect = c.expectDuplicate ? result.duplicateOf !== null : true; // only checked when expected
    results.push({
      id: c.id, title: c.title,
      expectedKind: c.expectedKind, predictedKind: result.kind, kindCorrect,
      expectedPriority: c.expectedPriority, predictedPriority: result.priority, priorityCorrect,
      expectDuplicate: !!c.expectDuplicate, predictedDuplicateOf: result.duplicateOf, dupCorrect,
      ms,
    });
  }
  allRunResults.push(results);
}

function summarize(results) {
  const n = results.length;
  const kindAcc = results.filter((r) => r.kindCorrect).length / n;
  const priAcc = results.filter((r) => r.priorityCorrect).length / n;
  const bothAcc = results.filter((r) => r.kindCorrect && r.priorityCorrect).length / n;
  const avgMs = results.reduce((s, r) => s + r.ms, 0) / n;
  const confusion = {};
  for (const r of results) {
    const key = `${r.expectedKind}->${r.predictedKind}`;
    confusion[key] = (confusion[key] ?? 0) + 1;
  }
  return { n, kindAcc, priAcc, bothAcc, avgMs, confusion };
}

const out = { runs: allRunResults.map(summarize), raw: allRunResults };
console.log(JSON.stringify(out, null, 2));
