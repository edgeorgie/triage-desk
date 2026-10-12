import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkSpec, requirementIds, taskTableRows } from "../scripts/check-spec.mjs";

// `spec:check` is a step inside the `verify` gate required on `main`. Until these tests existed
// its only validation was a manual mutation exercise written into a pull request body — nothing
// re-ran it, so an independent review landed five real bypasses against a version whose own
// description claimed it was mutation-validated. Each bypass that review landed is reproduced
// here as a failing case, so the class cannot regress silently when the parser is next touched.

const SPEC = `# Spec\n\n### FR-1 First\n\n### FR-2 Second\n`;

const TRACE = `# Traceability\n
| Requirement | Implementation | Tests | Evidence | Status |
|---|---|---|---|---|
| FR-1 | \`lib/a.ts\` | \`tests/a.test.ts\` | PR 1. | Verified |
| FR-2 | \`lib/b.ts\` | manual | manual: PR 2. | Verified |
`;

const row = (t: string, pr: number, reqs: string) =>
  `| ${t} | [#${pr}](https://github.com/edgeorgie/triage-desk/pull/${pr}) | \`branch\` | ${reqs} | Merged |`;

const TASKS = `# Tasks\n
| Task | Pull request | Branch | Requirements | Status |
|---|---|---|---|---|
${row("T-1 First", 1, "FR-1")}
${row("T-2 Second", 2, "FR-2")}

Prose below the table.
`;

// Every referenced path exists, so filesystem findings never mask a parser finding.
const allExist = () => true;
const run = (over: Partial<{ spec: string; trace: string; tasks: string }> = {}): string[] =>
  checkSpec({ spec: SPEC, trace: TRACE, tasks: TASKS, exists: allExist, ...over });

test("a complete, consistent document set yields no problems", () => {
  assert.deepEqual(run(), []);
});

test("a requirement with no work-item row is reported", () => {
  const tasks = TASKS.replace(row("T-2 Second", 2, "FR-2") + "\n", "");
  assert.deepEqual(run({ tasks }), ["FR-2 is in spec.md but no tasks.md work item claims it"]);
});

test("a work item claiming a requirement the spec does not declare is reported", () => {
  const tasks = TASKS.replace("FR-2 | Merged", "FR-42 | Merged");
  const problems = run({ tasks });
  assert.ok(problems.includes("FR-2 is in spec.md but no tasks.md work item claims it"));
  assert.ok(problems.includes("FR-42 is claimed by a tasks.md work item but not in spec.md"));
});

// --- the bypasses an independent review actually landed -------------------------------------

test("a table inside an HTML comment does not satisfy coverage", () => {
  const tasks = `# Tasks\n\n<!--\n| Task | Pull request | Branch | Requirements | Status |\n|---|---|---|---|---|\n${row("T-1 First", 1, "FR-1")}\n${row("T-2 Second", 2, "FR-2")}\n-->\n`;
  const problems = run({ tasks });
  assert.ok(problems.includes("FR-1 is in spec.md but no tasks.md work item claims it"));
  assert.ok(problems.includes("FR-2 is in spec.md but no tasks.md work item claims it"));
  // The commented rows must not inflate the row count into satisfying the anti-vacuous guard.
  assert.ok(problems.includes("tasks.md parsed to zero work-item rows — the coverage check cannot run"));
});

test("a table inside a fenced code block does not satisfy coverage", () => {
  const tasks = `# Tasks\n\n\`\`\`\n${row("T-1 First", 1, "FR-1")}\n${row("T-2 Second", 2, "FR-2")}\n\`\`\`\n`;
  const problems = run({ tasks });
  assert.ok(problems.includes("FR-1 is in spec.md but no tasks.md work item claims it"));
  assert.ok(problems.includes("tasks.md parsed to zero work-item rows — the coverage check cannot run"));
});

test("rows in a second table further down the document do not satisfy coverage", () => {
  const tasks = `# Tasks\n
| Task | Pull request | Branch | Requirements | Status |
|---|---|---|---|---|
${row("T-1 First", 1, "FR-1")}

Some prose that ends the contract table.

| Task | Pull request | Branch | Requirements | Status |
|---|---|---|---|---|
${row("T-9 Sneaky", 9, "FR-2")}
`;
  assert.deepEqual(run({ tasks }), ["FR-2 is in spec.md but no tasks.md work item claims it"]);
});

test("a row with the wrong column count is reported rather than read at the wrong offset", () => {
  // An extra column shifts FR-2 out of the Requirements cell; silently reading index 4 would
  // have found "FR-2" in the branch column and called the requirement covered.
  const tasks = TASKS.replace(
    row("T-2 Second", 2, "FR-2"),
    `| T-2 Second | [#2](https://github.com/edgeorgie/triage-desk/pull/2) | extra | \`branch\` | FR-2 | Merged |`,
  );
  const problems = run({ tasks });
  assert.ok(problems.some((p) => p.startsWith("a tasks.md work item has 6 columns, expected 5")));
  assert.ok(problems.includes("FR-2 is in spec.md but no tasks.md work item claims it"));
});

test("a pull request link whose label disagrees with its target is reported", () => {
  const tasks = TASKS.replace(
    "[#2](https://github.com/edgeorgie/triage-desk/pull/2)",
    "[#2](https://github.com/edgeorgie/triage-desk/pull/1)",
  );
  assert.deepEqual(run({ tasks }), ["T-2 Second links to pull request #1 but is labelled #2"]);
});

test("a row with no pull request link at all is reported", () => {
  const tasks = TASKS.replace("[#2](https://github.com/edgeorgie/triage-desk/pull/2)", "see the branch");
  assert.deepEqual(run({ tasks }), ["T-2 Second has no pull request link in its Pull request column"]);
});

test("a requirement is still found when its heading is demoted or indented", () => {
  assert.deepEqual(requirementIds("### FR-1 a\n#### FR-2 b\n  ## FR-3 c\n"), ["FR-1", "FR-2", "FR-3"]);
});

test("a spec that yields no requirements reports a parser failure, not a clean sheet", () => {
  const problems = run({ spec: "# Spec with no requirement headings\n" });
  assert.deepEqual(problems, ["spec.md yielded zero FR-n requirements — the parser cannot be trusted"]);
});

test("a requirement mentioned only in prose does not satisfy coverage", () => {
  const tasks = TASKS.replace(row("T-2 Second", 2, "FR-2") + "\n", "") + "\nFR-2 is discussed here in prose.\n";
  assert.deepEqual(run({ tasks }), ["FR-2 is in spec.md but no tasks.md work item claims it"]);
});

test("`none (quality)` exempts a row from claiming a requirement, never a requirement from being claimed", () => {
  // A quality-only row is legal...
  const withQualityRow = TASKS.replace("Prose below", `${row("T-3 CI hardening", 3, "none (quality)")}\n\nProse below`);
  assert.deepEqual(run({ tasks: withQualityRow }), []);
  // ...but marking the row that carried FR-2 as quality-only leaves FR-2 uncovered.
  const dodged = TASKS.replace(row("T-2 Second", 2, "FR-2"), row("T-2 Second", 2, "none (quality)"));
  assert.deepEqual(run({ tasks: dodged }), ["FR-2 is in spec.md but no tasks.md work item claims it"]);
});

test("the row parser reads cells from the contract table only", () => {
  const rows = taskTableRows(TASKS);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((cells: string[]) => cells[1]),
    ["T-1 First", "T-2 Second"],
  );
});

test("this repository's own specification documents pass", () => {
  // The suite's fixtures could all be satisfied by a parser that is wrong about the real files,
  // so assert against the documents actually on disk as well.
  const problems = checkSpec({
    spec: readFileSync("docs/spec/spec.md", "utf8"),
    trace: readFileSync("docs/spec/traceability.md", "utf8"),
    tasks: readFileSync("docs/spec/tasks.md", "utf8"),
  });
  assert.deepEqual(problems, []);
});

// --- the bypasses a SECOND independent cold review landed --------------------------------------
//
// The tests above were written against the fixtures the author had already fixed, so every one of
// them passed while eight further bypasses worked against the real documents. That is the same
// failure shape as the round before it: a guard validated only at the point it was already known
// to be correct. These cases are deliberately written at the boundaries instead.

test("a blank line ends the contract table, so a row below it does not satisfy coverage", () => {
  // The first attempt ended the table only on a non-blank non-table line, so this smuggled row
  // was accepted — "first table only" was asserted in a comment and never implemented. The test
  // that claimed to cover it passed only because its fixture separated the tables with prose.
  const tasks = `# Tasks\n
| Task | Pull request | Branch | Requirements | Status |
|---|---|---|---|---|
${row("T-1 First", 1, "FR-1")}

${row("T-9 Smuggled", 9, "FR-2")}
`;
  assert.deepEqual(taskTableRows(tasks).map((c: string[]) => c[1]), ["T-1 First"]);
  assert.deepEqual(run({ tasks }), ["FR-2 is in spec.md but no tasks.md work item claims it"]);
});

test("a four-backtick fence is not closed by a three-backtick line inside it", () => {
  // A boolean fence toggle flipped on the inner line and leaked fence state across the rest of
  // the document, hiding every row that followed while the gate stayed green.
  const tasks = `# Tasks\n\n\`\`\`\`\n\`\`\`\n\`\`\`\`\n
| Task | Pull request | Branch | Requirements | Status |
|---|---|---|---|---|
${row("T-1 First", 1, "FR-1")}
${row("T-2 Second", 2, "FR-2")}
`;
  assert.equal(taskTableRows(tasks).length, 2);
  assert.deepEqual(run({ tasks }), []);
});

test("a tilde fence is not closed by a backtick fence", () => {
  const tasks = `# Tasks\n\n~~~\n\`\`\`\n~~~\n
| Task | Pull request | Branch | Requirements | Status |
|---|---|---|---|---|
${row("T-1 First", 1, "FR-1")}
${row("T-2 Second", 2, "FR-2")}
`;
  assert.deepEqual(run({ tasks }), []);
});

test("an inline HTML comment does not delete the row that carries it", () => {
  // Skipping the whole line removed a real row from the gate's view, so its cells escaped the
  // pull request grader entirely — a row could hide a bad citation behind a comment.
  const tasks = TASKS.replace(
    row("T-2 Second", 2, "FR-2"),
    `| T-2 Second <!-- renamed --> | [#2](https://github.com/edgeorgie/triage-desk/pull/2) | \`branch\` | FR-2 | Merged |`,
  );
  assert.equal(taskTableRows(tasks).length, 2);
  assert.deepEqual(run({ tasks }), []);
});

test("a pull request link to a different repository is rejected", () => {
  // `[^/]+/[^/]+` accepted any repo on GitHub, which is exactly how a row could cite work that
  // is not this repo's and still read as traceable.
  const tasks = TASKS.replace(
    "https://github.com/edgeorgie/triage-desk/pull/2",
    "https://github.com/torvalds/linux/pull/2",
  );
  assert.deepEqual(run({ tasks }), [
    "T-2 Second cites #2 with a link that is not an edgeorgie/triage-desk pull request: https://github.com/torvalds/linux/pull/2",
  ]);
});

test("every link in the Pull request cell is graded, not only the first", () => {
  const tasks = TASKS.replace(
    "[#2](https://github.com/edgeorgie/triage-desk/pull/2)",
    "[#2](https://github.com/edgeorgie/triage-desk/pull/2) and [#3](https://github.com/other/repo/pull/3)",
  );
  assert.deepEqual(run({ tasks }), [
    "T-2 Second cites #3 with a link that is not an edgeorgie/triage-desk pull request: https://github.com/other/repo/pull/3",
  ]);
});

test("a pipe inside inline code or escaped does not make a legitimate row malformed", () => {
  const tasks = TASKS.replace(
    "| T-2 Second |",
    "| T-2 Second `a|b` and c\\|d |",
  );
  const problems = run({ tasks });
  assert.ok(!problems.some((p) => p.includes("columns, expected 5")), problems.join("; "));
  assert.deepEqual(problems, []);
});

test("a requirement heading is found at depth one and when deeply indented", () => {
  assert.deepEqual(requirementIds("# FR-10 top level\n"), ["FR-10"]);
  assert.deepEqual(requirementIds("        #### FR-11 deeply indented\n"), ["FR-11"]);
});

test("a requirement heading inside a fenced code block is not a declaration", () => {
  assert.deepEqual(requirementIds("### FR-1 real\n\n```\n### FR-99 an example\n```\n"), ["FR-1"]);
});

test("a status outside the project's closed set is reported", () => {
  // The original bug had two halves and only the missing-row half was closed. Merge state needs
  // the network, but an invented or mistyped status is checkable offline.
  const tasks = TASKS.replace("| FR-2 | Merged |", "| FR-2 | NOT DONE |");
  assert.deepEqual(run({ tasks }), [
    'T-2 Second has status "NOT DONE", expected one of: Merged, In review, In progress, Abandoned',
  ]);
});

test("the legitimate statuses are all accepted", () => {
  for (const status of ["Merged", "In review", "In progress", "Abandoned"]) {
    const tasks = TASKS.replace("| FR-2 | Merged |", `| FR-2 | ${status} |`);
    assert.deepEqual(run({ tasks }), [], `status ${status} should be accepted`);
  }
});
