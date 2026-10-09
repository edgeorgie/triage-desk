#!/usr/bin/env node
// Eval adapter for eval-lab's `--model exec` mode: reads { system, prompt } JSON on stdin,
// runs it through the SAME heuristicTriage logic the production bot uses (lib/heuristic-triage.ts)
// on a synthetic Issue built from the eval case's `input` text, and writes a plain-text summary
// to stdout that eval-lab's assertions (contains/not_contains/regex) can check.
//
// This makes eval-lab test triage-desk's OWN classification logic, not a mock — dogfooding
// one of the candidate's artifacts (eval-lab) against another (triage-desk) in real CI.
import { heuristicTriage } from "../lib/heuristic-triage.ts";

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const raw = await readStdin();
  const { prompt } = JSON.parse(raw || "{}");
  const issueText = String(prompt ?? "");
  const [title, ...rest] = issueText.split("\n");

  const target = {
    number: 9001,
    title: title ?? "",
    body: rest.join("\n"),
    labels: [],
    comments: 0,
    author: "eval",
    createdAt: new Date().toISOString(),
    url: "https://example.invalid/9001",
  };
  // Small fixed pool so duplicate-detection logic also runs deterministically in eval.
  const pool = [
    target,
    {
      number: 12,
      title: "App crashes on startup with a blank screen",
      body: "Opening the app shows a blank screen and then it crashes. Happens every time on v2.3.",
      labels: ["bug"],
      comments: 3,
      author: "someone",
      createdAt: "2024-01-01T00:00:00Z",
      url: "https://example.invalid/12",
    },
  ];

  const result = heuristicTriage(target, pool);
  process.stdout.write(`kind=${result.kind} priority=${result.priority} confidence=${result.confidence} duplicateOf=${result.duplicateOf ?? "none"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
