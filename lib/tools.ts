import { readRepoFile } from "./github.ts";
import type { Issue } from "./github.ts";
import { findSimilar } from "./similar.ts";
import { TRIAGE_SCHEMA, parseTriage } from "./triage.ts";
import type { TriageResult } from "./triage.ts";

export interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export const TOOLS: ToolDef[] = [
  {
    name: "get_issue",
    description: "Read another open issue by number: title, labels, comment count and body.",
    schema: { type: "object", properties: { number: { type: "integer" } }, required: ["number"] },
  },
  {
    name: "find_similar",
    description: "List open issues in this repository that look similar to the one being triaged. Use it to detect duplicates.",
    schema: { type: "object", properties: {} },
  },
  {
    name: "list_labels",
    description: "List the labels already used in this repository with how often they appear.",
    schema: { type: "object", properties: {} },
  },
  {
    name: "read_repo_file",
    description: "Read a file from the repository default branch (for example README.md, CONTRIBUTING.md or a source file named in the issue).",
    schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "submit_triage",
    description: "Submit the final triage decision. Call this exactly once when done.",
    schema: TRIAGE_SCHEMA as unknown as Record<string, unknown>,
  },
];

export interface ToolContext {
  owner: string;
  repo: string;
  target: Issue;
  pool: Issue[];
  readFile?: (path: string) => Promise<string>;
}

export interface ToolOutcome {
  output: string;
  result?: TriageResult;
  isError?: boolean;
}

const SAFE_PATH = /^[\w][\w.\-/]{0,200}$/;

export function isSafeRepoPath(path: string): boolean {
  return SAFE_PATH.test(path) && !path.split("/").some((s) => s === "" || s === "." || s === "..");
}

export function untrusted(text: string): string {
  return `<untrusted_issue>\n${text.replaceAll("</untrusted_issue>", "")}\n</untrusted_issue>`;
}

export function labelCounts(pool: Issue[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const i of pool) for (const l of i.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const args = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  switch (name) {
    case "get_issue": {
      const issue = ctx.pool.find((i) => i.number === args.number);
      if (!issue) return { output: `Issue #${String(args.number)} is not among the loaded open issues.`, isError: true };
      return { output: untrusted(JSON.stringify({ number: issue.number, title: issue.title, labels: issue.labels, comments: issue.comments, body: issue.body.slice(0, 1500) })) };
    }
    case "find_similar":
      return { output: untrusted(JSON.stringify(findSimilar(ctx.target, ctx.pool))) };
    case "list_labels":
      return { output: JSON.stringify(labelCounts(ctx.pool).slice(0, 25)) };
    case "read_repo_file": {
      const path = String(args.path ?? "");
      if (!isSafeRepoPath(path)) return { output: "Invalid path.", isError: true };
      try {
        const read = ctx.readFile ?? ((p: string) => readRepoFile(ctx.owner, ctx.repo, p));
        return { output: untrusted(await read(path)) };
      } catch (e) {
        return { output: e instanceof Error ? e.message : "Could not read the file.", isError: true };
      }
    }
    case "submit_triage": {
      const parsed = parseTriage(input, ctx.pool.map((i) => i.number));
      if (typeof parsed === "string") return { output: `Invalid triage: ${parsed} Fix it and call submit_triage again.`, isError: true };
      return { output: "Triage recorded.", result: parsed };
    }
    default:
      return { output: `Unknown tool: ${name}`, isError: true };
  }
}
