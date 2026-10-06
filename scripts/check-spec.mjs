import { existsSync, readFileSync } from "node:fs";

// Fails when a requirement has no implementation file, no test or manual evidence, or points at a missing file.
const spec = readFileSync("docs/spec/spec.md", "utf8");
const trace = readFileSync("docs/spec/traceability.md", "utf8");

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

if (problems.length > 0) {
  console.error(problems.map((p) => "- " + p).join("\n"));
  process.exit(1);
}
console.log(`spec check passed: ${ids.length} requirements traced`);
