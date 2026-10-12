import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canonicaliseId,
  checkSpec,
  declaredIdLock,
  loadRequirements,
  markdownBlockContext,
  reconcileDeclaredIds,
  requirementIds,
  specRequirementSections,
  taskTableRows,
  traceabilityRows,
} from "../scripts/check-spec.mjs";

// `spec:check` is a step inside the `verify` gate required on `main`. SIX consecutive rounds of
// cold review each landed a working bypass against it. Rounds one to five patched CHARACTERS and
// the fifth shipped a REGRESSION (NFKC applied before fence classification, so fullwidth text
// folded INTO the gate's own delimiters). Round six changed the shape of the problem: requirement
// IDENTITY comes from `docs/spec/requirements.json` and the markdown is RECONCILED against it, so
// a line hidden in markdown can no longer shrink the gate's subject.
//
// Round seven — what this suite is now written against — closes what round six left behind. Round
// six hardened IDENTITY and left COLLECTION alone: every grader only saw lines a regex had already
// accepted as rows or headings, and the failure mode of those regexes was silence. So there are
// now THREE axes this suite crosses deliberately, and the third is the new one:
//
//   - the CHARACTER-SET axis (fullwidth delimiter synthesis, zero-width joiners, bidi overrides),
//   - the GRADED-VS-COUNTED axis (rows past a table terminator were parsed and never graded),
//   - the COLLECTED-VS-GRADED axis: a line that does not look like a row to the collection regex
//     was never graded at all, while rendering to a reader as an ordinary contract row.
//
// Each guard below is mutation-validated — reintroduce the real defect at the real site and watch
// the named finding disappear — because a guard never observed failing may be passing vacuously,
// and across six rounds that has been this gate's entire failure history.

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

/** The lock for the fixture set, computed the same way `npm run spec:lock` computes the real one. */
const LOCK = JSON.stringify(declaredIdLock(["FR-1", "FR-2"]));

const SPEC = `# Spec

### FR-1 First

- Given a thing, then it works.

### FR-2 Second

- Given another thing, then it also works.
`;

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
  over: Partial<{ requirements: string; lock: string; spec: string; trace: string; tasks: string }> = {},
): string[] =>
  checkSpec({
    requirements: REQS,
    lock: LOCK,
    spec: SPEC,
    trace: TRACE,
    tasks: TASKS,
    exists: allExist,
    ...over,
  });

const ON_DISK = () => ({
  requirements: readFileSync("docs/spec/requirements.json", "utf8"),
  lock: readFileSync("docs/spec/requirements.lock.json", "utf8"),
  spec: readFileSync("docs/spec/spec.md", "utf8"),
  trace: readFileSync("docs/spec/traceability.md", "utf8"),
  tasks: readFileSync("docs/spec/tasks.md", "utf8"),
  exists: allExist,
});

/** Fullwidth forms that NFKC folds onto the delimiters this gate greps for. */
const FULLWIDTH_FENCE = "\uff40\uff40\uff40"; // U+FF40 x3 -> ```
const FULLWIDTH_TILDE = "\uff5e\uff5e\uff5e"; // U+FF5E x3 -> ~~~
const FULLWIDTH_OPEN = "\uff1c\uff01\uff0d\uff0d"; // U+FF1C U+FF01 U+FF0D U+FF0D -> comment opener
const FULLWIDTH_CLOSE = "\uff0d\uff0d\uff1e"; // U+FF0D U+FF0D U+FF1E -> comment closer

test("a complete, consistent document set yields no problems", () => {
  assert.deepEqual(run(), []);
});

test("this repository's own specification documents pass", () => {
  // The suite's fixtures could all be satisfied by a parser that is wrong about the real files,
  // so assert against the documents actually on disk as well. A hardening change that
  // false-positives on the real documents is its own defect.
  assert.deepEqual(checkSpec(ON_DISK()), []);
});

// --- the structured source of truth is the gate's subject -------------------------------------

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
  const lock = JSON.stringify(declaredIdLock(["FR-1", "FR-2", "FR-3"]));
  const problems = run({ requirements, lock });
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
    // `acceptance` is the requirement's substantive content. Round six read it NOWHERE.
    ["acceptance", { ...base, acceptance: undefined }],
    ["acceptance", { ...base, acceptance: [] }],
    ["acceptance", { ...base, acceptance: "whatever" }],
    ["acceptance", { ...base, acceptance: ["  "] }],
    ["acceptance", { ...base, acceptance: [42] }],
  ];
  for (const [field, entry] of cases) {
    const problems = run({ requirements: JSON.stringify([entry, JSON.parse(REQS)[1]]) });
    assert.ok(
      problems.some((p) => p.includes("has a missing or unreadable") && p.includes(field)),
      `${field} (${JSON.stringify(entry.acceptance)}): ${problems.join("; ")}`,
    );
  }
});

// --- H-3: the gate's own subject has a PERSISTED witness ---------------------------------------
//
// Round six fixed the DERIVATION of the printed count (it comes from `loadRequirements`, not from
// the markdown parse) and stopped there. But after round six the SUBJECT is `requirements.json`,
// so truncating that file is the attack — and a count a gate derives from its own subject cannot
// witness that subject shrinking. A cold review removed FR-8 coherently from all four documents
// and the real entry point printed `spec check passed: 8 requirements traced` and exited 0. The
// only thing that caught it was a bare literal `9` in a test about something else: an accidental
// witness, uncommented, and routinely edited to make the suite green.
//
// The witness is now persisted outside the subject, and `spec:check` ITSELF fails on drift.

test("a requirement removed from requirements.json is reported against the persisted lock", () => {
  const requirements = JSON.stringify([JSON.parse(REQS)[0]]);
  const problems = run({ requirements });
  assert.ok(
    problems.some((p) =>
      p.startsWith("FR-2 is recorded in requirements.lock.json but is no longer declared in requirements.json"),
    ),
    problems.join("; "),
  );
});

test("a requirement added to requirements.json without updating the lock is reported", () => {
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
  assert.ok(
    run({ requirements }).some((p) =>
      p.startsWith("FR-3 is declared in requirements.json but is not recorded in requirements.lock.json"),
    ),
  );
});

test("swapping one requirement for another keeps the COUNT and is still reported by id", () => {
  // The count-only witness the previous round relied on cannot see this at all: nine in, nine out.
  const parsed = JSON.parse(REQS);
  parsed[1] = {
    id: "FR-3",
    title: "Third",
    status: "Verified",
    acceptance: ["Given a third thing."],
    implementation: ["lib/c.ts"],
    tests: ["tests/c.test.ts"],
    evidence: "PR 3.",
  };
  const problems = run({ requirements: JSON.stringify(parsed) });
  assert.equal(parsed.length, JSON.parse(REQS).length, "the fixture must keep the count identical");
  assert.ok(problems.some((p) => p.startsWith("FR-2 is recorded in requirements.lock.json")), problems.join("; "));
  assert.ok(
    problems.some((p) => p.includes("FR-3 is declared in requirements.json but is not recorded")),
    problems.join("; "),
  );
});

test("editing the lock's own id list without recomputing its checksum is reported", () => {
  // Otherwise the witness is self-certifying: delete the requirement, delete it from the lock, done.
  const lock = JSON.parse(LOCK);
  lock.ids = ["FR-1"];
  const problems = run({ lock: JSON.stringify(lock) });
  assert.ok(problems.some((p) => p.includes("checksum does not match the id list it records")), problems.join("; "));
  assert.ok(problems.some((p) => p.includes("records a count of 2 but lists 1 ids")), problems.join("; "));
});

test("an unreadable or absent lock is a missing witness, not a clean sheet", () => {
  for (const [lock, needle] of [
    ["{ not json", "requirements.lock.json is not valid JSON"],
    ["[]", "must record a numeric count, an array of ids and a sha256"],
    ['{"ids":["FR-1","FR-2"]}', "must record a numeric count, an array of ids and a sha256"],
    ['{"count":2,"ids":[1,2],"sha256":"x"}', "must record a numeric count, an array of ids and a sha256"],
  ] as const) {
    assert.ok(run({ lock }).some((p) => p.includes(needle)), `${lock}: ${run({ lock }).join("; ")}`);
  }
  const problems = checkSpec({
    requirements: REQS,
    spec: SPEC,
    trace: TRACE,
    tasks: TASKS,
    exists: allExist,
  });
  assert.ok(
    problems.includes("requirements.lock.json was not read — the gate has no witness for its own subject"),
    problems.join("; "),
  );
});

test("the lock on disk matches the requirements on disk, and the gate is what enforces that", () => {
  // Not an assertion on a hardcoded number: the expected value is recomputed from the file the
  // lock describes, so adding FR-10 legitimately means running `npm run spec:lock`, which puts the
  // new id in a reviewable diff, rather than editing a literal in a test to make the suite green.
  const docs = ON_DISK();
  const declared = loadRequirements(docs.requirements, []);
  if (declared === null) throw new Error("requirements.json on disk is not a readable subject");
  const problems: string[] = [];
  reconcileDeclaredIds(docs.lock, declared, problems);
  assert.deepEqual(problems, [], "run `npm run spec:lock` to regenerate docs/spec/requirements.lock.json");
  assert.deepEqual(JSON.parse(docs.lock), declaredIdLock(declared.map((r: { id: string }) => r.id)));
});

test("the printed count is read from the structured source, not from the markdown parse", () => {
  const source = readFileSync("scripts/check-spec.mjs", "utf8");
  const printer = source.slice(source.lastIndexOf("spec check passed"));
  assert.ok(!/requirementIds\(/.test(printer), "the printed count must not be derived from the markdown parse");
  // And the entry point must READ the lock, or the witness above is dead code in production.
  const entry = source.slice(source.lastIndexOf("process.argv[1]"));
  assert.ok(/requirements\.lock\.json/.test(entry), "the entry point must read the persisted lock");
  assert.ok(/checkSpec\(\{[^}]*\block\b/.test(entry), "the lock must be passed to checkSpec");
});

// --- C-1: the loose id pre-filter FAILS LOUD ---------------------------------------------------
//
// `looksLikeRequirementId` was a loose filter whose failure mode was `continue`, guarding entry
// into a strict check whose failure mode was an error. The loose filter was therefore the real
// allowlist, and it was attacker-steerable: `/^FR-\d/` over the canonical form failed at position
// 0 for `"\u2066FR-22"`, so a heading rendering on github.com as `FR-22 Delete any repository the
// agent can reach` was skipped in silence. Removal was loud, PLANTING was silent, and the claim
// "reconciliation is bidirectional" was true only for ids spelled the way the gate expected.

/**
 * Codepoints that are invisible or vanish in a renderer, each of which has been or could be used
 * to spell an id the gate declined to recognise. U+2066 is the one a sixth cold review landed.
 *
 * This list exists to be ATTACKED, not to define what the gate accepts: acceptance is an ASCII
 * allow-list, so a codepoint absent from this list is still rejected. That is the difference
 * between this round and the five that patched a deny-list.
 */
const INVISIBLE_ATTACKS: Record<string, string> = {
  "U+2066 LEFT-TO-RIGHT ISOLATE": "\u2066",
  "U+2067 RIGHT-TO-LEFT ISOLATE": "\u2067",
  "U+2068 FIRST STRONG ISOLATE": "\u2068",
  "U+2069 POP DIRECTIONAL ISOLATE": "\u2069",
  "U+FE00 VARIATION SELECTOR-1": "\ufe00",
  "U+FE0F VARIATION SELECTOR-16": "\ufe0f",
  "U+180E MONGOLIAN VOWEL SEPARATOR": "\u180e",
  "U+115F HANGUL CHOSEONG FILLER": "\u115f",
  "U+1160 HANGUL JUNGSEONG FILLER": "\u1160",
  "U+3164 HANGUL FILLER": "\u3164",
  "U+FFA0 HALFWIDTH HANGUL FILLER": "\uffa0",
  "U+200B ZERO WIDTH SPACE": "\u200b",
  "U+200D ZERO WIDTH JOINER": "\u200d",
  "U+202E RIGHT-TO-LEFT OVERRIDE": "\u202e",
  "U+2062 INVISIBLE TIMES": "\u2062",
  "U+00AD SOFT HYPHEN": "\u00ad",
  "U+FEFF ZERO WIDTH NO-BREAK SPACE": "\ufeff",
  // Not invisible, but equally not ASCII: a codepoint nobody thought to deny-list.
  "U+0405 CYRILLIC DZE": "\u0405",
  "U+1D5D9 MATHEMATICAL SANS-SERIF BOLD CAPITAL F": "\u{1d5d9}",
};

for (const [name, ch] of Object.entries(INVISIBLE_ATTACKS)) {
  test(`PLANTING \`### <${name}>FR-22\` in spec.md is a named finding, not silence`, () => {
    const spec = SPEC + `\n### ${ch}FR-22 Delete any repository the agent can reach\n`;
    const problems = run({ spec });
    // The invariant is not a particular message — it is that the planted requirement a reader
    // sees produces a finding that NAMES it. Two legitimate shapes reach that: the id check
    // rejects the token, or (for a codepoint JS regex `\s` already eats, e.g. U+FEFF) the token
    // parses as a plain FR-22 and the reconciliation reports an undeclared requirement. Asserting
    // only one message is how a fixture stops tracking the property it was written for.
    assert.ok(
      problems.some((p) => p.includes("FR-22")),
      `${name} was planted with no finding naming FR-22: ${problems.join("; ") || "(silence)"}`,
    );
  });

  test(`REMOVING the real FR-2 heading with <${name}> is never a SILENT loss`, () => {
    // The implication form, which silence-with-loss cannot satisfy: either the heading is still
    // read as FR-2 (no loss, so no finding is owed), or FR-2 has left the heading set and the
    // gate must say so by name. A disjunction of "no problems OR a report" would also pass if a
    // future change made the heading vanish quietly; this will not.
    const spec = SPEC.replace("### FR-2 Second", `### ${ch}FR-2 Second`);
    const problems = run({ spec });
    if (requirementIds(spec).includes("FR-2")) {
      assert.deepEqual(problems, [], `${name}: FR-2 is still read, so there is nothing to report`);
    } else {
      assert.ok(
        problems.some((p) => p.includes("FR-2")),
        `${name}: FR-2 left the heading set with no finding naming it: ${problems.join("; ") || "(silence)"}`,
      );
    }
  });
}

test("the id pre-filter is aggressive enough that no spelling of an id reaches silence", () => {
  // Property form of the per-codepoint cases above, and the one that would catch a NEW codepoint
  // nobody has thought of: for every spelling that a reader reads as a requirement id, the gate
  // must emit a finding. Silence is the only forbidden outcome.
  const spellings = [
    "FR-22",
    "fr-22",
    "\uff26\uff32\uff0d\uff12\uff12",
    "FR\u20112",
    "FR\u20132",
    "F\u0301R-22",
    "\u2066FR\u2069-22",
    "F\u200bR\u200b-\u200b2\u200b2",
    "FR\u2060-22",
    "F\uff52-22",
  ];
  for (const token of spellings) {
    const problems = run({ spec: SPEC + `\n### ${token} Smuggled\n` });
    assert.notEqual(problems.length, 0, `\`### ${token}\` produced SILENCE`);
  }
});

test("ordinary spec.md headings are not mistaken for requirement ids", () => {
  // The cost of an aggressive pre-filter is false positives, so the real document's own section
  // headings are asserted to stay clear of it.
  for (const heading of [
    "## Baseline",
    "## Users",
    "## Goals",
    "## Non-goals",
    "## Requirements",
    "## Open risks",
    "# Specification: triage-desk",
    "### Framework notes",
    "### Frontend",
  ]) {
    assert.deepEqual(requirementIds(`# Spec\n\n${heading}\n`), [], heading);
  }
});

test("canonicaliseId rejects any non-ASCII codepoint in an id, not just deny-listed ones", () => {
  // Round six's `conforming` test was `canonical === token`, which passes for any codepoint NFKC
  // leaves alone and no deny-list names — U+2066 was exactly such a codepoint. The allowlist is
  // `[A-Za-z0-9-]`, so there is no "next character" to find.
  assert.deepEqual(canonicaliseId("FR-8"), { canonical: "FR-8", conforming: true });
  assert.deepEqual(canonicaliseId("T-13"), { canonical: "T-13", conforming: true });
  for (const token of [
    "fr-8",
    "FR\u20118",
    "F\u200dR-8",
    "\u202eFR-8",
    "\uff26\uff32\uff0d\uff18",
    "FR-8\ufeff",
    "\u2066FR-8",
    "FR-8\ufe0f",
    "\u3164FR-8",
    "FR-8\u180e",
  ]) {
    assert.equal(canonicaliseId(token).conforming, false, `${token} must not be accepted as already canonical`);
  }
});

test("the ASCII allowlist is redundant by construction, and that is asserted rather than assumed", () => {
  // Honesty about a guard that does NOT turn this suite red when removed. Acceptance at every
  // call site is `conforming && <anchored ASCII pattern>`, which already implies the token was
  // ASCII — so `ASCII_ID` inside `canonicaliseId` is defence in depth, not the operative check.
  // This search is what justifies saying so: over the BMP and the mathematical-alphanumeric
  // blocks, inserted at every position of a real id, the allowlist never decides an outcome the
  // anchored pattern had not already decided. If a future change loosens `REQUIREMENT_ID`, this
  // test starts failing and the allowlist becomes load-bearing — which is the point of keeping it.
  const strictOnly = (token: string) => {
    const { canonical } = canonicaliseId(token);
    return canonical === token && (/^FR-[1-9][0-9]*$/.test(canonical) || /^T-[1-9][0-9]*$/.test(canonical));
  };
  const divergences: string[] = [];
  for (const base of ["FR-8", "FR-22", "T-13", "fr-8"]) {
    for (const [lo, hi] of [
      [0x20, 0x3000],
      [0xfe00, 0xff70],
      [0x1d400, 0x1d7ff],
    ] as const) {
      for (let cp = lo; cp <= hi; cp += 1) {
        const ch = String.fromCodePoint(cp);
        for (let i = 0; i <= base.length; i += 1) {
          const token = base.slice(0, i) + ch + base.slice(i);
          if (strictOnly(token) !== (strictOnly(token) && /^[A-Za-z0-9-]+$/.test(token))) {
            divergences.push(`U+${cp.toString(16)} in ${JSON.stringify(token)}`);
          }
        }
      }
    }
  }
  assert.deepEqual(divergences.slice(0, 5), [], "the allowlist is now load-bearing — update the comment in the gate");
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
  assert.ok(!problems.some((p) => p.includes("has 2 headings")), problems.join("; "));
});

test("a confusable in a Requirements cell cannot alias a claim onto another requirement", () => {
  const tasks = TASKS.replace(row("T-2 Second", 2, "FR-2"), row("T-2 Second", 2, "FR-2\u200d2"));
  const problems = run({ tasks });
  assert.ok(problems.some((p) => p.includes("has an unreadable Requirements cell")), problems.join("; "));
  assert.ok(problems.includes("FR-2 is in requirements.json but no tasks.md work item claims it"), problems.join("; "));
});

// --- C-2: every pipe row in a table region is COLLECTED and graded -----------------------------
//
// Round six's headline fix graded "every MATCHING row", and matching was the attacker's choice.
// `tableRows` took a `rowPattern` of `/^\|\s*\S*T-\d/` and skipped every line that did not match,
// so a row whose first cell read `Task 13 Disable CSP` rather than `T-13 Disable CSP` was never
// collected — not column-counted, not citation-graded, not status-graded — INSIDE the live first
// table, while rendering as a perfectly ordinary contract row. There is no row pattern any more.

const UNCOLLECTABLE_TASK_ROW =
  "| Task 13 Disable CSP | [#1](https://github.com/attacker/evil/pull/1) | `main` | FR-8 | Shipped to production |";
const UNCOLLECTABLE_TRACE_ROW = "| Requirement 8 | `scripts/csp.mjs` | none | nothing was ever tested | Shipped |";

test("a row with no readable id INSIDE the first table is collected and graded, not skipped", () => {
  const tasks = TASKS.replace(
    row("T-2 Second", 2, "FR-2"),
    row("T-2 Second", 2, "FR-2") + "\n" + UNCOLLECTABLE_TASK_ROW,
  );
  const collected = taskTableRows(tasks).map((r: { cells: string[] }) => r.cells[1]);
  assert.ok(collected.includes("Task 13 Disable CSP"), `the row was never collected: ${collected.join(", ")}`);

  const problems = run({ tasks });
  assert.ok(
    problems.some((p) => p.includes('is a table row whose id is "Task"')),
    `unreadable id ungraded: ${problems.join("; ")}`,
  );
  assert.ok(
    problems.some((p) => p.includes("is not an edgeorgie/triage-desk pull request")),
    `citation ungraded: ${problems.join("; ")}`,
  );
  assert.ok(
    problems.some((p) => p.includes('has status "Shipped to production"')),
    `status ungraded: ${problems.join("; ")}`,
  );
});

test("a traceability row with no readable id inside the first table is collected and graded", () => {
  const trace = TRACE + UNCOLLECTABLE_TRACE_ROW + "\n";
  const collected = traceabilityRows(trace).map((r: { cells: string[] }) => r.cells[1]);
  assert.ok(collected.includes("Requirement 8"), `the row was never collected: ${collected.join(", ")}`);
  const problems = run({ trace });
  assert.ok(problems.some((p) => p.includes('is a table row whose id is "Requirement"')), problems.join("; "));
  assert.ok(problems.some((p) => p.includes('has status "Shipped"')), problems.join("; "));
});

test("an id-less row does not CLAIM the requirement its Requirements cell names", () => {
  // The attack's goal was a row a reader believes delivers FR-2. Grading it is half the fix; the
  // other half is that it must not be allowed to cover anything either.
  const tasks = TASKS.replace(
    row("T-2 Second", 2, "FR-2"),
    "| Task 2 Second | [#2](https://github.com/edgeorgie/triage-desk/pull/2) | `branch` | FR-2 | Merged |",
  );
  assert.ok(run({ tasks }).includes("FR-2 is in requirements.json but no tasks.md work item claims it"));
});

test("a row past the table terminator is GRADED for shape, not merely uncounted", () => {
  const smuggled =
    "| T-12 Unaudited work | [#99](https://github.com/torvalds/linux/pull/99) | `x` | none (quality) | NOT A REAL STATUS |";
  for (const tasks of [
    TASKS + `\n${smuggled}\n`, // below the prose terminator
    TASKS.replace("Prose below the table.", "```\n```\n" + smuggled), // below a fence
  ]) {
    const problems = run({ tasks });
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
  // are answered separately, and this asserts the coverage half did not widen.
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

test("EVERY table's header is validated, not only the first", () => {
  // Round six latched header validation with a `headerChecked` flag, so a second table that lied
  // about its own columns was graded by the FIRST table's positional indices and produced
  // confusing-but-wrong findings instead of "this table misdescribes its columns".
  const tasks =
    TASKS +
    "\n## Appendix of shipped work\n\n| Task | Status | Branch | Requirements | Pull request |\n|---|---|---|---|---|\n" +
    "| T-50 Disable CSP | Merged | `main` | [#1](https://github.com/attacker/evil/pull/1) | FR-8 |\n";
  const problems = run({ tasks });
  assert.ok(
    problems.some((p) =>
      p.startsWith("tasks.md table header is `Task | Status | Branch | Requirements | Pull request`"),
    ),
    problems.join("; "),
  );
  const trace =
    TRACE +
    "\n## Appendix\n\n| Requirement | Status | Evidence | Tests | Implementation |\n|---|---|---|---|---|\n| FR-1 | Verified | x | y | z |\n";
  assert.ok(run({ trace }).some((p) => p.startsWith("traceability.md table header is")), run({ trace }).join("; "));
});

test("a table region with no separator row is all rows, and all of them are graded", () => {
  // A header is recognised the way markdown recognises one: a row immediately followed by a
  // `|---|---|` separator. A pipe block without one is not a table with a free first line.
  const tasks = TASKS + "\nAppendix.\n\n" + UNCOLLECTABLE_TASK_ROW + "\n";
  const problems = run({ tasks });
  assert.ok(problems.some((p) => p.includes('is a table row whose id is "Task"')), problems.join("; "));
  assert.ok(problems.some((p) => p.includes("is not an edgeorgie/triage-desk pull request")), problems.join("; "));
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

// --- H-4: acceptance criteria are the requirement's substance and are reconciled ---------------
//
// Round six certified identity and five metadata fields. The `acceptance` array — the actual
// testable criteria, e.g. FR-8's CSP allowlist naming four hosts — was read NOWHERE in the gate
// (zero grep hits), so the requirement's MEANING could be inverted in the prose, in the JSON, or
// in both, with no finding. A security requirement whose criterion now permits any origin passed
// a gate whose stated purpose is to stop exactly that.

test("rewriting an acceptance criterion in spec.md is reported, naming the requirement", () => {
  const spec = SPEC.replace("- Given another thing, then it also works.", "- Given anything, then anything at all.");
  const problems = run({ spec });
  assert.ok(
    problems.some((p) => p.startsWith("FR-2's acceptance criterion 1 in spec.md") && p.includes("anything at all")),
    problems.join("; "),
  );
});

test("rewriting an acceptance criterion in requirements.json is reported too — both directions", () => {
  const parsed = JSON.parse(REQS);
  parsed[1].acceptance = ["Given anything, then anything at all."];
  assert.ok(
    run({ requirements: JSON.stringify(parsed) }).some((p) =>
      p.startsWith("FR-2's acceptance criterion 1 in spec.md"),
    ),
  );
});

test("dropping or adding an acceptance criterion changes the count and is reported", () => {
  const dropped = SPEC.replace("\n- Given another thing, then it also works.\n", "\n");
  assert.ok(
    run({ spec: dropped }).some(
      (p) => p === "FR-2 has 0 acceptance criteria under its heading in spec.md but 1 in requirements.json",
    ),
    run({ spec: dropped }).join("; "),
  );
  const added = SPEC + "\n- Given a smuggled extra criterion, then it is unproven.\n";
  assert.ok(
    run({ spec: added }).some((p) =>
      p.includes("acceptance criteria under its heading in spec.md but 1 in requirements.json"),
    ),
    run({ spec: added }).join("; "),
  );
});

test("inline code markup and whitespace are presentation, so the real documents reconcile", () => {
  // spec.md legitimately writes `NEXT_PUBLIC_POSTHOG_KEY` where the JSON stores it bare. Backticks
  // and run-length whitespace fold; every WORD must still agree exactly.
  const spec = SPEC.replace(
    "- Given another thing, then it also works.",
    "- Given   another `thing`, then it also works.",
  );
  assert.deepEqual(run({ spec }), []);
});

test("a criterion list is bounded by the first contiguous bullet run, so a Non-goals list is not conflated", () => {
  // FR-9 in the real spec.md carries a `Non-goals:` list after its criteria. Reading every bullet
  // under a heading would make those four lines phantom acceptance criteria.
  const spec = SPEC + "\nNon-goals:\n\n- Something explicitly not built.\n- Something else.\n";
  assert.deepEqual(run({ spec }), []);
  const sections = specRequirementSections(spec);
  assert.deepEqual(
    sections.map((s: { id: string; acceptance: unknown[] }) => [s.id, s.acceptance.length]),
    [
      ["FR-1", 1],
      ["FR-2", 1],
    ],
  );
});

// --- M-5: the title check is anchored to the heading line ---------------------------------------

test("the title check reads THE heading line, so a decoy prose line cannot satisfy it", () => {
  // Round six searched all content lines for `l.text.replace(/^#+\s+/, "") === want`, and the
  // `replace` was optional, so a line with no hashes matched just as well: renaming a heading and
  // adding a paragraph carrying the old title passed green.
  const renamed = SPEC.replace("### FR-2 Second", "### FR-2 Optional analytics toggle");
  const withDecoy = renamed + "\nFR-2 Second\n";
  for (const [label, spec] of [
    ["with a decoy prose line", withDecoy],
    ["control, no decoy", renamed],
  ] as const) {
    const problems = run({ spec });
    assert.ok(
      problems.some(
        (p) =>
          p.startsWith("FR-2's heading in spec.md does not match") && p.includes('reads "Optional analytics toggle"'),
      ),
      `${label}: ${problems.join("; ")}`,
    );
  }
});

test("a decoy heading for the same id cannot satisfy a requirement's title", () => {
  const spec = SPEC.replace("### FR-2 Second", "### FR-2 Wrong") + "\n#### FR-2 Second\n";
  assert.ok(run({ spec }).some((p) => p.startsWith("FR-2's heading in spec.md does not match")));
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

  for (const [leaker, prelude] of Object.entries(LEAKERS)) {
    test(`${leaker} does not delete FR-2 from ${DOC_FILE[document]}`, () => {
      // The fail-open direction: a document may legitimately contain these constructs, and the
      // lines after them must still be read.
      const original = DOCS[document as keyof typeof DOCS];
      assert.deepEqual(run({ [document]: prelude + "\n" + original }), [], `${leaker} leaked state`);
    });
  }
}

// --- the MUST-NOT-HIDE table, asserted per outcome rather than as a disjunction ----------------
//
// Enclosing a line in a FULLWIDTH confusable must not hide it, because no renderer hides it. This
// is the OPPOSITE expectation from the ASCII `HIDERS` above and the distinction is the whole point
// of round six's F1 fix: `｀｀｀` is literal text, so a line between two of them is still document
// content and must still be graded.
//
// Round six asserted that as a disjunction — `problems.length === 0 || problems.some(includes
// "FR-2")` — and a cold review measured which branch each document actually took. `spec` took the
// silent branch; `trace` and `tasks` took the reported branch. The invariant held in practice but
// was not ENFORCED: a future change that made the trace row silently vanish would still pass via
// the `length === 0` branch. That is precisely the shape of assertion that let earlier rounds ship
// green, so the two outcomes are now asserted separately and by document kind.

const FULLWIDTH_NON_HIDERS: Record<string, (line: string) => string> = {
  "a fullwidth fence": (line) => `${FULLWIDTH_FENCE}\n${line}\n${FULLWIDTH_FENCE}`,
  "a fullwidth comment": (line) => `${FULLWIDTH_OPEN}\n${line}\n${FULLWIDTH_CLOSE}`,
};

for (const [wrapper, wrap] of Object.entries(FULLWIDTH_NON_HIDERS)) {
  test(`${wrapper} around FR-2's heading in spec.md leaves the heading READ, with no findings`, () => {
    // A heading does not depend on an enclosing block, so the legitimate outcome here is silence
    // WITH the requirement still present — asserted as exactly that, not as "silence or a report".
    const mutated = SPEC.replace(CARRIER.spec, wrap(CARRIER.spec));
    assert.notEqual(mutated, SPEC, "fixture did not mutate");
    assert.deepEqual(run({ spec: mutated }), [], `${wrapper} hid the heading`);
    assert.ok(requirementIds(mutated).includes("FR-2"), `${wrapper} removed FR-2 from the heading set`);
  });

  for (const document of ["trace", "tasks"] as const) {
    test(`${wrapper} around FR-2's row in ${DOC_FILE[document]} is a REPORTED loss naming FR-2`, () => {
      // A literal junk line genuinely does end a table — in the renderer too — so the row falls
      // outside the contract table. The legitimate outcome is therefore a reported loss naming the
      // item. Silence with the item gone is the only forbidden outcome, and this asserts the
      // reporting branch specifically rather than accepting either.
      const original = DOCS[document];
      const mutated = original.replace(CARRIER[document], wrap(CARRIER[document]));
      assert.notEqual(mutated, original, "fixture did not mutate");
      const problems = run({ [document]: mutated });
      assert.notEqual(problems.length, 0, `${wrapper} in ${document} produced SILENCE with the row outside the table`);
      assert.ok(
        problems.some((p) => p.includes("FR-2")),
        `${wrapper} in ${document} produced findings that do not name FR-2: ${problems.join("; ")}`,
      );
    });
  }
}

test("fullwidth confusables cannot synthesise a fence or a comment", () => {
  // THE round-five regression, at the root. NFKC maps U+FF40 x3 onto ``` and
  // U+FF1C U+FF01 U+FF0D U+FF0D onto the comment opener, and normalisation ran BEFORE
  // classification, so an attacker got a block construct that renders as ordinary literal text in
  // every markdown renderer. Classification now happens on the raw line, so these are just text.
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
  const spec = SPEC.replace("### FR-2 Second", `${FULLWIDTH_OPEN}### FR-2 Second${FULLWIDTH_CLOSE}`);
  assert.ok(run({ spec }).includes("FR-2 is declared in requirements.json but has no heading in spec.md"));
});

test("a fullwidth comment cannot smuggle a traceability or task id past the id check", () => {
  const trace = TRACE.replace("| FR-2 |", `| ${FULLWIDTH_OPEN}FR-2${FULLWIDTH_CLOSE} |`);
  assert.ok(run({ trace }).some((p) => p.includes("is not a plain `FR-<n>` id")), run({ trace }).join("; "));
  const tasks = TASKS.replace("| T-2 Second |", `| ${FULLWIDTH_OPEN}T-2${FULLWIDTH_CLOSE} Second |`);
  assert.ok(run({ tasks }).some((p) => p.includes("is not a plain `T-<n>` id")), run({ tasks }).join("; "));
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
  assert.ok(
    run({ spec: SPEC + "\n```\n" }).includes(
      "spec.md has an unterminated fenced code block — every line after it is hidden from this gate",
    ),
  );
  assert.ok(
    run({ trace: TRACE + "\n<!--\n" }).includes(
      "traceability.md has an unterminated HTML comment — every line after it is hidden from this gate",
    ),
  );
  assert.ok(
    run({ tasks: TASKS + "\n~~~\n" }).includes(
      "tasks.md has an unterminated fenced code block — every line after it is hidden from this gate",
    ),
  );
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
  assert.ok(run({ trace }).some((p) => p.includes("must read exactly `manual`")), run({ trace }).join("; "));
  const parsed = JSON.parse(REQS);
  parsed[1].evidence = "no manual testing was ever performed and nothing is verified";
  assert.ok(
    run({ requirements: JSON.stringify(parsed) }).some((p) => p.includes('must open with "manual:"')),
    run({ requirements: JSON.stringify(parsed) }).join("; "),
  );
});

test("a drifted Implementation, Tests, Evidence or Status cell is reported by name", () => {
  for (const [trace, needle] of [
    [TRACE.replace("| `lib/b.ts` |", "| `package.json` |"), "Implementation cell"],
    [TRACE.replace("| `tests/a.test.ts` |", "| `tests/other.test.ts` |"), "Tests cell"],
    [TRACE.replace("| PR 1. |", "| PR 7. |"), "Evidence cell"],
    [
      TRACE.replace(
        "| FR-1 | `lib/a.ts` | `tests/a.test.ts` | PR 1. | Verified |",
        "| FR-1 | `lib/a.ts` | `tests/a.test.ts` | PR 1. | Draft |",
      ),
      "Status cell",
    ],
  ] as const) {
    assert.ok(run({ trace }).some((p) => p.includes(needle)), `${needle}: ${run({ trace }).join("; ")}`);
  }
});

test("a declared file that does not exist is reported against the structured source", () => {
  const problems = checkSpec({
    requirements: REQS,
    lock: LOCK,
    spec: SPEC,
    trace: TRACE,
    tasks: TASKS,
    exists: (p: unknown) => p !== "lib/b.ts",
  });
  assert.ok(problems.includes("FR-2 references a missing file: lib/b.ts"), problems.join("; "));
});

// --- the real documents, adversarially --------------------------------------------------------

test("the real FR-8 (the CSP security requirement) cannot be removed by a fullwidth comment", () => {
  // The fifth review's headline reproduction, verbatim: FR-8 removed from all three documents with
  // characters that render as their original text, plus an unbuilt FR-22 planted.
  const docs = ON_DISK();
  const H = "### FR-8 Content Security Policy on the static export";
  const problems = checkSpec({
    ...docs,
    spec:
      docs.spec.replace(H, `${FULLWIDTH_OPEN}${H}${FULLWIDTH_CLOSE}`) +
      `\n${FULLWIDTH_FENCE}\n### FR-22 Unbuilt\n${FULLWIDTH_FENCE}\n`,
    trace: docs.trace.replace("| FR-8 |", `| ${FULLWIDTH_OPEN}FR-8${FULLWIDTH_CLOSE} |`),
    tasks: docs.tasks.replace(
      "| T-6 Content Security Policy",
      `| ${FULLWIDTH_OPEN}T-6${FULLWIDTH_CLOSE} Content Security Policy`,
    ),
  });
  assert.ok(
    problems.includes("FR-8 is declared in requirements.json but has no heading in spec.md"),
    problems.join("; "),
  );
  assert.ok(problems.includes("spec.md declares FR-22, which requirements.json does not"), problems.join("; "));
  assert.ok(problems.includes("FR-8 is in requirements.json but missing from traceability.md"), problems.join("; "));
  assert.ok(problems.includes("FR-8 is in requirements.json but no tasks.md work item claims it"), problems.join("; "));
});

test("the real FR-8 cannot be planted-over by a bidi-isolated FR-22, which is round six's gap", () => {
  const docs = ON_DISK();
  const problems = checkSpec({
    ...docs,
    spec: docs.spec + "\n### \u2066FR-22 Delete any repository the agent can reach\n",
  });
  assert.ok(
    problems.some((p) => p.includes('"\\u2066FR-22"') && p.includes("renders as FR-22 but is not that id")),
    problems.join("; "),
  );
});

test("an unaudited row cannot be planted inside the real tasks.md contract table", () => {
  // C-2 against the live document, which is where it mattered: the row renders as an ordinary
  // contract row with a foreign-repository citation and a status outside the closed enum.
  const docs = ON_DISK();
  const lines = docs.tasks.split("\n");
  const last = lines.findLastIndex((l) => /^\|\s*T-\d/.test(l));
  assert.ok(last > 0, "fixture could not locate the real task table");
  lines.splice(last + 1, 0, UNCOLLECTABLE_TASK_ROW);
  const problems = checkSpec({ ...docs, tasks: lines.join("\n") });
  assert.ok(problems.some((p) => p.includes('is a table row whose id is "Task"')), problems.join("; "));
  assert.ok(problems.some((p) => p.includes("https://github.com/attacker/evil/pull/1")), problems.join("; "));
  assert.ok(problems.some((p) => p.includes('has status "Shipped to production"')), problems.join("; "));
});

test("the real FR-8's CSP allowlist cannot be rewritten to permit any origin", () => {
  // H-4 against the live document. This is the finding that matters most: the gate's stated
  // purpose is to stop this requirement being quietly weakened, and round six did not read the
  // field that says what it requires.
  const docs = ON_DISK();
  const spec = docs.spec.replace(
    /allows scripts only from the site[\s\S]*?raw\.githubusercontent\.com\./,
    "allows scripts and connections from any origin.",
  );
  assert.notEqual(spec, docs.spec, "fixture did not mutate");
  const problems = checkSpec({ ...docs, spec });
  assert.ok(
    problems.some((p) => p.startsWith("FR-8's acceptance criterion 1 in spec.md") && p.includes("any origin")),
    problems.join("; "),
  );
});

test("a coherent removal of the real FR-8 from every document fails the gate", () => {
  // H-3 against the live documents. Before the persisted lock this printed
  // `spec check passed: 8 requirements traced` and exited 0.
  const docs = ON_DISK();
  const problems = checkSpec({
    ...docs,
    requirements: JSON.stringify(
      JSON.parse(docs.requirements).filter((r: { id: string }) => r.id !== "FR-8"),
      null,
      2,
    ),
    spec: docs.spec.replace(/### FR-8 [\s\S]*?(?=### FR-9)/, ""),
    trace: docs.trace.split("\n").filter((l) => !l.startsWith("| FR-8 |")).join("\n"),
    tasks: docs.tasks.split("\n").filter((l) => !l.startsWith("| T-6 ")).join("\n"),
  });
  assert.ok(
    problems.some((p) =>
      p.startsWith("FR-8 is recorded in requirements.lock.json but is no longer declared in requirements.json"),
    ),
    problems.join("; "),
  );
});

test("the real traceability.md, wholly commented out or wholly fenced, is not certified as traced", () => {
  const docs = ON_DISK();
  const lines = docs.trace.split("\n");
  const start = lines.findIndex((l) => l.startsWith("| Requirement |"));
  const end = lines.findLastIndex((l) => l.startsWith("| FR-"));
  assert.ok(start >= 0 && end > start, "fixture could not locate the real table");
  for (const [open, close] of [
    ["<!--", "-->"],
    ["```", "```"],
  ] as const) {
    const trace = [...lines.slice(0, start), open, ...lines.slice(start, end + 1), close, ...lines.slice(end + 1)].join(
      "\n",
    );
    const problems = checkSpec({ ...docs, trace });
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
    checkSpec({ ...docs, tasks }).some((p) => p.startsWith("FR-1 is claimed only by work items that are not merged")),
  );
});

test("the real documents' prose cannot be read as contract rows", () => {
  const docs = ON_DISK();
  assert.deepEqual(checkSpec(docs), [], "the real documents must pass first");
  assert.deepEqual(
    checkSpec({
      ...docs,
      spec: docs.spec + "\n<!--\n### FR-98 planted in prose\n-->\n\n```\n### FR-97 planted in a fence\n```\n",
    }),
    [],
  );
});

// --- the structural anti-duplication guard, by SHAPE ------------------------------------------
//
// The guard this replaces asserted `source.match(/function fenceDelimiter/g).length === 1` — a
// check on a SPELLING, not on duplicated logic. A cold review appended a second, fully working
// parser with RENAMED helpers and `"<" + "!--"` instead of the literal opener, and it passed.
//
// Round six replaced it with a shape-based scan over the module's top-level FUNCTION DECLARATIONS.
// Better, and mutation-validated against that exact case — but still keyed to a spelling, one
// level up: the `function` keyword. A sixth review appended the same working parser written as
// ARROW CONSTS, the ordinary modern spelling and how a contributor adding a fourth document's
// parser would plausibly write it, and both halves of the guard passed. A second mutant put a `}`
// inside a string literal, which truncated the brace-matched body before the primitives.
//
// So the extractor now recognises every callable declaration form — `function`, arrow const,
// `const f = function`, async, generator, and method shorthand — and its brace matcher is
// STRING-AWARE, skipping string, template and regex literals. Both mutants are asserted below.

/** Functions permitted to contain block-structure primitives. Deliberately tiny. */
const BLOCK_STRUCTURE_OWNERS = ["fenceDelimiter", "markdownBlockContext"];

/** Strip line and block comments, so prose about a comment delimiter is not mistaken for code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
}

/**
 * Fold adjacent string-literal concatenations, so `"<" + "!--"` reads as the literal opener.
 *
 * This is the evasion that defeated the guard's first ancestor, so it is normalised away rather
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

/**
 * The index of the `}` closing the block that opens at `open`, skipping literals.
 *
 * Naive brace counting is defeated by a single `}` inside a string, which truncates the body
 * before the code that matters. Comments are already stripped by `stripComments`; this skips
 * single-quoted, double-quoted and template strings, and regex literals (recognised by the
 * preceding significant character, the standard heuristic and sufficient for this module).
 */
function matchingBrace(source: string, open: number): number {
  let depth = 0;
  let prev = "";
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      prev = ch;
      continue;
    }
    if (ch === "/" && "(,=:[!&|?{};+-*%~^\n".includes(prev)) {
      // A regex literal. Its character class may contain an unmatched brace or slash.
      i += 1;
      let inClass = false;
      while (i < source.length) {
        if (source[i] === "\\") i += 2;
        else if (source[i] === "[") {
          inClass = true;
          i += 1;
        } else if (source[i] === "]") {
          inClass = false;
          i += 1;
        } else if (source[i] === "/" && !inClass) break;
        else if (source[i] === "\n") break;
        else i += 1;
      }
      prev = "/";
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    if (!/\s/.test(ch)) prev = ch;
  }
  return source.length;
}

/**
 * Statement keywords that `name(...) {` would otherwise match: `if (x) {`, `while (x) {`.
 *
 * Needed only because the method-shorthand form is the loosest of the four, and the alternative —
 * dropping that form — would reintroduce a spelling the extractor cannot see.
 */
const STATEMENT_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "do",
  "else",
  "try",
  "finally",
  "with",
  "function",
  "return",
  "typeof",
  "new",
  "await",
  "void",
  "delete",
  "in",
  "of",
]);

/**
 * Every named callable declaration in the module, as `{ name, body }`.
 *
 * Shape, not spelling. Recognises `function f(...)`, `const f = (...) =>`, `const f = function`,
 * `async`/generator forms and `f(...) {` method shorthand — i.e. every way a contributor could
 * write a second parser. Nesting is deliberately not excluded: a nested helper carrying a
 * block-structure primitive is exactly as much of a second parser as a top-level one.
 */
function callableDeclarations(source: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const forms = [
    // function f(...) {   /   export function f(...) {   /   async function* f(...) {
    /(?:^|[\n;{}])\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
    // const f = (...) => {   /   let f = async (a, b) => {   /   const f = x => {
    /(?:^|[\n;{}])\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g,
    // const f = function (...) {   /   const f = async function* name(...) {
    /(?:^|[\n;{}])\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\*?\s*[A-Za-z_$]?[\w$]*\s*\([^)]*\)\s*\{/g,
    // method shorthand in an object literal or class body: f(...) { / async *f(...) {
    /(?:^|[\n;{,])\s*(?:static\s+)?(?:async\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
  ];
  const seen = new Set<string>();
  for (const form of forms) {
    let m: RegExpExecArray | null;
    form.lastIndex = 0;
    while ((m = form.exec(source)) !== null) {
      if (STATEMENT_KEYWORDS.has(m[1])) continue;
      const open = source.indexOf("{", m.index + m[0].length - 1);
      if (open === -1) continue;
      const key = `${m[1]}@${open}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: m[1], body: source.slice(open + 1, matchingBrace(source, open)) });
    }
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

const GATE_SOURCE = () => foldConcatenatedStrings(stripComments(readFileSync("scripts/check-spec.mjs", "utf8")));
const carriersIn = (source: string) =>
  callableDeclarations(source)
    .filter((f) => blockStructurePrimitives(f.body).length > 0)
    .map((f) => f.name);

test("block structure is classified in exactly one place, detected by shape and not by name", () => {
  const source = GATE_SOURCE();
  const functions = callableDeclarations(source);
  assert.ok(functions.length >= 10, `the declaration scanner found only ${functions.length} callables — it is broken`);

  const carriers = [...new Set(carriersIn(source))].sort();
  assert.deepEqual(
    carriers,
    [...BLOCK_STRUCTURE_OWNERS].sort(),
    `block-structure handling must exist only in ${BLOCK_STRUCTURE_OWNERS.join(" and ")}, but these contain it: ${carriers.join(", ")}`,
  );
});

test("no parser reads the raw document except the one shared block reader", () => {
  // The inverted form of the same property, and the cheapest one to keep true: every document
  // reader must go through `markdownBlockContext`, so there is one implementation of "what counts
  // as document content" to close a bypass in.
  const splitters = [
    ...new Set(
      callableDeclarations(GATE_SOURCE())
        .filter((f) => /\.split\(\s*(["'])\\n\1\s*\)/.test(f.body))
        .map((f) => f.name),
    ),
  ];
  assert.deepEqual(
    splitters,
    ["markdownBlockContext"],
    `raw document splits outside the shared reader: ${splitters.join(", ")}`,
  );
});

/**
 * A fully working duplicate parser, rendered in each declaration form an attacker might use.
 *
 * Every variant carries all three block-structure primitives and would really work, so detecting
 * it is not a matter of taste. The arrow-const variant is the mutant a sixth cold review used to
 * defeat the previous guard; the brace-in-string variant truncated its brace matcher instead.
 */
const DUPLICATE_PARSERS: Record<string, string> = {
  "function declarations (the case the previous guard caught)": `
function blockDelimiterA(line) {
  const m = line.trim().match(/^(\\\`{3,}|~{3,})/);
  return m ? m[1] : null;
}
export function constitutionIdsA(doc) {
  const ids = [];
  let fence = null;
  for (const raw of doc.split("\\n")) {
    const delim = blockDelimiterA(raw);
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
`,
  "arrow consts, the ordinary modern spelling": `
const blockDelimiterB = (line) => {
  const m = line.trim().match(/^(\\\`{3,}|~{3,})/);
  return m ? m[1] : null;
};
export const constitutionIdsB = (doc) => {
  const ids = [];
  let fence = null;
  for (const raw of doc.split("\\n")) {
    const delim = blockDelimiterB(raw);
    if (fence) { if (delim && delim[0] === fence[0]) fence = null; continue; }
    if (delim) { fence = delim; continue; }
    let line = raw;
    const open = line.indexOf("<" + "!--");
    if (open !== -1) line = line.slice(0, open);
    const m = line.match(/^#+\\s+(FR-\\d+)\\b/);
    if (m) ids.push(m[1]);
  }
  return ids;
};
`,
  "a closing brace inside a string literal, to truncate a naive brace matcher": `
function blockDelimiterC(line) {
  const closer = "}";
  const m = line.trim().match(/^(\\\`{3,}|~{3,})/);
  return m ? m[1] : null;
}
export function constitutionIdsC(doc) {
  const brace = "}";
  const ids = [];
  let fence = null;
  for (const raw of doc.split("\\n")) {
    const delim = blockDelimiterC(raw);
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
`,
  "a const-assigned function expression": `
const blockDelimiterD = function (line) {
  const m = line.trim().match(/^(\\\`{3,}|~{3,})/);
  return m ? m[1] : null;
};
export const constitutionIdsD = async function parse(doc) {
  const ids = [];
  let fence = null;
  for (const raw of doc.split("\\n")) {
    const delim = blockDelimiterD(raw);
    if (fence) { if (delim && delim[0] === fence[0]) fence = null; continue; }
    if (delim) { fence = delim; continue; }
    let line = raw;
    const open = line.indexOf("<" + "!--");
    if (open !== -1) line = line.slice(0, open);
    const m = line.match(/^#+\\s+(FR-\\d+)\\b/);
    if (m) ids.push(m[1]);
  }
  return ids;
};
`,
};

for (const [form, duplicate] of Object.entries(DUPLICATE_PARSERS)) {
  test(`the shape scanner detects a duplicate parser written as ${form}`, () => {
    // Mutation-validation of the guard itself: a guard never observed failing may be passing
    // vacuously, and across six rounds that has been this gate's entire failure history.
    const real = readFileSync("scripts/check-spec.mjs", "utf8");
    const mutated = foldConcatenatedStrings(stripComments(real + duplicate));
    const carriers = carriersIn(mutated);
    const planted = new Set([...duplicate.matchAll(/(?:blockDelimiter|constitutionIds)[A-Z]/g)].map((m) => m[0]));
    assert.ok(planted.size === 2, `the fixture should plant two helpers, planted ${[...planted].join(", ")}`);
    for (const name of planted) {
      assert.ok(carriers.includes(name), `${form}: ${name} was not detected. carriers: ${carriers.join(", ")}`);
    }
    // And the production assertion above must actually FAIL on this mutant, not merely notice it.
    assert.notDeepEqual([...new Set(carriers)].sort(), [...BLOCK_STRUCTURE_OWNERS].sort(), form);
  });
}

test("the brace matcher is string-aware, so a body is not truncated before its primitives", () => {
  // The direct property behind the brace-in-string mutant: without this the scanner reads a
  // truncated body and reports a working parser as clean.
  const source = ["function decoy(line) {", '  const closer = "}";', '  const run = "```";', "  return closer + run;", "}", ""].join("\n");
  const [fn] = callableDeclarations(source);
  assert.equal(fn.name, "decoy");
  assert.ok(fn.body.includes("run"), `the body was truncated at the brace in a string: ${fn.body}`);
  assert.ok(blockStructurePrimitives(fn.body).length > 0, "the primitive after the string brace was missed");
});

test("the block-structure allowlist stays disjoint from the rest of the module's callables", () => {
  // A shape-based check needs a closed allowlist of deliberate owners; without its own guard the
  // allowlist is where the next near-copy would be quietly added.
  const names = callableDeclarations(stripComments(readFileSync("scripts/check-spec.mjs", "utf8"))).map((f) => f.name);
  for (const owner of BLOCK_STRUCTURE_OWNERS) {
    assert.ok(names.includes(owner), `${owner} is on the allowlist but is not a callable in the module`);
  }
  assert.equal(new Set(BLOCK_STRUCTURE_OWNERS).size, BLOCK_STRUCTURE_OWNERS.length);
  assert.ok(BLOCK_STRUCTURE_OWNERS.length <= 2, "the allowlist must not grow silently");
});

test("the row collection layer carries no row-shaped allowlist for an attacker to steer", () => {
  // The root cause of C-2, asserted structurally rather than only through its symptom. The old
  // collection layer took a `rowPattern` and silently skipped every line that did not match it,
  // which made membership of the graded set the attacker's choice. Re-adding such a pattern is the
  // one change that would reopen the bypass while every behavioural test above still passed.
  const source = stripComments(readFileSync("scripts/check-spec.mjs", "utf8"));
  assert.ok(!/rowPattern/.test(source), "a row pattern is back in the collection layer — see C-2");
  const collector = callableDeclarations(source).find((f) => f.name === "tableRows");
  assert.ok(collector, "tableRows is no longer a callable in the module");
});
