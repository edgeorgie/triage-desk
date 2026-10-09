// Headless triage bot. Runs the SAME agent loop, tools and triage schema as the browser app
// (lib/agent.ts, lib/tools.ts, lib/triage.ts, lib/github.ts) — it just swaps the "model" and
// the "where issues come from" for a Node/GitHub-Actions environment instead of a browser tab.
//
// Invoked by .github/workflows/triage.yml on `issues: [opened]` / `pull_request_target: [opened]`.
// No new secrets are required for posting the comment/labels (uses the workflow's built-in
// GITHUB_TOKEN). An LLM call is used for the kind/priority/duplicate/reply reasoning step ONLY
// if ANTHROPIC_API_KEY or OPENAI_API_KEY is present in the environment (GitHub Actions secret).
// Otherwise this script runs a documented, fully-deterministic HEURISTIC fallback so the
// end-to-end pipeline (trigger -> investigate -> comment -> label) still produces real,
// inspectable output without any paid API key.
import { Octokit } from "@octokit/rest";
import { createAdapter, runAgent, SYSTEM_PROMPT, userPrompt } from "../lib/agent.ts";
import type { Adapter, ModelTurn, Step, ToolResultMsg } from "../lib/agent.ts";
import type { ToolContext } from "../lib/tools.ts";
import { listIssues, readRepoFile, toIssue } from "../lib/github.ts";
import type { Issue } from "../lib/github.ts";
import { heuristicTriage } from "../lib/heuristic-triage.ts";
import type { TriageResult } from "../lib/triage.ts";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
const ISSUE_NUMBER = Number(process.env.TRIAGE_ISSUE_NUMBER ?? process.env.ISSUE_NUMBER ?? NaN);
const DRY_RUN = process.env.TRIAGE_DRY_RUN === "1";

if (!OWNER || !REPO || !Number.isInteger(ISSUE_NUMBER)) {
  console.error("Missing GITHUB_REPOSITORY or TRIAGE_ISSUE_NUMBER/ISSUE_NUMBER.");
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN || undefined });


/** Minimal Adapter that returns ONE text-only turn so runAgent's loop short-circuits immediately
 * with a synthetic submit_triage call carrying the heuristic result. Keeps the exact same
 * agent-loop code path (and its logging/validation) as the LLM providers. */
class HeuristicAdapter implements Adapter {
  private done = false;
  private result: TriageResult;
  constructor(result: TriageResult) {
    this.result = result;
  }
  async next(): Promise<ModelTurn> {
    if (this.done) return { text: "", calls: [] };
    this.done = true;
    return { text: "Heuristic fallback (no LLM key configured).", calls: [{ id: "heuristic-1", name: "submit_triage", input: toSubmitInput(this.result) }] };
  }
  addResults(_turn: ModelTurn, _results: ToolResultMsg[]): void {
    void _turn;
    void _results;
  }
}

function toSubmitInput(r: TriageResult): Record<string, unknown> {
  return { kind: r.kind, priority: r.priority, labels: r.labels, duplicate_of: r.duplicateOf, summary: r.summary, needs_info: r.needsInfo, reply: r.reply, confidence: r.confidence };
}

async function main() {
  const repoFull = `${OWNER}/${REPO}`;
  console.log(`[triage-bot] ${repoFull}#${ISSUE_NUMBER} dry_run=${DRY_RUN}`);

  const pool = await listIssues(OWNER, REPO, 50, GITHUB_TOKEN);
  let target = pool.find((i) => i.number === ISSUE_NUMBER);
  if (!target) {
    const { data } = await octokit.issues.get({ owner: OWNER, repo: REPO, issue_number: ISSUE_NUMBER });
    target = toIssue(data as unknown as Parameters<typeof toIssue>[0]);
    pool.unshift(target);
  }

  const ctx: ToolContext = { owner: OWNER, repo: REPO, target, pool, readFile: (p) => readRepoFile(OWNER, REPO, p, GITHUB_TOKEN) };
  const steps: Step[] = [];
  const mode = ANTHROPIC_KEY ? "anthropic" : OPENAI_KEY ? "openai" : "heuristic";
  console.log(`[triage-bot] mode=${mode}`);

  let result: TriageResult;
  if (mode === "heuristic") {
    result = heuristicTriage(target, pool);
    const adapter = new HeuristicAdapter(result);
    result = await runAgent({ adapter, ctx, onStep: (s) => steps.push(s), maxSteps: 2 });
  } else {
    const adapter = createAdapter(mode, mode === "anthropic" ? ANTHROPIC_KEY : OPENAI_KEY, SYSTEM_PROMPT, userPrompt(repoFull, target));
    result = await runAgent({ adapter, ctx, onStep: (s) => steps.push(s), maxSteps: 8 });
  }

  const commentBody = [
    `### 🤖 triage-desk automated ruling`,
    ``,
    `**Kind:** \`${result.kind}\` · **Priority:** \`${result.priority}\` · **Confidence:** ${Math.round(result.confidence * 100)}%`,
    result.duplicateOf ? `**Possible duplicate of:** #${result.duplicateOf}` : ``,
    ``,
    result.summary,
    ``,
    result.needsInfo.length ? `**Needs info:**\n${result.needsInfo.map((n) => `- ${n}`).join("\n")}\n` : ``,
    `**Suggested reply:**`,
    `> ${result.reply.replaceAll("\n", "\n> ")}`,
    ``,
    `---`,
    `_Posted by [.github/workflows/triage.yml](../blob/main/.github/workflows/triage.yml) · mode: \`${mode}\` · run: ${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repoFull}/actions/runs/${process.env.GITHUB_RUN_ID ?? "local"}_`,
  ]
    .filter((l) => l !== ``)
    .join("\n");

  console.log("----- RULING -----");
  console.log(JSON.stringify(result, null, 2));
  console.log("----- COMMENT -----");
  console.log(commentBody);

  mkdirSync("triage-logs", { recursive: true });
  const logLine = JSON.stringify({ ts: new Date().toISOString(), repo: repoFull, issue: ISSUE_NUMBER, mode, runId: process.env.GITHUB_RUN_ID ?? null, result, steps }) + "\n";
  appendFileSync("triage-logs/runs.jsonl", logLine);
  writeFileSync("triage-logs/last-run.json", JSON.stringify({ ts: new Date().toISOString(), repo: repoFull, issue: ISSUE_NUMBER, mode, runId: process.env.GITHUB_RUN_ID ?? null, result }, null, 2));

  if (DRY_RUN) {
    console.log("[triage-bot] TRIAGE_DRY_RUN=1 set — skipping GitHub write calls.");
    return;
  }

  await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: ISSUE_NUMBER, body: commentBody });
  const labels = [...new Set([result.kind, result.priority, ...result.labels])].filter(Boolean);
  if (labels.length) await octokit.issues.addLabels({ owner: OWNER, repo: REPO, issue_number: ISSUE_NUMBER, labels });
  console.log(`[triage-bot] posted comment and applied labels: ${labels.join(", ")}`);
}

main().catch((e) => {
  console.error("[triage-bot] failed:", e);
  process.exit(1);
});
