import { existsSync, readFileSync } from "node:fs";

// Fails when a requirement has no implementation file, no test or manual evidence, points at a
// missing file, or is not claimed by a work item in tasks.md.
const spec = readFileSync("docs/spec/spec.md", "utf8");
const trace = readFileSync("docs/spec/traceability.md", "utf8");
const tasks = readFileSync("docs/spec/tasks.md", "utf8");

const ids = [...spec.matchAll(/^### (FR-\d+)/gm)].map((m) => m[1]);
const rows = new Map(
  trace
    .split("\n")
    .filter((l) => /^\| FR-\d+ /.test(l))
    .map((l) => [l.split("|")[1].trim(), l.split("|").map((c) => c.trim())]),
);

const problems = [];
for (const id of ids) {
  const cells = rows.get(id);
  if (!cells) {
    problems.push(`${id} is in spec.md but missing from traceability.md`);
    continue;
  }
  const [, , impl, tests, evidence] = cells;
  const paths = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const impls = paths(impl);
  if (impls.length === 0) problems.push(`${id} has no implementation file`);
  for (const p of [...impls, ...paths(tests)]) if (!existsSync(p)) problems.push(`${id} references a missing file: ${p}`);
  if (paths(tests).length === 0 && !/manual/i.test(tests + evidence)) problems.push(`${id} has neither a test nor manual evidence`);
}
for (const id of rows.keys()) if (!ids.includes(id)) problems.push(`${id} is in traceability.md but not in spec.md`);

// tasks.md claims coverage of requirements, and `spec:check` used to certify "N requirements
// traced" without ever reading it — so FR-7 and FR-8 shipped with no work item at all while the
// gate stayed green. Only the Requirements column of a task row counts as a claim: an `FR-n`
// appearing anywhere else in the file (prose, a heading, this comment's twin in the doc) must not
// silently satisfy coverage.
const taskRowRequirements = tasks
  .split("\n")
  .filter((l) => /^\|\s*T-\d+/.test(l))
  .map((l) => l.split("|").map((c) => c.trim()))
  // | T-n ... | PR | branch | requirements | status |  -> index 4 is the Requirements cell
  .map((cells) => cells[4] ?? "");

const claimed = new Set(taskRowRequirements.flatMap((cell) => [...cell.matchAll(/FR-\d+/g)].map((m) => m[0])));

for (const id of ids) if (!claimed.has(id)) problems.push(`${id} is in spec.md but no tasks.md work item claims it`);
for (const id of claimed) if (!ids.includes(id)) problems.push(`${id} is claimed by a tasks.md work item but not in spec.md`);

if (taskRowRequirements.length === 0) {
  // Guard against the check passing vacuously: if the table's shape ever changes so no row
  // parses, every requirement would look unclaimed above — but a reformat that yields zero rows
  // is a parser failure, not 9 real findings, and must say so.
  problems.push("tasks.md parsed to zero work-item rows — the coverage check cannot run");
}

if (problems.length > 0) {
  console.error(problems.map((p) => "- " + p).join("\n"));
  process.exit(1);
}
console.log(`spec check passed: ${ids.length} requirements traced`);
