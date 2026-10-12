import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Fails when a requirement has no implementation file, no test or manual evidence, points at a
// missing file, or is not claimed by a merged work item in tasks.md.
//
// The logic lives in exported pure functions so `tests/check-spec.test.ts` can drive it over
// crafted documents. Before that split, the only validation this gate ever had was a manual
// mutation exercise recorded in a pull request body — nothing re-ran it, so every bypass found
// by review could regress silently the next time the parser was touched. A gate whose own
// correctness is unverified by anything executable is the same defect it exists to catch.
//
// Three rounds of review then found the same disease three times, and the reason was structural:
// this file held THREE parsers of wildly unequal strength — one per document — and each round
// hardened whichever one that round's reviewer happened to attack. `spec.md`, `traceability.md`
// and `tasks.md` therefore all now run through the single block-context reader below. A bypass
// closed in one document is closed in all three because there is only one implementation of
// "what counts as document content" left to close it in.

// ---------------------------------------------------------------------------------------------
// Shared markdown block context — the ONE place that decides what counts as document content
// ---------------------------------------------------------------------------------------------

/**
 * Leading indentation of a line in columns, counting a tab as four.
 *
 * CommonMark allows a fence to be indented up to three spaces; at four it is an indented code
 * block instead. That distinction matters to a gate: treating an indented ``` as a fence let a
 * four-space-indented delimiter swallow every requirement declared below it.
 */
function leadingIndent(line) {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

/**
 * The fence delimiter a line opens or closes with, or null.
 *
 * Markdown allows any run of three or more backticks or tildes, so a four-backtick fence can
 * contain a three-backtick line. A boolean toggle flipped on that inner line and leaked fence
 * state across the rest of the document; keyed state is therefore the delimiter CHARACTER and
 * its RUN LENGTH, and only an equal-or-longer run of the same character closes a fence.
 */
function fenceDelimiter(line) {
  if (leadingIndent(line) > 3) return null;
  const m = line.trim().match(/^(`{3,}|~{3,})/);
  return m ? m[1] : null;
}

/**
 * Normalise a line so visually identical text parses identically.
 *
 * `FR-8` written with a U+00A0 after the hashes, or `T-3` written with a U+2011 non-breaking
 * hyphen, renders exactly like the real thing and silently removed the line from every grader —
 * a row-deletion primitive that hid an ungraded pull-request citation and, in `spec.md`, removed
 * a security requirement from the gate's subject while it still printed a clean count.
 */
function normaliseLine(line) {
  return line
    .replace(/\u0000/g, "")
    .normalize("NFKC")
    .replace(/[\u2010\u2011]/g, "-");
}

/**
 * Read a markdown document into block-classified lines, used by all three document parsers.
 *
 * Returns `{ lines, unterminatedFence, unterminatedComment }`. Each entry in `lines` is
 * `{ kind, text, number }` where `kind` is one of:
 *
 * - `"content"` — ordinary document text, with HTML comments stripped inline.
 * - `"code"` — a line indented four or more columns, i.e. an indented code block. Kept as a
 *   marked entry rather than dropped, because it ENDS a table but may still legitimately carry
 *   a deeply indented heading.
 * - `"fence"` — the opening or closing delimiter of a fenced block. Kept for the same reason: a
 *   fence is a block boundary, and silently dropping it let rows below a fence count as part of
 *   the table above it.
 * - `"blank"` — an empty line (also a block boundary).
 *
 * Content INSIDE a fenced code block and inside an HTML comment is dropped entirely: it is not
 * document content, so it can neither satisfy a check nor invent a requirement. Comment state is
 * not tracked inside a fence, where `<!--` is literal text.
 *
 * An unterminated fence or comment is reported rather than silently swallowing the rest of the
 * file. That matters because the anti-vacuous guards only ever caught TOTAL loss of a document's
 * subject; a leaked fence that deletes *some* lines left the gate printing a confident count.
 */
export function markdownBlockContext(doc) {
  const lines = [];
  let fence = null;
  let inComment = false;
  let number = 0;

  for (const rawLine of doc.split("\n")) {
    number += 1;
    const raw = normaliseLine(rawLine);

    if (fence) {
      const delim = fenceDelimiter(raw);
      if (delim && delim[0] === fence[0] && delim.length >= fence.length) {
        fence = null;
        lines.push({ kind: "fence", text: raw.trim(), number });
      }
      continue;
    }

    let line = raw;

    // Comments are stripped, not skipped by line: skipping the whole line deleted real rows
    // from the gate's view, and an inline `<!-- -->` was enough to hide a row's cells from the
    // pull-request and status graders entirely.
    if (inComment) {
      const end = line.indexOf("-->");
      if (end === -1) continue;
      line = line.slice(end + 3);
      inComment = false;
    }
    while (true) {
      const open = line.indexOf("<!--");
      if (open === -1) break;
      const close = line.indexOf("-->", open + 4);
      if (close === -1) {
        line = line.slice(0, open);
        inComment = true;
        break;
      }
      line = line.slice(0, open) + line.slice(close + 3);
    }

    // Comments are resolved before fences so a commented-out delimiter cannot open a block.
    const delim = fenceDelimiter(line);
    if (delim) {
      fence = delim;
      lines.push({ kind: "fence", text: line.trim(), number });
      continue;
    }

    const text = line.trim();
    if (text === "") {
      lines.push({ kind: "blank", text: "", number });
      continue;
    }
    lines.push({ kind: leadingIndent(line) >= 4 ? "code" : "content", text, number });
  }

  return { lines, unterminatedFence: fence !== null, unterminatedComment: inComment };
}

/** Problems about a document's block structure, named per document. */
function blockStructureProblems(name, ctx) {
  const problems = [];
  if (ctx.unterminatedFence) {
    problems.push(`${name} has an unterminated fenced code block — every line after it is hidden from this gate`);
  }
  if (ctx.unterminatedComment) {
    problems.push(`${name} has an unterminated HTML comment — every line after it is hidden from this gate`);
  }
  return problems;
}

/**
 * Split a table row into trimmed cells, honouring the two ways markdown hides a pipe.
 *
 * A naive `split("|")` counted an escaped `\|` and a pipe inside inline code as real column
 * separators, so a legitimate row whose title contains either was rejected as malformed. Inline
 * code spans are blanked before splitting and escapes are unescaped afterwards, so the cell text
 * a reader sees is the cell text the checks grade. (`normaliseLine` has already removed any
 * literal NUL, so the placeholder below cannot be smuggled in by the document.)
 */
function splitRow(line) {
  const PLACEHOLDER = "\u0000";
  const masked = line
    .replace(/\\\|/g, PLACEHOLDER)
    .replace(/`[^`]*`/g, (span) => span.replace(/\|/g, PLACEHOLDER));
  return masked.split("|").map((c) => c.replace(new RegExp(PLACEHOLDER, "g"), "|").trim());
}

/** A `|---|---|` style header separator. */
function isSeparatorRow(text) {
  return /^\|[\s|:-]+\|$/.test(text) && text.includes("-");
}

/**
 * Rows of the FIRST table in a document, as arrays of trimmed cells, with its header validated.
 *
 * One implementation for `traceability.md` and `tasks.md`, because the two had drifted to
 * opposite ends of strictness: the contract table got comment stripping, fence tracking, table
 * termination and a column guard, and the traceability table — whose entire job is proving that
 * each requirement has an implementation and a test — got a raw line filter with none of them.
 * Wrapping that whole table in `<!-- -->` or in a fence left the gate certifying a clean sheet.
 *
 * A table ends at the first line that is not one of its own rows: a blank line, prose, a fence,
 * or an indented code block. Everything further down the document — a second table, a
 * "rejected drafts" appendix, an illustrative example — is outside it by construction.
 */
function firstTableRows(ctx, { rowPattern, header, document: documentName, problems }) {
  const rows = [];
  let seenTable = false;
  let headerChecked = false;

  for (const line of ctx.lines) {
    if (line.kind !== "content") {
      // Blank, fenced and indented-code lines are all block boundaries. A fence is neither
      // blank nor a table row, and letting it merely be skipped meant rows below a fenced block
      // still counted as "the first table"; four-space-indented rows were read as rows outright.
      if (seenTable) break;
      continue;
    }
    if (!line.text.startsWith("|")) {
      if (seenTable) break;
      continue;
    }

    seenTable = true;
    const cells = splitRow(line.text);
    if (!headerChecked) {
      headerChecked = true;
      // The index constants below are asserted against the document rather than assumed: a
      // table may not misdescribe its own columns, or `Requirements` and `Status` are read from
      // whatever happens to sit at that offset.
      const actual = cells.slice(1, -1).join(" | ");
      const expected = header.join(" | ");
      if (actual !== expected) {
        problems.push(`${documentName} table header is \`${actual}\`, expected \`${expected}\``);
      }
      continue;
    }
    if (isSeparatorRow(line.text)) continue;
    if (rowPattern.test(line.text)) rows.push(cells);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// The three document parsers, all routed through the context above
// ---------------------------------------------------------------------------------------------

/**
 * Requirement ids declared by the specification, read from a heading at ANY depth.
 *
 * `^### ` alone silently dropped a requirement demoted to `####` or indented under a list, which
 * removes it from the gate entirely rather than failing it — a parser that loses its subject is
 * the exact failure mode this check exists to prevent.
 *
 * A heading inside a fenced code block or an HTML comment does NOT declare a requirement: it is
 * not document content. A heading inside an INDENTED code block does, deliberately — of the two
 * ways to be wrong here, inventing a requirement that must then be proven is the fail-safe one,
 * while dropping one lets unbuilt work through. Indentation is therefore never a way to remove a
 * requirement from this gate, only table rows are read strictly by indentation.
 */
export function requirementIds(spec) {
  const ids = [];
  for (const line of markdownBlockContext(spec).lines) {
    if (line.kind !== "content" && line.kind !== "code") continue;
    const m = line.text.match(/^#+\s+(FR-\d+)\b/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

const TRACE_HEADER = ["Requirement", "Implementation", "Tests", "Evidence", "Status"];
const TASKS_HEADER = ["Task", "Pull request", "Branch", "Requirements", "Status"];

/** Traceability rows from the first table in traceability.md, as arrays of trimmed cells. */
export function traceabilityRows(trace, problems = []) {
  return firstTableRows(markdownBlockContext(trace), {
    rowPattern: /^\|\s*FR-\d+\b/,
    header: TRACE_HEADER,
    document: "traceability.md",
    problems,
  });
}

/** Work-item rows from the contract table in tasks.md, as arrays of trimmed cells. */
export function taskTableRows(tasks, problems = []) {
  return firstTableRows(markdownBlockContext(tasks), {
    rowPattern: /^\|\s*T-\d+\b/,
    header: TASKS_HEADER,
    document: "tasks.md",
    problems,
  });
}

// A `| id | a | b | c | d |` row splits into a leading and trailing empty cell around the five
// real columns, so a named column sits at a fixed index *only* for a five-column row. A row with
// any other column count is a malformed entry, not a licence to read some other cell as the
// claim: a three-column traceability row made `tests` and `evidence` `undefined`, and
// `"manual" + undefined` satisfied the evidence check for a requirement with neither.
const EXPECTED_CELLS = 7;
const ID_INDEX = 1;
const TASK_INDEX = 1;
const PR_INDEX = 2;
const IMPL_INDEX = 2;
const TESTS_INDEX = 3;
const EVIDENCE_INDEX = 4;
const REQUIREMENTS_INDEX = 4;
const STATUS_INDEX = 5;

/** Backtick-quoted paths in a cell. */
function paths(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/**
 * Whether a traceability row declares manual evidence, matched as a claim and not as a word.
 *
 * `/manual/i.test(tests + evidence)` was a substring search over two concatenated cells, so an
 * Evidence cell reading "no manual testing was ever performed and nothing is verified" satisfied
 * the requirement that there be a test or manual evidence. A claim has a shape: the Tests cell
 * says `manual` and nothing else, and the Evidence cell opens with a `manual:` note.
 */
function declaresManualEvidence(tests, evidence) {
  return /^manual$/i.test(tests.trim()) && /^manual\s*:/i.test(evidence.trim());
}

const QUALITY_ONLY = "none (quality)";

/**
 * The requirement ids a Requirements cell claims, or `null` when the cell is not readable.
 *
 * `matchAll(/FR-\d+/g)` over free text has no polarity, so a cell reading
 * "explicitly NOT FR-9 — deferred, nothing shipped" counted as delivering FR-9: writing down
 * that you did not do the work satisfied the requirement that you had. The cell is now a closed
 * grammar — a comma-separated list of bare ids, or the quality-only hatch — so a claim must be
 * made deliberately and prose cannot imply one.
 */
function requirementClaims(cell) {
  const text = cell.trim();
  if (text === QUALITY_ONLY) return [];
  const parts = text.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0 || !parts.every((p) => /^FR-\d+$/.test(p))) return null;
  return parts;
}

// The Status column is graded against a closed enum, and only `Merged` DELIVERS a requirement.
// Grading the value alone was presentational: marking every row `Abandoned` left every
// requirement "traced" by work the table itself declares was never finished. Whether a pull
// request really merged needs the network and stays out of an offline gate; what is checkable is
// that the table does not claim coverage from work it does not claim to have landed.
const STATUSES = new Set(["Merged", "In review", "In progress", "Abandoned"]);
const DELIVERED_STATUSES = new Set(["Merged"]);

/**
 * Every problem found in the three specification documents, as human-readable strings.
 *
 * `exists` is injected so tests can describe a filesystem without touching one.
 */
export function checkSpec({ spec, trace, tasks, exists = existsSync }) {
  const problems = [];

  problems.push(...blockStructureProblems("spec.md", markdownBlockContext(spec)));
  problems.push(...blockStructureProblems("traceability.md", markdownBlockContext(trace)));
  problems.push(...blockStructureProblems("tasks.md", markdownBlockContext(tasks)));

  const ids = requirementIds(spec);
  if (ids.length === 0) {
    // Not a finding about the documents: the parser has lost its subject and every downstream
    // assertion would be vacuous, so say that instead of reporting a clean sheet.
    problems.push("spec.md yielded zero FR-n requirements — the parser cannot be trusted");
    return problems;
  }

  // --- traceability.md -----------------------------------------------------------------------

  const traceRowList = traceabilityRows(trace, problems);
  if (traceRowList.length === 0) {
    problems.push("traceability.md parsed to zero requirement rows — the coverage check cannot run");
  }
  const traceRows = new Map();
  for (const cells of traceRowList) {
    const id = cells[ID_INDEX];
    if (cells.length !== EXPECTED_CELLS) {
      problems.push(`a traceability.md row has ${cells.length - 2} columns, expected 5: ${id}`);
      continue;
    }
    if (traceRows.has(id)) {
      // `new Map(...)` was last-write-wins, so a later duplicate silently replaced the real
      // evidence — a row labelled "draft, superseded, do not use" overrode FR-7's implementation
      // and test. A requirement is traced in exactly one row or the table is ambiguous.
      problems.push(`${id} has more than one row in traceability.md — remove the duplicate`);
      continue;
    }
    traceRows.set(id, cells);
  }

  for (const id of ids) {
    const cells = traceRows.get(id);
    if (!cells) {
      problems.push(`${id} is in spec.md but missing from traceability.md`);
      continue;
    }
    const impls = paths(cells[IMPL_INDEX]);
    const tests = cells[TESTS_INDEX];
    const evidence = cells[EVIDENCE_INDEX];
    if (impls.length === 0) problems.push(`${id} has no implementation file`);
    for (const p of [...impls, ...paths(tests)]) if (!exists(p)) problems.push(`${id} references a missing file: ${p}`);
    if (paths(tests).length === 0 && !declaresManualEvidence(tests, evidence)) {
      problems.push(`${id} has neither a test nor manual evidence`);
    }
  }
  for (const id of traceRows.keys()) if (!ids.includes(id)) problems.push(`${id} is in traceability.md but not in spec.md`);

  // --- tasks.md ------------------------------------------------------------------------------

  const taskRows = taskTableRows(tasks, problems);
  for (const cells of taskRows.filter((c) => c.length !== EXPECTED_CELLS)) {
    problems.push(`a tasks.md work item has ${cells.length - 2} columns, expected 5: ${cells[TASK_INDEX]}`);
  }

  const wellFormed = taskRows.filter((c) => c.length === EXPECTED_CELLS);

  // id -> the statuses of the rows claiming it, so coverage can be graded against delivery.
  const claimedBy = new Map();
  for (const cells of wellFormed) {
    const claims = requirementClaims(cells[REQUIREMENTS_INDEX]);
    if (claims === null) {
      problems.push(
        `${cells[TASK_INDEX]} has an unreadable Requirements cell "${cells[REQUIREMENTS_INDEX]}", expected a comma-separated list of FR-n ids or "${QUALITY_ONLY}"`,
      );
      continue;
    }
    for (const id of claims) {
      if (!claimedBy.has(id)) claimedBy.set(id, []);
      claimedBy.get(id).push({ task: cells[TASK_INDEX], status: cells[STATUS_INDEX] });
    }
  }

  // The Pull request column is graded, because the column that makes a row auditable otherwise
  // carries no weight: rewriting every row's link to `#1` used to pass green, and T-6 shipped
  // citing the wrong pull request for exactly that reason.
  //
  // Scope, stated honestly: this grades a citation's SHAPE, not its truth. It cannot know that
  // the CSP work came from #16 rather than #11 — a self-consistent citation of the wrong pull
  // request still passes, and only a human or a network call can catch that. What it does
  // enforce is that every link is well formed, points at THIS repository, and that every link in
  // the cell agrees, so a wrong citation has to be deliberate rather than a typo nobody checked.
  for (const cells of wellFormed) {
    const cell = cells[PR_INDEX];
    const links = [...cell.matchAll(/\[#(\d+)\]\((\S+?)\)/g)];
    if (links.length === 0) {
      problems.push(`${cells[TASK_INDEX]} has no pull request link in its Pull request column`);
      continue;
    }
    // Every link is graded, not just the first: a cell used to pass on one honest link while
    // carrying others that pointed anywhere at all.
    for (const [, label, url] of links) {
      // Anchored on both ends against this repository. An unanchored `[^/]+/[^/]+` accepted a
      // link to any repo on GitHub, which is precisely how a row could cite work that is not
      // this repo's and still read as traceable.
      const m = url.match(/^https:\/\/github\.com\/edgeorgie\/triage-desk\/pull\/(\d+)$/);
      if (!m) {
        problems.push(`${cells[TASK_INDEX]} cites #${label} with a link that is not an edgeorgie/triage-desk pull request: ${url}`);
        continue;
      }
      if (label !== m[1]) {
        problems.push(`${cells[TASK_INDEX]} links to pull request #${m[1]} but is labelled #${label}`);
      }
    }
  }

  for (const cells of wellFormed) {
    const status = cells[STATUS_INDEX];
    if (!STATUSES.has(status)) {
      problems.push(`${cells[TASK_INDEX]} has status "${status}", expected one of: ${[...STATUSES].join(", ")}`);
    }
  }

  for (const id of ids) {
    const rows = claimedBy.get(id);
    if (!rows) {
      problems.push(`${id} is in spec.md but no tasks.md work item claims it`);
      continue;
    }
    if (!rows.some((r) => DELIVERED_STATUSES.has(r.status))) {
      const where = rows.map((r) => `${r.task} (${r.status})`).join(", ");
      problems.push(`${id} is claimed only by work items that are not merged: ${where}`);
    }
  }
  for (const id of claimedBy.keys()) if (!ids.includes(id)) problems.push(`${id} is claimed by a tasks.md work item but not in spec.md`);

  if (taskRows.length === 0) {
    // If the table's shape changes so no row parses, every requirement looks unclaimed above —
    // but that is one parser failure, not N real findings, and must name itself. Counting
    // block-aware rows is what makes this guard real: counting raw line matches let a
    // commented-out table satisfy it.
    problems.push("tasks.md parsed to zero work-item rows — the coverage check cannot run");
  }

  return problems;
}

// Running as a script checks this repo's own documents; importing it from a test does not.
// Compared by resolved path rather than by string suffix, so the entry-point test cannot be
// fooled by how the script was invoked.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const spec = readFileSync("docs/spec/spec.md", "utf8");
  const trace = readFileSync("docs/spec/traceability.md", "utf8");
  const tasks = readFileSync("docs/spec/tasks.md", "utf8");

  const problems = checkSpec({ spec, trace, tasks });
  if (problems.length > 0) {
    console.error(problems.map((p) => "- " + p).join("\n"));
    process.exit(1);
  }
  console.log(`spec check passed: ${requirementIds(spec).length} requirements traced`);
}
