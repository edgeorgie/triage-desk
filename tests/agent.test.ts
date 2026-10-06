import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../lib/agent.ts";
import type { Adapter, ModelTurn, Step } from "../lib/agent.ts";
import { executeTool, labelCounts } from "../lib/tools.ts";
import type { ToolContext } from "../lib/tools.ts";
import { findSimilar, jaccard, tokens } from "../lib/similar.ts";
import { parseTriage } from "../lib/triage.ts";
import { parseRepo, toIssue } from "../lib/github.ts";

const issue = (n: number, title: string, body = "", labels: string[] = []) =>
  toIssue({ number: n, title, body, labels, comments: 0, user: { login: "u" }, created_at: "2026-01-01", html_url: `https://x/${n}` });

const pool = [
  issue(1, "Crash when parsing empty config file", "Parser throws TypeError on empty config", ["bug"]),
  issue(2, "Add dark mode", "Please add a dark theme", ["feature"]),
  issue(3, "TypeError when config file is empty", "Throws TypeError parsing an empty config", ["bug", "parser"]),
];
const ctx: ToolContext = { owner: "o", repo: "r", target: pool[0], pool, readFile: async (p) => `content of ${p}` };

const validTriage = {
  kind: "bug", priority: "p2", labels: ["bug"], duplicate_of: 3, summary: "Empty config crashes.", needs_info: [], reply: "Thanks, this looks like #3.", confidence: 0.9,
};

function scripted(turns: ModelTurn[]): Adapter & { results: number } {
  let i = 0;
  const a = { results: 0, next: async () => turns[i++], addResults: () => { a.results++; } };
  return a;
}

test("similarity finds the duplicate and ignores unrelated issues", () => {
  const sim = findSimilar(pool[0], pool);
  assert.equal(sim[0].number, 3);
  assert.ok(!sim.some((s) => s.number === 2));
  assert.equal(jaccard(tokens("a b c"), new Set()), 0);
});

test("tools: get_issue, labels, read file, path guard", async () => {
  assert.ok((await executeTool("get_issue", { number: 2 }, ctx)).output.includes("dark mode"));
  assert.equal((await executeTool("get_issue", { number: 99 }, ctx)).isError, true);
  assert.deepEqual(labelCounts(pool)[0], ["bug", 2]);
  assert.ok((await executeTool("read_repo_file", { path: "README.md" }, ctx)).output.includes("content of README.md"));
  assert.equal((await executeTool("read_repo_file", { path: "../secret" }, ctx)).isError, true);
  assert.equal((await executeTool("nope", {}, ctx)).isError, true);
});

test("parseTriage validates and normalizes", () => {
  const ok = parseTriage(validTriage);
  assert.ok(typeof ok !== "string" && ok.duplicateOf === 3 && ok.confidence === 0.9);
  assert.equal(typeof parseTriage({ ...validTriage, kind: "weird" }), "string");
  assert.equal(typeof parseTriage({ ...validTriage, reply: " " }), "string");
});

test("agent loop runs tools then returns the submitted triage", async () => {
  const steps: Step[] = [];
  const adapter = scripted([
    { text: "Checking duplicates.", calls: [{ id: "a", name: "find_similar", input: {} }] },
    { text: "", calls: [{ id: "b", name: "submit_triage", input: validTriage }] },
  ]);
  const result = await runAgent({ adapter, ctx, onStep: (s) => steps.push(s) });
  assert.equal(result.duplicateOf, 3);
  assert.equal(adapter.results, 1);
  assert.equal(steps.filter((s) => s.kind === "tool" && s.output).length, 2);
  assert.equal(steps[0].kind, "thought");
});

test("agent recovers from an invalid submission", async () => {
  const adapter = scripted([
    { text: "", calls: [{ id: "a", name: "submit_triage", input: { kind: "bug" } }] },
    { text: "", calls: [{ id: "b", name: "submit_triage", input: validTriage }] },
  ]);
  assert.equal((await runAgent({ adapter, ctx })).kind, "bug");
});

test("agent fails clearly when it stops or runs out of steps", async () => {
  await assert.rejects(runAgent({ adapter: scripted([{ text: "done", calls: [] }]), ctx }), /stopped without/);
  const loop = scripted(Array.from({ length: 3 }, () => ({ text: "", calls: [{ id: "x", name: "list_labels", input: {} }] })));
  await assert.rejects(runAgent({ adapter: loop, ctx, maxSteps: 3 }), /all its steps/);
});

test("repo parsing", () => {
  assert.deepEqual(parseRepo("https://github.com/vercel/ai"), { owner: "vercel", repo: "ai" });
  assert.equal(parseRepo("nope"), null);
});
