import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  checkSpec,
  markdownBlockContext,
  requirementIds,
  taskTableRows,
  traceabilityRows,
} from "../scripts/check-spec.mjs";

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
  const problems = run({ tasks });
  assert.ok(
    problems.includes(
      'T-2 Second has status "NOT DONE", expected one of: Merged, In review, In progress, Abandoned',
    ),
    problems.join("; "),
  );
});

test("the legitimate statuses are all accepted as values", () => {
  // The enum must not be written so narrowly that a status the project really uses is rejected.
  // This grades the VALUE only; whether a status delivers coverage is asserted separately below,
  // because grading the value alone was presentational and let `Abandoned` certify everything.
  for (const status of ["Merged", "In review", "In progress", "Abandoned"]) {
    const tasks = TASKS.replace("| FR-2 | Merged |", `| FR-2 | ${status} |`);
    assert.ok(
      !run({ tasks }).some((p) => p.includes("expected one of:")),
      `status ${status} should be accepted as a value`,
    );
  }
});

// --- the bypasses a THIRD independent cold review landed ---------------------------------------
//
// Every test above drives `tasks.md`. Not one passed an adversarial `spec.md` or an adversarial
// `traceability.md`, and that was the whole defect: three documents were parsed by three parsers
// of unequal strength, and each round hardened whichever one that round's reviewer attacked. The
// same three bypasses — a block hidden in an HTML comment, a block hidden in a fence, and fence
// state leaked by a longer delimiter — were still live against the two documents nobody aimed at,
// and wrapping the whole of `traceability.md`'s table in `<!-- -->` left the gate printing
// "9 requirements traced".
//
// The cases below are therefore PARAMETERISED over all three documents, so a bypass closed
// anywhere is proven closed everywhere. Adding a fourth document or a fourth hiding construct
// means adding one row here, not a third copy of a test.

/** The one line in each document that carries FR-2's half of the contract. */
const CARRIER = {
  spec: "### FR-2 Second",
  trace: "| FR-2 | `lib/b.ts` | manual | manual: PR 2. | Verified |",
  tasks: row("T-2 Second", 2, "FR-2"),
};

/**
 * Ways to ENCLOSE a line so a non-block-aware parser still reads it.
 *
 * `appliesTo` is explicit rather than assumed. An indented code block must not be read as a
 * TABLE ROW — an illustrative four-space-indented row satisfied coverage for a real requirement —
 * but in `spec.md` an indented heading deliberately still declares a requirement: of the two ways
 * to be wrong, inventing a requirement that must then be proven is fail-safe, while dropping one
 * lets unbuilt work through. Indentation is therefore never a way to delete a requirement, and
 * that asymmetry is asserted below instead of being hidden in a skipped case.
 */
const HIDERS: Record<string, { hide: (line: string) => string; appliesTo: string[] }> = {
  "an HTML comment": { hide: (line) => `<!--\n${line}\n-->`, appliesTo: ["spec", "trace", "tasks"] },
  "a fenced code block": { hide: (line) => "```\n" + line + "\n```", appliesTo: ["spec", "trace", "tasks"] },
  "a tilde fenced block": { hide: (line) => `~~~\n${line}\n~~~`, appliesTo: ["spec", "trace", "tasks"] },
  "a four-backtick block containing a three-backtick line": {
    hide: (line) => "````\n```\n" + line + "\n````",
    appliesTo: ["spec", "trace", "tasks"],
  },
  "an indented code block": { hide: (line) => "    " + line, appliesTo: ["trace", "tasks"] },
};

/**
 * Ways to LEAK fence state, which must not delete anything that follows.
 *
 * A boolean toggle flipped on the inner shorter fence and on the different-character fence, so
 * the closing run re-opened the block and every line after it vanished from the gate — in
 * `spec.md` that let a brand-new requirement with no implementation, no test, no traceability row
 * and no task row be declared and certified, with the printed count unchanged.
 */
const LEAKERS: Record<string, string> = {
  "a four-backtick fence closed by a three-backtick line": "````\n```\n````\n",
  "a tilde fence cross-toggled by a backtick fence": "~~~\n```\n~~~\n",
  "a fence indented three spaces": "   ```\n   ```\n",
  "an HTML comment holding a fence delimiter": "<!-- ``` -->\n",
};

/** What must be reported when FR-2's carrier in each document stops being readable. */
const MISSING_CARRIER: Record<string, string[]> = {
  // Losing the declaration must not be silent either: the other two documents then reference a
  // requirement the spec does not declare, which is the loud direction.
  spec: ["FR-2 is in traceability.md but not in spec.md", "FR-2 is claimed by a tasks.md work item but not in spec.md"],
  trace: ["FR-2 is in spec.md but missing from traceability.md"],
  tasks: ["FR-2 is in spec.md but no tasks.md work item claims it"],
};

const DOCS = { spec: SPEC, trace: TRACE, tasks: TASKS };
/** The real filename each fixture key stands for, so a test name names the real document. */
const DOC_FILE: Record<string, string> = { spec: "spec.md", trace: "traceability.md", tasks: "tasks.md" };

for (const [document, carrier] of Object.entries(CARRIER)) {
  for (const [hider, { hide, appliesTo }] of Object.entries(HIDERS)) {
    if (!appliesTo.includes(document)) continue;
    test(`FR-2 enclosed in ${hider} in ${DOC_FILE[document]} does not satisfy coverage`, () => {
      const original = DOCS[document as keyof typeof DOCS];
      const mutated = original.replace(carrier, hide(carrier));
      assert.notEqual(mutated, original, "fixture did not mutate");
      const problems = run({ [document]: mutated });
      for (const expected of MISSING_CARRIER[document]) {
        assert.ok(problems.includes(expected), `expected "${expected}", got: ${problems.join("; ")}`);
      }
    });
  }

  for (const [leaker, prelude] of Object.entries(LEAKERS)) {
    test(`${leaker} does not delete FR-2 from ${DOC_FILE[document]}`, () => {
      // The fail-open direction: a document is allowed to contain these constructs, and the
      // lines after them must still be read. A parser that loses its subject reports a clean
      // sheet over a truncated document, which is the defect this whole gate exists to prevent.
      const original = DOCS[document as keyof typeof DOCS];
      const mutated = prelude + "\n" + original;
      const problems = run({ [document]: mutated });
      assert.deepEqual(problems, [], `${leaker} leaked state in ${document}.md`);
    });
  }
}

test("a leaked-fence prelude really does contain its inner delimiter, so the fixtures are honest", () => {
  // Guards the LEAKERS fixtures themselves: if they stopped being well-formed enclosing blocks
  // the loop above would pass for the wrong reason. The prelude must hide its own body and
  // leave no fence open.
  for (const prelude of Object.values(LEAKERS)) {
    const ctx = markdownBlockContext(prelude + "visible\n");
    assert.equal(ctx.unterminatedFence, false, prelude);
    assert.equal(ctx.unterminatedComment, false, prelude);
    assert.deepEqual(
      ctx.lines.filter((l: { kind: string }) => l.kind === "content").map((l: { text: string }) => l.text),
      ["visible"],
      prelude,
    );
  }
});

test("indentation can never delete a requirement from spec.md", () => {
  // The asymmetry that `HIDERS.appliesTo` encodes, asserted rather than implied. An indented
  // heading still declares a requirement, which must then be proven in the other two documents;
  // the previous parser dropped headings indented four spaces, which removed them from the
  // gate's subject while it still printed a confident count.
  assert.deepEqual(requirementIds("        #### FR-11 deeply indented\n"), ["FR-11"]);
  const spec = SPEC.replace(CARRIER.spec, "    " + CARRIER.spec);
  assert.deepEqual(run({ spec }), []);
});

test("an unterminated fence or comment is reported, never silently swallowed", () => {
  // The anti-vacuous guards only ever caught TOTAL loss of a document's subject, so a construct
  // that deleted SOME lines left the gate printing a confident count over a truncated document.
  assert.ok(run({ spec: SPEC + "\n```\n" }).includes(
    "spec.md has an unterminated fenced code block — every line after it is hidden from this gate",
  ));
  assert.ok(run({ trace: TRACE + "\n<!--\n" }).includes(
    "traceability.md has an unterminated HTML comment — every line after it is hidden from this gate",
  ));
  assert.ok(run({ tasks: TASKS + "\n~~~\n" }).includes(
    "tasks.md has an unterminated fenced code block — every line after it is hidden from this gate",
  ));
});

test("a commented-out requirement heading does not invent a requirement", () => {
  // The other direction of the same defect: `requirementIds` had no comment handling at all, so
  // commenting out work the project decided NOT to build broke the build.
  assert.deepEqual(requirementIds("### FR-1 real\n\n<!--\n### FR-99 not building this\n-->\n"), ["FR-1"]);
  assert.deepEqual(run({ spec: SPEC + "\n<!--\n### FR-99 shelved\n-->\n" }), []);
});

test("a visually identical unicode hyphen or space cannot delete a line from the gate", () => {
  // `/^\|\s*T-\d+/` and `#+\s+FR-\d+` both require an ASCII hyphen and an ASCII space, so a
  // U+2011 hyphen or a U+00A0 after the hashes rendered identically and removed the line from
  // every grader — in `spec.md` that silently dropped a security requirement while the gate
  // still printed a full count.
  assert.deepEqual(requirementIds("###\u00a0FR-8 CSP\n"), ["FR-8"]);
  assert.deepEqual(requirementIds("### FR\u20118 CSP\n"), ["FR-8"]);
  const tasks = TASKS.replace("| T-2 Second |", "| T\u20112 Second |");
  assert.equal(taskTableRows(tasks).length, 2, "the U+2011 row must still be parsed and graded");
  assert.deepEqual(run({ tasks }), []);
});

// --- traceability.md is now graded as strictly as tasks.md ------------------------------------

test("the traceability table ends, so a rejected-drafts appendix is outside it", () => {
  // `new Map(...)` was last-write-wins over a raw line filter with no table termination, so an
  // appendix row reading "draft, superseded, do not use" overrode FR-2's real implementation
  // and test. FR-99 in the appendix is the tell: if the parser still read past the first table
  // it would report a requirement the spec does not declare.
  const trace =
    TRACE +
    "\nAppendix: rejected draft rows, do not use.\n\n" +
    "| Requirement | Implementation | Tests | Evidence | Status |\n|---|---|---|---|---|\n" +
    "| FR-2 | `package.json` | none | draft, superseded, do not use | Draft |\n" +
    "| FR-99 | `package.json` | none | never built | Draft |\n";
  assert.deepEqual(run({ trace }), []);
  assert.deepEqual(traceabilityRows(trace).map((c: string[]) => c[1]), ["FR-1", "FR-2"]);
});

test("a duplicate traceability row is an error, not a silent overwrite", () => {
  const trace = TRACE + "| FR-2 | `package.json` | none | draft, superseded, do not use | Draft |\n";
  assert.deepEqual(run({ trace }), ["FR-2 has more than one row in traceability.md — remove the duplicate"]);
});

test("a traceability row with the wrong column count is reported, not read at the wrong offset", () => {
  // With no length check, `const [, , impl, tests, evidence] = cells` left `tests` and
  // `evidence` undefined and `"manual" + undefined` satisfied the evidence check, so a row with
  // no test column at all passed.
  const trace = TRACE.replace(CARRIER.trace, "| FR-2 | `lib/b.ts` | manual |");
  const problems = run({ trace });
  assert.ok(problems.includes("a traceability.md row has 3 columns, expected 5: FR-2"), problems.join("; "));
  assert.ok(problems.includes("FR-2 is in spec.md but missing from traceability.md"), problems.join("; "));
});

test("evidence text saying no testing happened does not satisfy the evidence check", () => {
  // `/manual/i.test(tests + evidence)` grepped for a word anywhere in two concatenated cells.
  const trace = TRACE.replace(
    CARRIER.trace,
    "| FR-2 | `lib/b.ts` | none | no manual testing was ever performed and nothing is verified | Verified |",
  );
  assert.deepEqual(run({ trace }), ["FR-2 has neither a test nor manual evidence"]);
});

test("a genuine manual-evidence claim is still accepted", () => {
  // The fix must not be a blanket ban on the word: `manual` in Tests plus a `manual:` note in
  // Evidence is how this project records exercised-by-hand work, and the real documents use it.
  const trace = TRACE.replace(
    CARRIER.trace,
    "| FR-2 | `lib/b.ts` | manual | manual: PR 2, exercised in Chrome. | Verified |",
  );
  assert.deepEqual(run({ trace }), []);
});

test("a traceability table that misdescribes its own columns is reported", () => {
  // `IMPL_INDEX`/`TESTS_INDEX` were asserted against nothing, so the document could reorder its
  // header and have the checker read Evidence as Tests.
  const trace = TRACE.replace(
    "| Requirement | Implementation | Tests | Evidence | Status |",
    "| Requirement | Status | Evidence | Tests | Implementation |",
  );
  assert.ok(
    run({ trace }).some((p) => p.startsWith("traceability.md table header is")),
    run({ trace }).join("; "),
  );
});

test("a tasks table that misdescribes its own columns is reported", () => {
  const tasks = TASKS.replace(
    "| Task | Pull request | Branch | Requirements | Status |",
    "| Status | Requirements | Branch | Pull request | Task |",
  );
  assert.ok(run({ tasks }).some((p) => p.startsWith("tasks.md table header is")), run({ tasks }).join("; "));
});

test("a traceability.md that parses to zero rows names itself instead of reporting a clean sheet", () => {
  const problems = run({ trace: "# Traceability\n\nThe table is being rewritten.\n" });
  assert.ok(problems.includes("traceability.md parsed to zero requirement rows — the coverage check cannot run"));
});

// --- claims and delivery ----------------------------------------------------------------------

test("negated prose in the Requirements cell is not a claim", () => {
  // `matchAll(/FR-\d+/g)` over free text had no polarity, so writing down that the work was NOT
  // done counted as doing it. The cell is a closed grammar now.
  const tasks = TASKS.replace(
    row("T-2 Second", 2, "FR-2"),
    row("T-2 Second", 2, "explicitly NOT FR-2 — deferred, nothing shipped"),
  );
  const problems = run({ tasks });
  assert.ok(
    problems.some((p) => p.startsWith("T-2 Second has an unreadable Requirements cell")),
    problems.join("; "),
  );
  assert.ok(problems.includes("FR-2 is in spec.md but no tasks.md work item claims it"), problems.join("; "));
});

test("a comma-separated list of ids and the quality hatch are both still readable", () => {
  // The grammar must not be so tight that the real documents stop parsing: `tasks.md` uses both
  // `FR-1, FR-3, FR-4` and `none (quality)`.
  const tasks = TASKS.replace(row("T-2 Second", 2, "FR-2"), row("T-2 Second", 2, "FR-2,  FR-2"));
  assert.deepEqual(run({ tasks }), []);
});

test("a requirement claimed only by unmerged work is not covered", () => {
  // The Status enum graded the value and nothing consumed it, so marking every row `Abandoned`
  // left every requirement "traced" by work the table itself says never landed.
  for (const status of ["Abandoned", "In progress", "In review"]) {
    const tasks = TASKS.replace("| FR-2 | Merged |", `| FR-2 | ${status} |`);
    assert.deepEqual(run({ tasks }), [
      `FR-2 is claimed only by work items that are not merged: T-2 Second (${status})`,
    ]);
  }
});

test("a second merged row covers a requirement whose other claimant was abandoned", () => {
  // Coverage is about delivery, not about every row being tidy: an abandoned attempt alongside
  // a merged one must not fail the gate.
  const tasks = TASKS.replace(
    row("T-2 Second", 2, "FR-2"),
    `${row("T-2 Second", 2, "FR-2").replace("| Merged |", "| Abandoned |")}\n${row("T-3 Retry", 3, "FR-2")}`,
  );
  assert.deepEqual(run({ tasks }), []);
});

// --- blocks that are not content cannot be table rows -----------------------------------------

test("a four-space-indented row is a code block, not a contract row", () => {
  const tasks = TASKS.replace(row("T-2 Second", 2, "FR-2"), "    " + row("T-2 Second", 2, "FR-2"));
  assert.deepEqual(taskTableRows(tasks).map((c: string[]) => c[1]), ["T-1 First"]);
  assert.deepEqual(run({ tasks }), ["FR-2 is in spec.md but no tasks.md work item claims it"]);
});

test("a fenced block ends the contract table, so a row below it is outside it", () => {
  // "Only the first table counts, and a blank line ends it" was true for blank lines and prose
  // only: a fence is neither, and the fence branch continued without ending the table.
  const tasks = `# Tasks\n
| Task | Pull request | Branch | Requirements | Status |
|---|---|---|---|---|
${row("T-1 First", 1, "FR-1")}
\`\`\`
\`\`\`
${row("T-9 Smuggled", 9, "FR-2")}
`;
  assert.deepEqual(taskTableRows(tasks).map((c: string[]) => c[1]), ["T-1 First"]);
  assert.deepEqual(run({ tasks }), ["FR-2 is in spec.md but no tasks.md work item claims it"]);
});

test("a four-space-indented fence delimiter is an indented code block, not a fence", () => {
  // CommonMark allows a fence to be indented up to three columns; at four it is literal text.
  // Treating an indented delimiter as a fence let it swallow the rest of the document.
  const ctx = markdownBlockContext("    ```\nvisible\n");
  assert.equal(ctx.unterminatedFence, false);
  assert.deepEqual(
    ctx.lines.filter((l: { kind: string }) => l.kind === "content").map((l: { text: string }) => l.text),
    ["visible"],
  );
  assert.deepEqual(requirementIds("   ```\n### FR-1 hidden by a 3-space fence\n   ```\n### FR-2 real\n"), ["FR-2"]);
});

// --- the shared block reader, directly ---------------------------------------------------------

test("fence state is keyed on the delimiter character and its run length", () => {
  const longer = markdownBlockContext("````\n```\ninside\n````\nafter\n");
  assert.deepEqual(
    longer.lines.filter((l: { kind: string }) => l.kind === "content").map((l: { text: string }) => l.text),
    ["after"],
  );
  const crossed = markdownBlockContext("~~~\n```\ninside\n~~~\nafter\n");
  assert.deepEqual(
    crossed.lines.filter((l: { kind: string }) => l.kind === "content").map((l: { text: string }) => l.text),
    ["after"],
  );
});

test("an inline comment is stripped from a line rather than deleting the line", () => {
  const ctx = markdownBlockContext("a <!-- note --> b\n");
  assert.deepEqual(
    ctx.lines.filter((l: { kind: string }) => l.kind === "content").map((l: { text: string }) => l.text),
    ["a  b"],
  );
});

test("a comment spanning lines hides only the lines it covers", () => {
  const ctx = markdownBlockContext("before\n<!--\nhidden\n-->\nafter\n");
  assert.deepEqual(
    ctx.lines.filter((l: { kind: string }) => l.kind === "content").map((l: { text: string }) => l.text),
    ["before", "after"],
  );
});

test("a fence delimiter inside an HTML comment does not open a block", () => {
  // Comments are resolved before fences, or a commented-out delimiter leaks fence state out of
  // the comment that was supposed to contain it.
  const ctx = markdownBlockContext("<!-- ``` -->\nafter\n");
  assert.equal(ctx.unterminatedFence, false);
  assert.deepEqual(
    ctx.lines.filter((l: { kind: string }) => l.kind === "content").map((l: { text: string }) => l.text),
    ["after"],
  );
});

test("all three documents are read through the one shared block reader", () => {
  // The structural assertion, not a behavioural one: the recurring root cause was three parsers
  // of unequal strength in one file, so each round's fix reached one document. If a fourth
  // near-copy of fence/comment handling appears, this fails and says why.
  const source = readFileSync("scripts/check-spec.mjs", "utf8");
  const calls = source.match(/markdownBlockContext\(/g) ?? [];
  // One definition plus the call sites: the three block-structure checks and the two parsers.
  assert.ok(calls.length >= 6, `expected the shared reader to be used throughout, saw ${calls.length} mentions`);
  assert.equal(
    (source.match(/indexOf\("<!--"\)/g) ?? []).length,
    1,
    "HTML comment handling must exist in exactly one place",
  );
  assert.equal(
    (source.match(/function fenceDelimiter/g) ?? []).length,
    1,
    "fence handling must exist in exactly one place",
  );
});

// --- the real documents, adversarially --------------------------------------------------------
//
// `"this repository's own specification documents pass"` above asserts only that the CORRECT
// documents produce no problems, so it is a regression guard against false positives and
// contributes nothing against false negatives. A previous round claimed on-disk validation it
// had not performed — the constructs it named were not in the file, and the parser stopped
// before where they would have been. These cases mutate the documents actually on disk, so the
// suite's contact with reality is not limited to a known-good input being accepted.

const ON_DISK = () => ({
  spec: readFileSync("docs/spec/spec.md", "utf8"),
  trace: readFileSync("docs/spec/traceability.md", "utf8"),
  tasks: readFileSync("docs/spec/tasks.md", "utf8"),
});

test("the real traceability.md, wholly commented out, is not certified as traced", () => {
  // The exploit that printed "9 requirements traced" with no traceability present at all.
  const docs = ON_DISK();
  const lines = docs.trace.split("\n");
  const start = lines.findIndex((l) => l.startsWith("| Requirement |"));
  const end = lines.findLastIndex((l) => l.startsWith("| FR-"));
  assert.ok(start >= 0 && end > start, "fixture could not locate the real table");
  const trace = [
    ...lines.slice(0, start),
    "<!--",
    ...lines.slice(start, end + 1),
    "-->",
    ...lines.slice(end + 1),
  ].join("\n");
  const problems = checkSpec({ ...docs, trace, exists: allExist });
  assert.ok(
    problems.includes("traceability.md parsed to zero requirement rows — the coverage check cannot run"),
    problems.join("; "),
  );
  assert.ok(problems.includes("FR-1 is in spec.md but missing from traceability.md"), problems.join("; "));
});

test("the real traceability.md, wholly fenced, is not certified as traced", () => {
  const docs = ON_DISK();
  const lines = docs.trace.split("\n");
  const start = lines.findIndex((l) => l.startsWith("| Requirement |"));
  const end = lines.findLastIndex((l) => l.startsWith("| FR-"));
  const trace = [
    ...lines.slice(0, start),
    "```",
    ...lines.slice(start, end + 1),
    "```",
    ...lines.slice(end + 1),
  ].join("\n");
  const problems = checkSpec({ ...docs, trace, exists: allExist });
  assert.ok(
    problems.includes("traceability.md parsed to zero requirement rows — the coverage check cannot run"),
    problems.join("; "),
  );
});

test("a new requirement in the real spec.md after a leaked fence is not certified", () => {
  // A four-backtick fence containing a three-backtick line leaked state and deleted every
  // requirement declared after it, so a brand-new FR with no implementation, no test, no
  // traceability row and no task row passed — and the printed count was unchanged.
  const docs = ON_DISK();
  const spec =
    docs.spec +
    "\n````\nHow to show a fenced block inside documentation:\n```\n````\n\n### FR-22 Smuggled\n\nStatus: Verified.\n";
  const problems = checkSpec({ ...docs, spec, exists: allExist });
  assert.ok(problems.includes("FR-22 is in spec.md but missing from traceability.md"), problems.join("; "));
  assert.ok(problems.includes("FR-22 is in spec.md but no tasks.md work item claims it"), problems.join("; "));
});

test("a do-not-use appendix cannot override the real traceability.md, and a duplicate is an error", () => {
  const docs = ON_DISK();
  const appendixRow = "| FR-7 | `package.json` | none | draft, superseded, do not use | Draft |";
  // Outside the first table: ignored, and FR-7 keeps its real evidence.
  const appendix =
    docs.trace +
    "\n## Appendix: rejected draft rows, do not use\n\n" +
    "| Requirement | Implementation | Tests | Evidence | Status |\n|---|---|---|---|---|\n" +
    appendixRow +
    "\n";
  assert.deepEqual(checkSpec({ ...docs, trace: appendix, exists: allExist }), []);
  // Inside it: an error rather than a last-write-wins overwrite.
  const traceLines = docs.trace.split("\n");
  const last = traceLines.findLastIndex((l) => l.startsWith("| FR-"));
  traceLines.splice(last + 1, 0, appendixRow);
  assert.deepEqual(checkSpec({ ...docs, trace: traceLines.join("\n"), exists: allExist }), [
    "FR-7 has more than one row in traceability.md — remove the duplicate",
  ]);
});

test("every work item in the real tasks.md marked Abandoned is not certified as traced", () => {
  const docs = ON_DISK();
  const tasks = docs.tasks.replace(/\| Merged \|/g, "| Abandoned |");
  assert.notEqual(tasks, docs.tasks, "fixture did not mutate");
  const problems = checkSpec({ ...docs, tasks, exists: allExist });
  assert.ok(
    problems.some((p) => p.startsWith("FR-1 is claimed only by work items that are not merged")),
    problems.join("; "),
  );
});

test("the real documents' prose cannot be read as contract rows", () => {
  // The honesty check the previous round claimed and did not perform: plant an unmissable row
  // and a commented-out requirement deep in each document's prose, below where its table ends,
  // and assert the parse is unchanged. If a future edit moves a table or removes a terminator,
  // this fails instead of passing silently.
  const docs = ON_DISK();
  const baseline = checkSpec({ ...docs, exists: allExist });
  assert.deepEqual(baseline, [], "the real documents must pass before this test means anything");
  const planted = {
    spec: docs.spec + "\n<!--\n### FR-98 planted in prose\n-->\n\n```\n### FR-97 planted in a fence\n```\n",
    trace: docs.trace + "\n| FR-96 | `package.json` | none | planted in prose | Draft |\n",
    tasks:
      docs.tasks +
      "\n| T-98 Planted in prose | [#1](https://github.com/edgeorgie/triage-desk/pull/1) | `x` | FR-95 | Merged |\n",
  };
  assert.deepEqual(checkSpec({ ...planted, exists: allExist }), []);
});
