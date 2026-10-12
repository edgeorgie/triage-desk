import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canonicaliseId,
  checkSpec,
  loadRequirements,
  markdownBlockContext,
  requirementIds,
  taskTableRows,
  traceabilityRows,
} from "../scripts/check-spec.mjs";

// `spec:check` is a step inside the `verify` gate required on `main`. FIVE consecutive rounds of
// cold review each landed a working bypass against it, and the fifth landed a REGRESSION: NFKC
// normalisation added to stop a confusable deleting a line was applied BEFORE fence and comment
// classification, so fullwidth characters that render as literal text folded INTO the gate's own
// delimiters. A document looked normal to a human while the gate stopped grading part of it.
//
// The structural answer, and what this suite is now written against: requirement IDENTITY comes
// from `docs/spec/requirements.json`, and the markdown documents are RECONCILED against it. A
// line hidden in markdown can no longer remove a requirement from the gate's subject, because
// the subject is not discovered by parsing markdown at all.
//
// Two axes that every previous round's suite failed to cross are crossed deliberately here: the
// CHARACTER-SET axis (fullwidth delimiter synthesis, zero-width joiners, bidi overrides) and the
// GRADED-VS-COUNTED axis (rows past a table terminator were parsed and then never graded).

// --- fixtures ---------------------------------------------------------------------------------

const REQS = JSON.stringify([
  {
    id: "FR-1",
    title: "First",
    status: "Verified",
    acceptance: ["Given a thing, then it works."],
    implementation: ["lib/a.ts"],
    tests: ["tests/a.test.ts"],
    evidence: "PR 1.",
  },
  {
    id: "FR-2",
    title: "Second",
    status: "Verified",
    acceptance: ["Given another thing, then it also works."],
    implementation: ["lib/b.ts"],
    tests: [],
    evidence: "manual: PR 2.",
  },
]);

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
const run = (
  over: Partial<{ requirements: string; spec: string; trace: string; tasks: string }> = {},
): string[] =>
  checkSpec({ requirements: REQS, spec: SPEC, trace: TRACE, tasks: TASKS, exists: allExist, ...over });

/** Fullwidth forms that NFKC folds onto the delimiters this gate greps for. */
const FULLWIDTH_FENCE = "\uff40\uff40\uff40"; // U+FF40 x3 -> ```
const FULLWIDTH_TILDE = "\uff5e\uff5e\uff5e"; // U+FF5E x3 -> ~~~
const FULLWIDTH_OPEN = "\uff1c\uff01\uff0d\uff0d"; // U+FF1C U+FF01 U+FF0D U+FF0D -> <!--
const FULLWIDTH_CLOSE = "\uff0d\uff0d\uff1e"; // U+FF0D U+FF0D U+FF1E -> -->

test("a complete, consistent document set yields no problems", () => {
  assert.deepEqual(run(), []);
});

test("this repository's own specification documents pass", () => {
  // The suite's fixtures could all be satisfied by a parser that is wrong about the real files,
  // so assert against the documents actually on disk as well. A hardening change that
  // false-positives on the real documents is its own defect.
  const problems = checkSpec({
    requirements: readFileSync("docs/spec/requirements.json", "utf8"),
    spec: readFileSync("docs/spec/spec.md", "utf8"),
    trace: readFileSync("docs/spec/traceability.md", "utf8"),
    tasks: readFileSync("docs/spec/tasks.md", "utf8"),
  });
  assert.deepEqual(problems, []);
});

// --- the structured source of truth is the gate's subject -------------------------------------
//
// This is the architectural change, so it is asserted directly rather than only through its
// consequences. Every previous round's gate discovered WHICH requirements existed by scraping
// prose headings, which made its own subject attacker-controlled; a construct that hid a heading
// removed the requirement from grading entirely and the printed count moved quietly with it.

test("the gate's subject comes from requirements.json, not from the markdown it grades", () => {
  // A requirement declared in the structured source and NOWHERE in the markdown is the loud
  // direction: it is reported as missing from each document, never silently dropped.
  const requirements = JSON.stringify([
    ...JSON.parse(REQS),
    {
      id: "FR-3",
      title: "Third",
      status: "Verified",
      acceptance: ["Given a third thing."],
      implementation: ["lib/c.ts"],
      tests: ["tests/c.test.ts"],
      evidence: "PR 3.",
    },
  ]);
  const problems = run({ requirements });
  assert.ok(problems.includes("FR-3 is declared in requirements.json but has no heading in spec.md"), problems.join("; "));
  assert.ok(problems.includes("FR-3 is in requirements.json but missing from traceability.md"), problems.join("; "));
  assert.ok(problems.includes("FR-3 is in requirements.json but no tasks.md work item claims it"), problems.join("; "));
});

test("a requirement in the markdown that the structured source does not declare is reported", () => {
  const spec = SPEC + "\n### FR-22 Unbuilt\n";
  assert.ok(run({ spec }).includes("spec.md declares FR-22, which requirements.json does not"));
});

test("an unreadable requirements.json is a parser failure, not a clean sheet", () => {
  for (const [json, expected] of [
    ["{ not json", "requirements.json is not valid JSON"],
    ["[]", "requirements.json is not a non-empty array"],
    ["{}", "requirements.json is not a non-empty array"],
  ] as const) {
    const problems = run({ requirements: json });
    assert.ok(problems.some((p) => p.startsWith(expected)), `${json}: ${problems.join("; ")}`);
    // It must STOP there rather than reporting findings derived from a subject it does not have.
    assert.equal(problems.filter((p) => p.includes("requirements.json")).length, problems.length, problems.join("; "));
  }
});

test("a requirements.json entry with a missing or unreadable field is reported, never defaulted", () => {
  const base = JSON.parse(REQS)[0];
  const cases: Array<[string, Record<string, unknown>]> = [
    ["title", { ...base, title: "" }],
    ["evidence", { ...base, evidence: "" }],
    ["implementation", { ...base, implementation: [] }],
    ["status", { ...base, status: "Shipped" }],
  ];
  for (const [field, entry] of cases) {
    const problems = run({ requirements: JSON.stringify([entry, JSON.parse(REQS)[1]]) });
    assert.ok(
      problems.some((p) => p.includes(`has a missing or unreadable`) && p.includes(field)),
      `${field}: ${problems.join("; ")}`,
    );
  }
});

test("the printed count is read from the structured source, so it cannot witness its own loss", () => {
  // The count a gate derives from its own parse moves quietly when the parse is truncated: five
  // rounds watched it go 9 -> 8 while the gate printed "passed". `loadRequirements` is the only
  // thing the entry point counts, and it never reads the markdown.
  const declared = loadRequirements(readFileSync("docs/spec/requirements.json", "utf8"), []);
  assert.ok(declared !== null);
  assert.equal(declared.length, 9);
  const source = readFileSync("scripts/check-spec.mjs", "utf8");
  const printer = source.slice(source.lastIndexOf("spec check passed"));
  assert.ok(!/requirementIds\(/.test(printer), "the printed count must not be derived from the markdown parse");
});

// --- F1: block structure is classified on the RAW line ----------------------------------------

test("fullwidth confusables cannot synthesise a fence or a comment", () => {
  // THE round-five regression, at the root. NFKC maps U+FF40 x3 onto ``` and
  // U+FF1C U+FF01 U+FF0D U+FF0D onto `<!--`, and normalisation ran BEFORE classification, so an
  // attacker got a block construct that renders as ordinary literal text in every markdown
  // renderer. Classification now happens on the raw line, so these are just text.
  for (const synthetic of [FULLWIDTH_FENCE, FULLWIDTH_TILDE, FULLWIDTH_OPEN]) {
    const ctx = markdownBlockContext(`${synthetic}\nvisible\n`);
    assert.equal(ctx.unterminatedFence, false, synthetic);
    assert.equal(ctx.unterminatedComment, false, synthetic);
    assert.ok(
      ctx.lines.some((l: { kind: string; text: string }) => l.kind === "content" && l.text === "visible"),
      `${synthetic} hid the line after it`,
    );
  }
});

test("a fullwidth fence does not hide an untraced requirement from spec.md", () => {
  const spec = SPEC + `\n${FULLWIDTH_FENCE}\n### FR-22 Unbuilt, unimplemented, untested\n${FULLWIDTH_FENCE}\n`;
  assert.ok(run({ spec }).includes("spec.md declares FR-22, which requirements.json does not"));
});

test("a fullwidth comment does not delete a real requirement's heading", () => {
  // Reported as partial loss BY NAME, which is precisely what round five claimed and did not do.
  const spec = SPEC.replace("### FR-2 Second", `${FULLWIDTH_OPEN}### FR-2 Second${FULLWIDTH_CLOSE}`);
  assert.ok(run({ spec }).includes("FR-2 is declared in requirements.json but has no heading in spec.md"));
});

test("a fullwidth comment cannot smuggle a traceability or task id past the id check", () => {
  const trace = TRACE.replace("| FR-2 |", `| ${FULLWIDTH_OPEN}FR-2${FULLWIDTH_CLOSE} |`);
  assert.ok(
    run({ trace }).some((p) => p.includes("is not a plain `FR-<n>` id")),
    run({ trace }).join("; "),
  );
  const tasks = TASKS.replace("| T-2 Second |", `| ${FULLWIDTH_OPEN}T-2${FULLWIDTH_CLOSE} Second |`);
  assert.ok(
    run({ tasks }).some((p) => p.includes("is not a plain `T-<n>` id")),
    run({ tasks }).join("; "),
  );
});

test("normalisation still folds a confusable in a row's SEMANTIC content", () => {
  // The fix must not throw away the thing round five got right. A U+2011 hyphen in a row's
  // prose, or a U+00A0 after the hashes, renders identically and must not stop a line parsing —
  // folding is correct, just not before the line's block structure is known.
  const ctx = markdownBlockContext("some\u2011text\n");
  assert.equal(ctx.lines[0].text, "some-text");
  assert.equal(ctx.lines[0].raw, "some\u2011text");
  const spec = SPEC.replace("### FR-2 Second", "###\u00a0FR-2 Second");
  assert.deepEqual(run({ spec }), []);
});

// --- F3: unicode identity tricks are rejected, never folded into a different id ---------------

test("a zero-width joiner in an id is a hard error, not a different id", () => {
  // `FR-2<ZWJ>2` renders as FR-22 to a human and used to parse as a DUPLICATE FR-2, inheriting
  // the real FR-2's implementation, test, traceability row and task row — a brand-new
  // requirement arrived pre-proven, and the count even incremented to 10.
  const spec = SPEC + "\n### FR-2\u200d2 Delete any repository the agent can reach\n";
  const problems = run({ spec });
  assert.ok(
    problems.some((p) => p.includes('"FR-2\\u200d2"') && p.includes("renders as FR-22 but is not that id")),
    problems.join("; "),
  );
  // And it must NOT have been counted as a second FR-2.
  assert.ok(!problems.some((p) => p.includes("has 2 headings")), problems.join("; "));
});

test("a bidi override before an id is a hard error, not a deleted heading", () => {
  const spec = SPEC + "\n### \u202eFR-22 Smuggled\n";
  assert.ok(
    run({ spec }).some((p) => p.includes('"\\u202eFR-22"') && p.includes("is not a plain `FR-<n>` id")),
    run({ spec }).join("; "),
  );
});

test("a lowercase or fullwidth spelling of an id is a hard error, not a silently ignored heading", () => {
  for (const token of ["fr-22", "\uff26\uff32\uff0d\uff12\uff12", "FR\u20112"]) {
    const spec = SPEC + `\n### ${token} Smuggled\n`;
    assert.ok(
      run({ spec }).some((p) => p.includes("is not a plain `FR-<n>` id")),
      `${token}: ${run({ spec }).join("; ")}`,
    );
  }
});

test("canonicaliseId reports whether the token was ALREADY canonical, which is the load-bearing half", () => {
  // Folding a confusable id into the real one is what merges two requirements. Canonicalising is
  // only ever used to RECOGNISE that a token was meant to be an id; a token that needed it fails.
  assert.deepEqual(canonicaliseId("FR-8"), { canonical: "FR-8", conforming: true });
  for (const token of ["fr-8", "FR\u20118", "F\u200dR-8", "\u202eFR-8", "\uff26\uff32\uff0d\uff18", "FR-8\ufeff"]) {
    const { canonical, conforming } = canonicaliseId(token);
    assert.equal(canonical, "FR-8", token);
    assert.equal(conforming, false, `${token} must not be accepted as already canonical`);
  }
});

test("a non-conforming id in requirements.json itself is a hard error", () => {
  // The allowlist is at the identity LAYER, so the structured source is held to it too — or the
  // source of truth becomes the new place to plant an aliased id.
  const requirements = JSON.stringify([{ ...JSON.parse(REQS)[0], id: "FR-0\u200d1" }, JSON.parse(REQS)[1]]);
  assert.ok(
    run({ requirements }).some((p) => p.includes("which is not a plain `FR-<n>` id")),
    run({ requirements }).join("; "),
  );
});

test("a confusable in a Requirements cell cannot alias a claim onto another requirement", () => {
  const tasks = TASKS.replace(row("T-2 Second", 2, "FR-2"), row("T-2 Second", 2, "FR-2\u200d2"));
  const problems = run({ tasks });
  assert.ok(problems.some((p) => p.includes("has an unreadable Requirements cell")), problems.join("; "));
  assert.ok(problems.includes("FR-2 is in requirements.json but no tasks.md work item claims it"), problems.join("; "));
});

// --- F4: shape is graded over EVERY row, coverage only over the first table --------------------

test("a row past the table terminator is GRADED for shape, not merely uncounted", () => {
  // The two questions were conflated. Rows below a terminator were parsed and then never graded,
  // so a row citing an unrelated repository with the literal status text "NOT A REAL STATUS"
  // passed green while rendering as a perfectly ordinary contract row.
  const smuggled =
    "| T-12 Unaudited work | [#99](https://github.com/torvalds/linux/pull/99) | `x` | none (quality) | NOT A REAL STATUS |";
  for (const tasks of [
    TASKS + `\n${smuggled}\n`, // below the prose terminator
    TASKS.replace("Prose below the table.", "```\n```\n" + smuggled), // below a fence
    TASKS.replace("Prose below the table.", "    " + smuggled), // in an indented code block? no:
  ]) {
    const problems = run({ tasks });
    if (tasks.includes("    | T-12")) continue; // an indented row is a code block, asserted below
    assert.ok(
      problems.some((p) => p.includes("is not an edgeorgie/triage-desk pull request")),
      `citation ungraded: ${problems.join("; ")}`,
    );
    assert.ok(
      problems.some((p) => p.includes('has status "NOT A REAL STATUS"')),
      `status ungraded: ${problems.join("; ")}`,
    );
  }
});

test("a row past the terminator still does not COVER a requirement", () => {
  // Shape grading must not accidentally make an appendix row certify anything: the two questions
  // are now answered separately, and this asserts the coverage half did not widen.
  const tasks =
    TASKS.replace(row("T-2 Second", 2, "FR-2") + "\n", "") + "\n" + row("T-9 Appendix", 9, "FR-2") + "\n";
  assert.ok(run({ tasks }).includes("FR-2 is in requirements.json but no tasks.md work item claims it"));
});

test("a traceability row past the terminator is graded for shape and does not override the real row", () => {
  const trace = TRACE + "\nAppendix: rejected drafts.\n\n| FR-2 | | | | NOT A REAL STATUS |\n";
  const problems = run({ trace });
  assert.ok(problems.some((p) => p.includes('has status "NOT A REAL STATUS"')), problems.join("; "));
  // FR-2 keeps its real evidence; the appendix row did not replace it.
  assert.ok(!problems.some((p) => p.includes("Evidence cell")), problems.join("; "));
});

test("a four-space-indented row is a code block, not a contract row", () => {
  const tasks = TASKS.replace(row("T-2 Second", 2, "FR-2"), "    " + row("T-2 Second", 2, "FR-2"));
  assert.deepEqual(
    taskTableRows(tasks).map((r: { cells: string[] }) => r.cells[1]),
    ["T-1 First"],
  );
  assert.ok(run({ tasks }).includes("FR-2 is in requirements.json but no tasks.md work item claims it"));
});

// --- F5: the Evidence/Tests contract is reconciled exactly, not shape-checked ------------------
//
// The critic reported F5 as suspected-but-not-reproduced and could not construct a passing false
// manual-evidence claim. That was correct: `declaresManualEvidence` rejected the direct attempts.
// But the PRIMITIVE was real — an inline comment can change what the gate reads without changing
// a rendered character — so these assert the whole class, by exact agreement rather than shape.

test("an inline comment cannot make the gate read a different Tests or Evidence cell than a reader", () => {
  for (const trace of [
    TRACE.replace("| manual | manual: PR 2. |", "| manual | <!--manual: -->no testing was ever done |"),
    TRACE.replace("| manual | manual: PR 2. |", "| <!--manual-->none | manual: PR 2. |"),
    TRACE.replace("| manual: PR 2. |", `| ${FULLWIDTH_OPEN} manual: ${FULLWIDTH_CLOSE} PR 2. |`),
  ]) {
    assert.notEqual(trace, TRACE, "fixture did not mutate");
    assert.notDeepEqual(run({ trace }), [], "an altered Tests/Evidence cell must be reported");
  }
});

test("a requirement with no tests must say `manual` and back it with a `manual:` note", () => {
  const trace = TRACE.replace("| FR-2 | `lib/b.ts` | manual |", "| FR-2 | `lib/b.ts` | none |");
  assert.ok(
    run({ trace }).some((p) => p.includes("must read exactly `manual`")),
    run({ trace }).join("; "),
  );
  const requirements = JSON.stringify([
    JSON.parse(REQS)[0],
    { ...JSON.parse(REQS)[1], evidence: "no manual testing was ever performed and nothing is verified" },
  ]);
  assert.ok(
    run({ requirements }).some((p) => p.includes('must open with "manual:"')),
    run({ requirements }).join("; "),
  );
});

test("a drifted Implementation, Tests, Evidence or Status cell is reported by name", () => {
  for (const [trace, needle] of [
    [TRACE.replace("| `lib/b.ts` |", "| `package.json` |"), "Implementation cell"],
    [TRACE.replace("| `tests/a.test.ts` |", "| `tests/other.test.ts` |"), "Tests cell"],
    [TRACE.replace("| PR 1. |", "| PR 7. |"), "Evidence cell"],
    [TRACE.replace("| FR-1 | `lib/a.ts` | `tests/a.test.ts` | PR 1. | Verified |", "| FR-1 | `lib/a.ts` | `tests/a.test.ts` | PR 1. | Draft |"), "Status cell"],
  ] as const) {
    assert.ok(run({ trace }).some((p) => p.includes(needle)), `${needle}: ${run({ trace }).join("; ")}`);
  }
});

test("a declared file that does not exist is reported against the structured source", () => {
  const problems = checkSpec({
    requirements: REQS,
    spec: SPEC,
    trace: TRACE,
    tasks: TASKS,
    exists: (p: unknown) => p !== "lib/b.ts",
  });
  assert.ok(problems.includes("FR-2 references a missing file: lib/b.ts"), problems.join("; "));
});

// --- the bypasses the earlier rounds landed, kept as regression cases -------------------------

const HIDERS: Record<string, (line: string) => string> = {
  "an HTML comment": (line) => `<!--\n${line}\n-->`,
  "a fenced code block": (line) => "```\n" + line + "\n```",
  "a tilde fenced block": (line) => `~~~\n${line}\n~~~`,
  "a four-backtick block containing a three-backtick line": (line) => "````\n```\n" + line + "\n````",
};

const LEAKERS: Record<string, string> = {
  "a four-backtick fence closed by a three-backtick line": "````\n```\n````\n",
  "a tilde fence cross-toggled by a backtick fence": "~~~\n```\n~~~\n",
  "a fence indented three spaces": "   ```\n   ```\n",
  "an HTML comment holding a fence delimiter": "<!-- ``` -->\n",
  "a fullwidth fence, which is not a fence at all": `${FULLWIDTH_FENCE}\n`,
  "a fullwidth tilde fence, which is not a fence at all": `${FULLWIDTH_TILDE}\n`,
  "a fullwidth comment opener, which is not a comment at all": `${FULLWIDTH_OPEN}\n`,
};

/**
 * Enclosing a line in a FULLWIDTH confusable must not hide it, because no renderer hides it.
 *
 * This is the opposite expectation from the ASCII `HIDERS` above and the distinction is the whole
 * point of the F1 fix: `｀｀｀` is literal text, so the line between two of them is still document
 * content, and the gate must grade it exactly as a reader reads it. Asserting it here rather than
 * leaving it implied is what keeps a future round from "hardening" the gate by folding these into
 * delimiters again.
 */
const FULLWIDTH_NON_HIDERS: Record<string, (line: string) => string> = {
  "a fullwidth fence": (line) => `${FULLWIDTH_FENCE}\n${line}\n${FULLWIDTH_FENCE}`,
  "a fullwidth comment": (line) => `${FULLWIDTH_OPEN}\n${line}\n${FULLWIDTH_CLOSE}`,
};

const CARRIER = {
  spec: "### FR-2 Second",
  trace: "| FR-2 | `lib/b.ts` | manual | manual: PR 2. | Verified |",
  tasks: row("T-2 Second", 2, "FR-2"),
};
const DOCS = { spec: SPEC, trace: TRACE, tasks: TASKS };
const DOC_FILE: Record<string, string> = { spec: "spec.md", trace: "traceability.md", tasks: "tasks.md" };

for (const [document, carrier] of Object.entries(CARRIER)) {
  for (const [hider, hide] of Object.entries(HIDERS)) {
    test(`FR-2's carrier enclosed in ${hider} in ${DOC_FILE[document]} is reported, never silently lost`, () => {
      // The direction every previous round failed in. Enclosing a line must produce a LOUD
      // finding naming the requirement, because identity comes from requirements.json and the
      // reconciliation then has an expected id with nothing to match it.
      const original = DOCS[document as keyof typeof DOCS];
      const mutated = original.replace(carrier, hide(carrier));
      assert.notEqual(mutated, original, "fixture did not mutate");
      const problems = run({ [document]: mutated });
      assert.ok(
        problems.some((p) => p.includes("FR-2")),
        `${hider} in ${document} was not reported: ${problems.join("; ")}`,
      );
    });
  }

  for (const [wrapper, wrap] of Object.entries(FULLWIDTH_NON_HIDERS)) {
    test(`${wrapper} around FR-2's carrier in ${DOC_FILE[document]} never silently loses FR-2`, () => {
      // The round-five regression, asserted per document. NFKC folded these onto ``` and `<!--`
      // BEFORE classification, so the enclosed line vanished from the gate while rendering
      // normally on github.com, and the gate printed "passed" over a requirement it had lost.
      //
      // The invariant is exactly that: either the carrier is still read (no problems), or the
      // loss is reported BY NAME. Silence with FR-2 gone is the only forbidden outcome. Both
      // legitimate outcomes occur: in `spec.md` the heading is still read, and in a TABLE a
      // literal junk line genuinely does end the table — in the renderer too — so the row below
      // falls outside the contract table and is reported as uncovered rather than certified.
      const original = DOCS[document as keyof typeof DOCS];
      const mutated = original.replace(carrier, wrap(carrier));
      assert.notEqual(mutated, original, "fixture did not mutate");
      const problems = run({ [document]: mutated });
      assert.ok(
        problems.length === 0 || problems.some((p) => p.includes("FR-2")),
        `${wrapper} in ${document} produced findings that do not name FR-2: ${problems.join("; ")}`,
      );
    });
  }

  for (const [leaker, prelude] of Object.entries(LEAKERS)) {
    test(`${leaker} does not delete FR-2 from ${DOC_FILE[document]}`, () => {
      // The fail-open direction: a document may legitimately contain these constructs, and the
      // lines after them must still be read.
      const original = DOCS[document as keyof typeof DOCS];
      assert.deepEqual(run({ [document]: prelude + "\n" + original }), [], `${leaker} leaked state`);
    });
  }
}

test("a leaked-fence prelude really does contain its inner delimiter, so the fixtures are honest", () => {
  for (const [name, prelude] of Object.entries(LEAKERS)) {
    const ctx = markdownBlockContext(prelude + "visible\n");
    assert.equal(ctx.unterminatedFence, false, name);
    assert.equal(ctx.unterminatedComment, false, name);
    assert.ok(
      ctx.lines.some((l: { kind: string; text: string }) => l.kind === "content" && l.text === "visible"),
      name,
    );
  }
});

test("an unterminated fence or comment is reported, never silently swallowed", () => {
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
  assert.deepEqual(requirementIds("### FR-1 real\n\n<!--\n### FR-99 not building this\n-->\n"), ["FR-1"]);
  assert.deepEqual(run({ spec: SPEC + "\n<!--\n### FR-99 shelved\n-->\n" }), []);
});

test("a requirement heading is found at any depth and any indentation", () => {
  assert.deepEqual(requirementIds("# FR-10 top\n#### FR-11 deep\n        ## FR-12 indented\n"), [
    "FR-10",
    "FR-11",
    "FR-12",
  ]);
});

test("indentation can never delete a requirement from spec.md", () => {
  assert.deepEqual(run({ spec: SPEC.replace(CARRIER.spec, "    " + CARRIER.spec) }), []);
});

test("a duplicate traceability row is an error, not a silent overwrite", () => {
  const trace = TRACE + "| FR-2 | `package.json` | none | draft, superseded | Draft |\n";
  assert.ok(
    run({ trace }).includes("FR-2 has more than one row in traceability.md — remove the duplicate"),
    run({ trace }).join("; "),
  );
});

test("a table that misdescribes its own columns is reported", () => {
  const trace = TRACE.replace(
    "| Requirement | Implementation | Tests | Evidence | Status |",
    "| Requirement | Status | Evidence | Tests | Implementation |",
  );
  assert.ok(run({ trace }).some((p) => p.startsWith("traceability.md table header is")));
  const tasks = TASKS.replace(
    "| Task | Pull request | Branch | Requirements | Status |",
    "| Status | Requirements | Branch | Pull request | Task |",
  );
  assert.ok(run({ tasks }).some((p) => p.startsWith("tasks.md table header is")));
});

test("a row with the wrong column count is reported rather than read at the wrong offset", () => {
  const tasks = TASKS.replace(
    row("T-2 Second", 2, "FR-2"),
    "| T-2 Second | [#2](https://github.com/edgeorgie/triage-desk/pull/2) | extra | `branch` | FR-2 | Merged |",
  );
  const problems = run({ tasks });
  assert.ok(problems.some((p) => p.startsWith("a tasks.md work item has 6 columns, expected 5")), problems.join("; "));
  assert.ok(problems.includes("FR-2 is in requirements.json but no tasks.md work item claims it"));
});

test("a pull request link to another repository, or disagreeing with its label, is reported", () => {
  assert.ok(
    run({ tasks: TASKS.replace("edgeorgie/triage-desk/pull/2", "torvalds/linux/pull/2") }).some((p) =>
      p.includes("is not an edgeorgie/triage-desk pull request"),
    ),
  );
  assert.ok(
    run({
      tasks: TASKS.replace(
        "[#2](https://github.com/edgeorgie/triage-desk/pull/2)",
        "[#2](https://github.com/edgeorgie/triage-desk/pull/1)",
      ),
    }).includes("T-2 Second links to pull request #1 but is labelled #2"),
  );
});

test("every link in the Pull request cell is graded, not only the first", () => {
  const tasks = TASKS.replace(
    "[#2](https://github.com/edgeorgie/triage-desk/pull/2)",
    "[#2](https://github.com/edgeorgie/triage-desk/pull/2) and [#3](https://github.com/other/repo/pull/3)",
  );
  assert.ok(run({ tasks }).some((p) => p.includes("https://github.com/other/repo/pull/3")));
});

test("negated prose in the Requirements cell is not a claim", () => {
  const tasks = TASKS.replace(
    row("T-2 Second", 2, "FR-2"),
    row("T-2 Second", 2, "explicitly NOT FR-2 — deferred, nothing shipped"),
  );
  const problems = run({ tasks });
  assert.ok(problems.some((p) => p.startsWith("T-2 Second has an unreadable Requirements cell")), problems.join("; "));
  assert.ok(problems.includes("FR-2 is in requirements.json but no tasks.md work item claims it"));
});

test("`none (quality)` exempts a row, never a requirement", () => {
  const withQualityRow = TASKS.replace(
    "Prose below",
    `${row("T-3 CI hardening", 3, "none (quality)")}\n\nProse below`,
  );
  assert.deepEqual(run({ tasks: withQualityRow }), []);
  const dodged = TASKS.replace(row("T-2 Second", 2, "FR-2"), row("T-2 Second", 2, "none (quality)"));
  assert.ok(run({ tasks: dodged }).includes("FR-2 is in requirements.json but no tasks.md work item claims it"));
});

test("a requirement claimed only by unmerged work is not covered", () => {
  for (const status of ["Abandoned", "In progress", "In review"]) {
    const tasks = TASKS.replace("| FR-2 | Merged |", `| FR-2 | ${status} |`);
    assert.deepEqual(run({ tasks }), [
      `FR-2 is claimed only by work items that are not merged: T-2 Second (${status})`,
    ]);
  }
});

test("a second merged row covers a requirement whose other claimant was abandoned", () => {
  const tasks = TASKS.replace(
    row("T-2 Second", 2, "FR-2"),
    `${row("T-2 Second", 2, "FR-2").replace("| Merged |", "| Abandoned |")}\n${row("T-3 Retry", 3, "FR-2")}`,
  );
  assert.deepEqual(run({ tasks }), []);
});

test("a pipe inside inline code or escaped does not make a legitimate row malformed", () => {
  const tasks = TASKS.replace("| T-2 Second |", "| T-2 Second `a|b` and c\\|d |");
  assert.deepEqual(run({ tasks }), []);
});

test("a document whose table parses to zero rows names itself instead of reporting a clean sheet", () => {
  assert.ok(
    run({ trace: "# Traceability\n\nThe table is being rewritten.\n" }).includes(
      "traceability.md parsed to zero requirement rows — the coverage check cannot run",
    ),
  );
  assert.ok(
    run({ tasks: "# Tasks\n\nThe table is being rewritten.\n" }).includes(
      "tasks.md parsed to zero work-item rows — the coverage check cannot run",
    ),
  );
});

test("a four-space-indented fence delimiter is an indented code block, not a fence", () => {
  const ctx = markdownBlockContext("    ```\nvisible\n");
  assert.equal(ctx.unterminatedFence, false);
  assert.ok(ctx.lines.some((l: { kind: string; text: string }) => l.kind === "content" && l.text === "visible"));
});

test("fence state is keyed on the delimiter character and its run length", () => {
  for (const doc of ["````\n```\ninside\n````\nafter\n", "~~~\n```\ninside\n~~~\nafter\n"]) {
    assert.deepEqual(
      markdownBlockContext(doc)
        .lines.filter((l: { kind: string }) => l.kind === "content")
        .map((l: { text: string }) => l.text),
      ["after"],
      doc,
    );
  }
});

test("an inline comment is stripped from a line rather than deleting the line", () => {
  const ctx = markdownBlockContext("a <!-- note --> b\n");
  assert.deepEqual(
    ctx.lines.filter((l: { kind: string }) => l.kind === "content").map((l: { text: string }) => l.text),
    ["a  b"],
  );
});

test("a fence delimiter inside an HTML comment does not open a block", () => {
  const ctx = markdownBlockContext("<!-- ``` -->\nafter\n");
  assert.equal(ctx.unterminatedFence, false);
  assert.ok(ctx.lines.some((l: { kind: string; text: string }) => l.kind === "content" && l.text === "after"));
});

test("the row readers expose first-table membership, so coverage and shape stay separable", () => {
  const rows = taskTableRows(TASKS + "\n" + row("T-9 Appendix", 9, "FR-2") + "\n");
  assert.deepEqual(
    rows.map((r: { cells: string[]; inFirstTable: boolean }) => [r.cells[1], r.inFirstTable]),
    [
      ["T-1 First", true],
      ["T-2 Second", true],
      ["T-9 Appendix", false],
    ],
  );
  assert.deepEqual(
    traceabilityRows(TRACE).map((r: { cells: string[]; inFirstTable: boolean }) => [r.cells[1], r.inFirstTable]),
    [
      ["FR-1", true],
      ["FR-2", true],
    ],
  );
});

// --- the real documents, adversarially --------------------------------------------------------

const ON_DISK = () => ({
  requirements: readFileSync("docs/spec/requirements.json", "utf8"),
  spec: readFileSync("docs/spec/spec.md", "utf8"),
  trace: readFileSync("docs/spec/traceability.md", "utf8"),
  tasks: readFileSync("docs/spec/tasks.md", "utf8"),
});

test("the real FR-8 (the CSP security requirement) cannot be removed by a fullwidth comment", () => {
  // The critic's headline reproduction, verbatim: FR-8 removed from all three documents with
  // characters that render as their original text, plus an unbuilt FR-22 planted. Before this
  // change the gate printed "spec check passed: 8 requirements traced" and exited 0.
  const docs = ON_DISK();
  const H = "### FR-8 Content Security Policy on the static export";
  const problems = checkSpec({
    ...docs,
    spec: docs.spec.replace(H, `${FULLWIDTH_OPEN}${H}${FULLWIDTH_CLOSE}`) +
      `\n${FULLWIDTH_FENCE}\n### FR-22 Unbuilt\n${FULLWIDTH_FENCE}\n`,
    trace: docs.trace.replace("| FR-8 |", `| ${FULLWIDTH_OPEN}FR-8${FULLWIDTH_CLOSE} |`),
    tasks: docs.tasks.replace("| T-6 Content Security Policy", `| ${FULLWIDTH_OPEN}T-6${FULLWIDTH_CLOSE} Content Security Policy`),
    exists: allExist,
  });
  assert.ok(problems.includes("FR-8 is declared in requirements.json but has no heading in spec.md"), problems.join("; "));
  assert.ok(problems.includes("spec.md declares FR-22, which requirements.json does not"), problems.join("; "));
  assert.ok(problems.includes("FR-8 is in requirements.json but missing from traceability.md"), problems.join("; "));
  assert.ok(problems.includes("FR-8 is in requirements.json but no tasks.md work item claims it"), problems.join("; "));
});

test("the real traceability.md, wholly commented out or wholly fenced, is not certified as traced", () => {
  const docs = ON_DISK();
  const lines = docs.trace.split("\n");
  const start = lines.findIndex((l) => l.startsWith("| Requirement |"));
  const end = lines.findLastIndex((l) => l.startsWith("| FR-"));
  assert.ok(start >= 0 && end > start, "fixture could not locate the real table");
  for (const [open, close] of [["<!--", "-->"], ["```", "```"]] as const) {
    const trace = [...lines.slice(0, start), open, ...lines.slice(start, end + 1), close, ...lines.slice(end + 1)].join("\n");
    const problems = checkSpec({ ...docs, trace, exists: allExist });
    assert.ok(
      problems.includes("traceability.md parsed to zero requirement rows — the coverage check cannot run"),
      problems.join("; "),
    );
    assert.ok(problems.includes("FR-1 is in requirements.json but missing from traceability.md"), problems.join("; "));
  }
});

test("every work item in the real tasks.md marked Abandoned is not certified as traced", () => {
  const docs = ON_DISK();
  const tasks = docs.tasks.replace(/\| Merged \|/g, "| Abandoned |");
  assert.notEqual(tasks, docs.tasks, "fixture did not mutate");
  assert.ok(
    checkSpec({ ...docs, tasks, exists: allExist }).some((p) =>
      p.startsWith("FR-1 is claimed only by work items that are not merged"),
    ),
  );
});

test("the real documents' prose cannot be read as contract rows", () => {
  const docs = ON_DISK();
  assert.deepEqual(checkSpec({ ...docs, exists: allExist }), [], "the real documents must pass first");
  assert.deepEqual(
    checkSpec({
      ...docs,
      spec: docs.spec + "\n<!--\n### FR-98 planted in prose\n-->\n\n```\n### FR-97 planted in a fence\n```\n",
      exists: allExist,
    }),
    [],
  );
});

// --- the structural anti-duplication guard, by SHAPE ------------------------------------------
//
// The guard this replaces asserted `source.match(/function fenceDelimiter/g).length === 1` and
// `source.match(/indexOf\("<!--"\)/g).length === 1` — a check on a SPELLING, not on duplicated
// logic. A cold review appended a second, fully working fence-and-comment parser with RENAMED
// helpers and `"<" + "!--"` instead of `"<!--"`, and the guard passed, 83/83 green. It only ever
// caught a verbatim copy-paste that kept both identifier spellings, which is not how a
// contributor adding a fourth document's parser would write it.
//
// Detection is therefore by SHAPE: the module's top-level functions are extracted and each body
// is scanned for block-structure PRIMITIVES — a backtick/tilde run match, an HTML comment
// delimiter however it is spelled or concatenated, a raw document split. The set of functions
// carrying any such primitive must equal a small closed allowlist, which gets its own assertion
// so it cannot quietly grow.

/** Functions permitted to contain block-structure primitives. Deliberately tiny. */
const BLOCK_STRUCTURE_OWNERS = ["fenceDelimiter", "markdownBlockContext"];

/** Strip line and block comments, so prose about `<!--` is not mistaken for code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
}

/**
 * Fold adjacent string-literal concatenations, so `"<" + "!--"` reads as `"<!--"`.
 *
 * This is the exact evasion that defeated the previous guard, so it is normalised away rather
 * than enumerated.
 */
function foldConcatenatedStrings(source: string): string {
  let out = source;
  for (let i = 0; i < 8; i += 1) {
    const next = out.replace(/(["'])([^"'\n]*)\1\s*\+\s*(["'])([^"'\n]*)\3/g, (_m, q, a, _q2, b) => `${q}${a}${b}${q}`);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Top-level `function name(...) { ... }` declarations, as `{ name, body }`, by brace matching. */
function topLevelFunctions(source: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const decl = /(?:^|\n)\s*(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(source)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
    }
    out.push({ name: m[1], body: source.slice(m.index + m[0].length, i - 1) });
  }
  return out;
}

/** Block-structure primitives, by shape rather than by any known identifier name. */
function blockStructurePrimitives(body: string): string[] {
  const found: string[] = [];
  // A run-of-three-or-more fence delimiter matcher, however the regex is written.
  if (/(?:`|~|\\u0060|\\u007e)\s*\{\s*3\s*,/.test(body) || /```|~~~/.test(body)) found.push("a fence delimiter run");
  // An HTML comment delimiter, after string concatenation is folded.
  if (/<!--|-->/.test(body)) found.push("an HTML comment delimiter");
  // Splitting a document into raw lines is the entry point of a hand-rolled block parser.
  if (/\.split\(\s*(["'])\\n\1\s*\)/.test(body)) found.push("a raw document line split");
  return found;
}

test("block structure is classified in exactly one place, detected by shape and not by name", () => {
  const source = foldConcatenatedStrings(stripComments(readFileSync("scripts/check-spec.mjs", "utf8")));
  const functions = topLevelFunctions(source);
  assert.ok(functions.length >= 10, `the function scanner found only ${functions.length} functions — it is broken`);

  const carriers = functions
    .filter((f) => blockStructurePrimitives(f.body).length > 0)
    .map((f) => f.name)
    .sort();
  assert.deepEqual(
    carriers,
    [...BLOCK_STRUCTURE_OWNERS].sort(),
    `block-structure handling must exist only in ${BLOCK_STRUCTURE_OWNERS.join(" and ")}, but these functions contain it: ${carriers.join(", ")}`,
  );
});

test("the shape scanner really detects a RENAMED duplicate parser, so the guard above is not vacuous", () => {
  // Mutation-validation of the guard itself, against the exact case that defeated its
  // predecessor: a second working parser whose helpers are renamed and whose comment delimiter
  // is assembled by concatenation. A guard never observed failing may be passing vacuously.
  const renamedDuplicate = `
function blockDelimiter(line) {
  const m = line.trim().match(/^(\\\`{3,}|~{3,})/);
  return m ? m[1] : null;
}
export function constitutionIds(doc) {
  const ids = [];
  let fence = null;
  let inComment = false;
  for (const raw of doc.split("\\n")) {
    const delim = blockDelimiter(raw);
    if (fence) { if (delim && delim[0] === fence[0]) fence = null; continue; }
    if (delim) { fence = delim; continue; }
    let line = raw;
    const open = line.indexOf("<" + "!--");
    if (open !== -1) line = line.slice(0, open);
    const m = line.match(/^#+\\s+(FR-\\d+)\\b/);
    if (m) ids.push(m[1]);
  }
  return ids;
}
`;
  const real = readFileSync("scripts/check-spec.mjs", "utf8");
  const mutated = foldConcatenatedStrings(stripComments(real + renamedDuplicate));
  const carriers = topLevelFunctions(mutated)
    .filter((f) => blockStructurePrimitives(f.body).length > 0)
    .map((f) => f.name);
  // Both halves of the duplicate are detected despite neither name appearing in the allowlist.
  assert.ok(carriers.includes("blockDelimiter"), `renamed fence helper missed: ${carriers.join(", ")}`);
  assert.ok(carriers.includes("constitutionIds"), `renamed comment+split parser missed: ${carriers.join(", ")}`);
  // And a verbatim copy-paste, the only case the old guard caught, is still detected.
  const verbatim = foldConcatenatedStrings(
    stripComments(real + renamedDuplicate.replace(/blockDelimiter/g, "fenceDelimiter2").replace('"<" + "!--"', '"<!--"')),
  );
  assert.ok(
    topLevelFunctions(verbatim)
      .filter((f) => blockStructurePrimitives(f.body).length > 0)
      .map((f) => f.name)
      .includes("fenceDelimiter2"),
  );
});

test("the block-structure allowlist stays disjoint from the rest of the module's functions", () => {
  // A shape-based check needs a closed allowlist of deliberate owners; without its own guard the
  // allowlist is where the next near-copy would be quietly added.
  const source = stripComments(readFileSync("scripts/check-spec.mjs", "utf8"));
  const names = topLevelFunctions(source).map((f) => f.name);
  for (const owner of BLOCK_STRUCTURE_OWNERS) {
    assert.ok(names.includes(owner), `${owner} is on the allowlist but is not a function in the module`);
  }
  assert.equal(new Set(BLOCK_STRUCTURE_OWNERS).size, BLOCK_STRUCTURE_OWNERS.length);
  assert.ok(BLOCK_STRUCTURE_OWNERS.length <= 2, "the allowlist must not grow silently");
});

test("no parser reads the raw document except the one shared block reader", () => {
  // The inverted form of the same property, and the cheapest one to keep true: every document
  // reader must go through `markdownBlockContext`, so there is one implementation of "what counts
  // as document content" to close a bypass in.
  const source = foldConcatenatedStrings(stripComments(readFileSync("scripts/check-spec.mjs", "utf8")));
  const splitters = topLevelFunctions(source)
    .filter((f) => /\.split\(\s*(["'])\\n\1\s*\)/.test(f.body))
    .map((f) => f.name);
  assert.deepEqual(splitters, ["markdownBlockContext"], `raw document splits outside the shared reader: ${splitters.join(", ")}`);
});
