import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Fails when a requirement has no implementation file, no test or manual evidence, points at a
// missing file, or is not claimed by a merged work item in tasks.md.
//
// ---------------------------------------------------------------------------------------------
// Why this file is shaped the way it is
// ---------------------------------------------------------------------------------------------
//
// FIVE consecutive rounds of review hardened a hand-written markdown parser here, and every one
// of them shipped a working bypass. The fifth shipped a REGRESSION: it added NFKC normalisation
// to stop a confusable deleting a line, applied it BEFORE classifying fences and HTML comments,
// and so handed an attacker every character that NFKC folds INTO a delimiter — three U+FF40
// fullwidth grave accents became a ``` fence, and U+FF1C U+FF01 U+FF0D U+FF0D became `<!--`.
// Those render as ordinary literal text in every markdown renderer, so a document looked
// completely normal to a human reviewer while the gate treated a chunk of it as commented out
// and stopped grading it. The attack is caught by the parser one commit earlier and passes the
// "hardened" one.
//
// The lesson is not that the fifth author was careless. It is that the APPROACH was wrong:
// discovering which requirements exist by scraping prose headings makes the gate's own subject
// attacker-controlled, so every round of character-level patching only moves which character
// deletes a requirement. A gate whose subject can be shrunk cannot witness its own truncation,
// and the count it prints is derived from the same parse the attack corrupts.
//
// So identity no longer comes from markdown. `docs/spec/requirements.json` — which already
// existed in this repository and which this gate never read — is the source of truth for WHICH
// requirements exist and what each one claims. The three markdown documents are RECONCILED
// against it rather than parsed for identity. That inverts the failure mode that five rounds
// could not close: hiding a line in markdown no longer removes a requirement from the gate's
// subject, it makes the reconciliation fail, because the expected id is declared somewhere the
// markdown parser cannot reach. Removing a requirement now requires editing structured,
// machine-readable, git-diffable data.
//
// Markdown is still read, for a strictly smaller job: confirming that the documents a human
// reads say the same thing the structured source says. Two rules make that reading safe:
//
//   1. Block structure is classified on the RAW line. Normalisation is applied only to the
//      semantic content of lines that survived classification. A character can therefore never
//      be folded into a delimiter, which is the root cause of the round-five regression.
//   2. A requirement id is confined to a strict ASCII allowlist at the identity layer. An id
//      that is not already its own canonical form — a zero-width joiner inside it, a bidi
//      override before it, a fullwidth or lowercase spelling of it — is a HARD ERROR naming the
//      offending text, not a silently different id. Five rounds of "normalise it away" produced
//      five ways to alias one requirement onto another's proof.

// ---------------------------------------------------------------------------------------------
// Identity layer — requirement and task ids, under a strict allowlist
// ---------------------------------------------------------------------------------------------

/** Zero-width characters, bidi controls, BOM and the soft hyphen: invisible, so never in an id. */
const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
/** Combining marks, which can be stacked onto an ASCII letter to alias one id onto another. */
const COMBINING = /[\u0300-\u036f]/g;

/** A requirement id, exactly. Anything else is a hard error rather than a different id. */
const REQUIREMENT_ID = /^FR-[1-9][0-9]*$/;
/** A work-item id, exactly. */
const TASK_ID = /^T-[1-9][0-9]*$/;

/**
 * Canonicalise an id token and report whether the token was ALREADY canonical.
 *
 * `conforming` is the load-bearing half. Earlier rounds normalised a confusable id into the real
 * one, which quietly made `FR-2<ZWJ>2` — a heading that renders as `FR-22` — into a second
 * `FR-2` that inherited the real FR-2's implementation, test, traceability row and task row. A
 * brand-new requirement therefore arrived pre-proven. Canonicalising is only ever used to
 * RECOGNISE that a token was meant to be an id; a token that needed canonicalising is rejected.
 */
export function canonicaliseId(token) {
  const canonical = token
    .replace(INVISIBLE, "")
    .replace(COMBINING, "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .toUpperCase();
  return { canonical, conforming: canonical === token };
}

/** Render a token with its invisible and non-ASCII characters escaped, so an error can name it. */
function describeToken(token) {
  return [...token]
    .map((ch) => (ch >= " " && ch <= "~" ? ch : `\\u${ch.codePointAt(0).toString(16).padStart(4, "0")}`))
    .join("");
}

/**
 * Whether a token was plausibly MEANT to be a requirement id.
 *
 * Deliberately loose, because its job is to catch the near-misses and hand them to the strict
 * check as errors. `fr-22`, `ＦＲ－２２` and `FR-2<ZWJ>2` all reach the strict check and are
 * rejected by name; `Requirements`, `Baseline` and `Non-goals` do not.
 */
function looksLikeRequirementId(token) {
  return /^FR-\d/.test(canonicaliseId(token).canonical);
}

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
 *
 * Called on the RAW line, never on a normalised one. Normalising first is what let `｀｀｀`
 * (U+FF40 ×3) — literal text in every renderer — become a fence inside this gate.
 */
function fenceDelimiter(line) {
  if (leadingIndent(line) > 3) return null;
  const m = line.trim().match(/^(`{3,}|~{3,})/);
  return m ? m[1] : null;
}

/**
 * Normalise the SEMANTIC CONTENT of a line, after its block structure is already decided.
 *
 * `T-3` written with a U+2011 non-breaking hyphen renders exactly like the real thing, and a
 * grader keyed to an ASCII hyphen silently stopped seeing the row. Folding that is correct and
 * safe — but only here, downstream of classification. Applied to the line BEFORE classification
 * it becomes a delimiter-synthesis primitive, which is exactly the round-five regression.
 *
 * Note what this is NOT used for: requirement and task IDENTITY, which goes through
 * `canonicaliseId` and rejects anything that needed folding. Folding an id merges two distinct
 * ids; folding a row's prose only makes the row readable.
 */
function normaliseContent(text) {
  return text
    .replace(/\u0000/g, "")
    .normalize("NFKC")
    .replace(/[\u2010\u2011]/g, "-");
}

/**
 * Read a markdown document into block-classified lines, used by every document reconciler.
 *
 * Returns `{ lines, unterminatedFence, unterminatedComment }`. Each entry in `lines` is
 * `{ kind, text, raw, number }` where `kind` is one of:
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
 * `raw` is the line's own text with comments stripped and nothing folded; `text` is `raw` with
 * `normaliseContent` applied. Identity checks read `raw`, so a confusable is reported rather
 * than folded. Semantic checks read `text`, so a row with a U+2011 in its title still parses.
 *
 * Content INSIDE a fenced code block and inside an HTML comment is dropped entirely: it is not
 * document content, so it can neither satisfy a check nor invent a requirement. Comment state is
 * not tracked inside a fence, where `<!--` is literal text.
 *
 * An unterminated fence or comment is reported rather than silently swallowing the rest of the
 * file.
 */
export function markdownBlockContext(doc) {
  const lines = [];
  let fence = null;
  let inComment = false;
  let number = 0;

  for (const rawLine of doc.split("\n")) {
    number += 1;

    // Everything below classifies the RAW line. Nothing is folded before this point, so no
    // character can be mapped into a delimiter this gate greps for.
    if (fence) {
      const delim = fenceDelimiter(rawLine);
      if (delim && delim[0] === fence[0] && delim.length >= fence.length) {
        fence = null;
        lines.push({ kind: "fence", text: rawLine.trim(), raw: rawLine.trim(), number });
      }
      continue;
    }

    let line = rawLine;

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
      lines.push({ kind: "fence", text: line.trim(), raw: line.trim(), number });
      continue;
    }

    const raw = line.trim();
    if (raw === "") {
      lines.push({ kind: "blank", text: "", raw: "", number });
      continue;
    }
    // Structure is settled; only NOW is the surviving content normalised.
    lines.push({
      kind: leadingIndent(line) >= 4 ? "code" : "content",
      text: normaliseContent(raw),
      raw,
      number,
    });
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
 * a reader sees is the cell text the checks grade.
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
 * EVERY row in a document matching `rowPattern`, flagged with whether it is in the FIRST table.
 *
 * Coverage and shape are different questions and were conflated. A table ends at the first line
 * that is not one of its own rows, which is correct for COVERAGE — an appendix of rejected
 * drafts must not certify anything. But rows below that terminator were not merely uncounted,
 * they were UNGRADED, so a row citing an unrelated repository with the literal status text
 * "NOT A REAL STATUS" passed green while rendering as a perfectly ordinary contract row.
 *
 * So shape is graded over every matching row in the document and coverage is computed only from
 * `inFirstTable` rows. The first table's header is still validated against the columns the
 * checker reads by position, so a table cannot misdescribe its own columns.
 */
function tableRows(ctx, { rowPattern, header, document: documentName, problems }) {
  const rows = [];
  let seenTable = false;
  let firstTableOpen = true;
  let headerChecked = false;

  for (const line of ctx.lines) {
    if (line.kind !== "content") {
      // Blank, fenced and indented-code lines are all block boundaries.
      if (seenTable) firstTableOpen = false;
      continue;
    }
    if (!line.text.startsWith("|")) {
      if (seenTable) firstTableOpen = false;
      continue;
    }

    if (firstTableOpen && !headerChecked) {
      seenTable = true;
      headerChecked = true;
      const cells = splitRow(line.text);
      const actual = cells.slice(1, -1).join(" | ");
      const expected = header.join(" | ");
      if (actual !== expected) {
        problems.push(`${documentName} table header is \`${actual}\`, expected \`${expected}\``);
      }
      continue;
    }
    seenTable = true;
    if (isSeparatorRow(line.text)) continue;
    if (!rowPattern.test(line.text)) continue;
    rows.push({
      cells: splitRow(line.text),
      rawCells: splitRow(line.raw),
      number: line.number,
      inFirstTable: firstTableOpen,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// The structured source of truth
// ---------------------------------------------------------------------------------------------

/** The statuses a requirement may carry. `Draft` exists for appendix rows outside a table. */
const REQUIREMENT_STATUSES = new Set(["Verified", "Implemented, not verified end to end", "Draft"]);

/**
 * Parse and validate `requirements.json`, the source of truth for requirement identity.
 *
 * Returns `null` when the file cannot be trusted as a subject, which is a parser failure and
 * must be said out loud rather than reported as a clean sheet — the same fail-closed rule the
 * markdown readers follow, applied to the document that now decides what the gate is about.
 */
export function loadRequirements(json, problems) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    problems.push(`requirements.json is not valid JSON (${e.message}) — the gate has no subject`);
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    problems.push("requirements.json is not a non-empty array of requirements — the gate has no subject");
    return null;
  }

  const seen = new Set();
  const out = [];
  for (const [i, entry] of parsed.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`requirements.json entry ${i} is not an object`);
      continue;
    }
    const id = entry.id;
    if (typeof id !== "string" || !REQUIREMENT_ID.test(id)) {
      // The strict allowlist at the identity layer. A non-conforming id is a hard error here,
      // so it can never become a silently different id downstream.
      problems.push(
        `requirements.json entry ${i} has id "${typeof id === "string" ? describeToken(id) : String(id)}", which is not a plain \`FR-<n>\` id`,
      );
      continue;
    }
    if (seen.has(id)) {
      problems.push(`requirements.json declares ${id} more than once`);
      continue;
    }
    seen.add(id);

    const fieldProblems = [];
    if (typeof entry.title !== "string" || entry.title.trim() === "") fieldProblems.push("title");
    if (typeof entry.evidence !== "string" || entry.evidence.trim() === "") fieldProblems.push("evidence");
    if (!Array.isArray(entry.implementation) || entry.implementation.length === 0) fieldProblems.push("implementation");
    if (!Array.isArray(entry.tests)) fieldProblems.push("tests");
    if (typeof entry.status !== "string" || !REQUIREMENT_STATUSES.has(entry.status)) fieldProblems.push("status");
    if (fieldProblems.length > 0) {
      problems.push(`${id} in requirements.json has a missing or unreadable ${fieldProblems.join(", ")}`);
      continue;
    }
    out.push(entry);
  }
  return out.length === 0 ? null : out;
}

// ---------------------------------------------------------------------------------------------
// The three markdown documents, reconciled against the structured source
// ---------------------------------------------------------------------------------------------

/**
 * Requirement ids declared by a heading in `spec.md`, read at ANY depth and any indentation.
 *
 * This no longer DISCOVERS the gate's subject — `requirements.json` does — so a heading hidden
 * from this function can no longer remove a requirement from grading. What it does is reconcile:
 * the set of headings must equal the set of declared ids, in both directions.
 *
 * A heading inside a fenced code block or an HTML comment does not declare a requirement: it is
 * not document content, so an example in prose cannot invent one. A heading inside an INDENTED
 * code block does, deliberately — indentation is never a way to remove a requirement.
 *
 * A heading whose id token is not already canonical ASCII is a hard error naming the token.
 */
export function requirementIds(spec, problems = []) {
  const ids = [];
  for (const line of markdownBlockContext(spec).lines) {
    if (line.kind !== "content" && line.kind !== "code") continue;
    // Read from the RAW text: the point is to SEE the confusable, not to fold it away.
    const m = line.raw.match(/^#+\s+(\S+)/);
    if (!m) continue;
    const token = m[1];
    if (!looksLikeRequirementId(token)) continue;
    const { canonical, conforming } = canonicaliseId(token);
    if (!conforming || !REQUIREMENT_ID.test(canonical)) {
      problems.push(
        `spec.md line ${line.number} declares a requirement id "${describeToken(token)}", which is not a plain \`FR-<n>\` id — it renders as ${canonical} but is not that id`,
      );
      continue;
    }
    ids.push(canonical);
  }
  return ids;
}

const TRACE_HEADER = ["Requirement", "Implementation", "Tests", "Evidence", "Status"];
const TASKS_HEADER = ["Task", "Pull request", "Branch", "Requirements", "Status"];

/** Every `FR-n` row in traceability.md, flagged with first-table membership. */
export function traceabilityRows(trace, problems = []) {
  return tableRows(markdownBlockContext(trace), {
    rowPattern: /^\|\s*\S*FR-\d/,
    header: TRACE_HEADER,
    document: "traceability.md",
    problems,
  });
}

/** Every `T-n` row in tasks.md, flagged with first-table membership. */
export function taskTableRows(tasks, problems = []) {
  return tableRows(markdownBlockContext(tasks), {
    rowPattern: /^\|\s*\S*T-\d/,
    header: TASKS_HEADER,
    document: "tasks.md",
    problems,
  });
}

// A `| id | a | b | c | d |` row splits into a leading and trailing empty cell around the five
// real columns, so a named column sits at a fixed index *only* for a five-column row. A row with
// any other column count is a malformed entry, not a licence to read some other cell as the
// claim.
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

const QUALITY_ONLY = "none (quality)";

/**
 * The requirement ids a Requirements cell claims, or `null` when the cell is not readable.
 *
 * `matchAll(/FR-\d+/g)` over free text has no polarity, so a cell reading "explicitly NOT FR-9 —
 * deferred, nothing shipped" counted as delivering FR-9. The cell is a closed grammar — a
 * comma-separated list of bare ids, or the quality-only hatch — and each id goes through the
 * same strict allowlist, so a confusable cannot alias one claim onto another requirement.
 */
function requirementClaims(cell) {
  const text = cell.trim();
  if (text === QUALITY_ONLY) return [];
  const parts = text.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) return null;
  const ids = [];
  for (const part of parts) {
    const { canonical, conforming } = canonicaliseId(part);
    if (!conforming || !REQUIREMENT_ID.test(canonical)) return null;
    ids.push(canonical);
  }
  return ids;
}

// The Status column is graded against a closed enum, and only `Merged` DELIVERS a requirement.
const STATUSES = new Set(["Merged", "In review", "In progress", "Abandoned"]);
const DELIVERED_STATUSES = new Set(["Merged"]);

/**
 * Read a row's id cell under the strict allowlist, or report it and return null.
 *
 * Reads the RAW cell so a zero-width joiner or a bidi override is named rather than folded. The
 * aliasing this prevents is the serious one: an id that renders as a new requirement but parses
 * as an existing one inherits that requirement's implementation, test and evidence.
 */
function rowId(row, pattern, documentName, problems) {
  const token = (row.rawCells[ID_INDEX] ?? "").split(/\s+/)[0] ?? "";
  const { canonical, conforming } = canonicaliseId(token);
  if (!conforming || !pattern.test(canonical)) {
    problems.push(
      `${documentName} line ${row.number} has the id "${describeToken(token)}", which is not a plain \`${pattern === REQUIREMENT_ID ? "FR" : "T"}-<n>\` id`,
    );
    return null;
  }
  return canonical;
}

/**
 * Every problem found across the structured source and the three documents it describes.
 *
 * `requirements` is the JSON text of `docs/spec/requirements.json`. `exists` is injected so
 * tests can describe a filesystem without touching one.
 */
export function checkSpec({ requirements, spec, trace, tasks, exists = existsSync }) {
  const problems = [];

  problems.push(...blockStructureProblems("spec.md", markdownBlockContext(spec)));
  problems.push(...blockStructureProblems("traceability.md", markdownBlockContext(trace)));
  problems.push(...blockStructureProblems("tasks.md", markdownBlockContext(tasks)));

  const declared = loadRequirements(requirements, problems);
  if (declared === null) return problems;

  const byId = new Map(declared.map((r) => [r.id, r]));
  const ids = [...byId.keys()];

  // --- spec.md: the prose must declare exactly the requirements the source of truth declares --
  //
  // Both directions matter. A heading hidden by any construct whatsoever now shows up as a
  // declared requirement with no heading, which is the loud direction — the five previous rounds
  // all failed in the quiet one, where the requirement simply left the gate's subject.
  const headings = requirementIds(spec, problems);
  const headingCounts = new Map();
  for (const id of headings) headingCounts.set(id, (headingCounts.get(id) ?? 0) + 1);
  for (const id of ids) {
    const n = headingCounts.get(id) ?? 0;
    if (n === 0) {
      problems.push(`${id} is declared in requirements.json but has no heading in spec.md`);
    } else if (n > 1) {
      problems.push(`${id} has ${n} headings in spec.md — a requirement is declared exactly once`);
    }
  }
  for (const id of headingCounts.keys()) {
    if (!byId.has(id)) problems.push(`spec.md declares ${id}, which requirements.json does not`);
  }
  for (const r of declared) {
    // The heading's title is reconciled too, so the two sources cannot drift into describing
    // different requirements under the same id.
    const want = `${r.id} ${r.title}`;
    const found = markdownBlockContext(spec).lines.some(
      (l) => (l.kind === "content" || l.kind === "code") && l.text.replace(/^#+\s+/, "") === want,
    );
    if (!found && headingCounts.has(r.id)) {
      problems.push(`${r.id}'s heading in spec.md does not match its requirements.json title "${r.title}"`);
    }
  }

  // --- traceability.md: every row reconciled cell-by-cell against the source of truth ---------
  //
  // Exact agreement, not a shape check. An inline comment used to be able to delete the
  // `manual:` prefix from an Evidence cell without changing a single rendered character; under
  // exact agreement any such edit is a mismatch that names the cell.
  const traceRows = traceabilityRows(trace, problems);
  const traceFirst = traceRows.filter((r) => r.inFirstTable);
  if (traceFirst.length === 0) {
    problems.push("traceability.md parsed to zero requirement rows — the coverage check cannot run");
  }

  // Shape is graded over EVERY row in the document, inside the first table or not.
  for (const row of traceRows) {
    if (row.cells.length !== EXPECTED_CELLS) {
      problems.push(
        `a traceability.md row has ${row.cells.length - 2} columns, expected 5: line ${row.number}`,
      );
      continue;
    }
    const status = row.cells[STATUS_INDEX];
    if (!REQUIREMENT_STATUSES.has(status)) {
      problems.push(
        `a traceability.md row has status "${status}", expected one of: ${[...REQUIREMENT_STATUSES].join(", ")} (line ${row.number})`,
      );
    }
  }

  const seenTrace = new Set();
  for (const row of traceFirst) {
    if (row.cells.length !== EXPECTED_CELLS) continue;
    const id = rowId(row, REQUIREMENT_ID, "traceability.md", problems);
    if (id === null) continue;
    if (seenTrace.has(id)) {
      problems.push(`${id} has more than one row in traceability.md — remove the duplicate`);
      continue;
    }
    seenTrace.add(id);
    const r = byId.get(id);
    if (!r) {
      problems.push(`traceability.md has a row for ${id}, which requirements.json does not declare`);
      continue;
    }
    const impls = paths(row.cells[IMPL_INDEX]);
    if (impls.join(", ") !== r.implementation.join(", ")) {
      problems.push(
        `${id}'s Implementation cell in traceability.md is \`${impls.join(", ")}\`, but requirements.json says \`${r.implementation.join(", ")}\``,
      );
    }
    const testsCell = row.cells[TESTS_INDEX];
    const testPaths = paths(testsCell);
    if (r.tests.length === 0) {
      // A requirement with no test must SAY so, as the single token `manual`, and back it with
      // a `manual:` note. A substring search for the word was satisfied by an Evidence cell
      // reading "no manual testing was ever performed and nothing is verified".
      if (testsCell !== "manual") {
        problems.push(
          `${id} has no tests in requirements.json, so its traceability.md Tests cell must read exactly \`manual\`, not "${testsCell}"`,
        );
      }
      if (!/^manual\s*:/.test(r.evidence)) {
        problems.push(`${id} has no tests, so its requirements.json evidence must open with "manual:"`);
      }
    } else if (testPaths.join(", ") !== r.tests.join(", ")) {
      problems.push(
        `${id}'s Tests cell in traceability.md is \`${testPaths.join(", ")}\`, but requirements.json says \`${r.tests.join(", ")}\``,
      );
    }
    if (row.cells[EVIDENCE_INDEX] !== r.evidence) {
      problems.push(`${id}'s Evidence cell in traceability.md does not match its requirements.json evidence`);
    }
    if (row.cells[STATUS_INDEX] !== r.status) {
      problems.push(
        `${id}'s Status cell in traceability.md is "${row.cells[STATUS_INDEX]}", but requirements.json says "${r.status}"`,
      );
    }
  }
  for (const id of ids) {
    if (!seenTrace.has(id)) problems.push(`${id} is in requirements.json but missing from traceability.md`);
  }

  // --- the filesystem: every path the source of truth names must exist ------------------------
  for (const r of declared) {
    for (const p of [...r.implementation, ...r.tests]) {
      if (!exists(p)) problems.push(`${r.id} references a missing file: ${p}`);
    }
  }

  // --- tasks.md ------------------------------------------------------------------------------

  const taskRows = taskTableRows(tasks, problems);
  const taskFirst = taskRows.filter((r) => r.inFirstTable);

  // Shape over EVERY row in the document. This is the F4 fix: rows past the table terminator
  // used to be parsed and then never graded, so a row citing an unrelated repository with a
  // status outside the closed enum passed green while rendering as an ordinary contract row.
  for (const row of taskRows) {
    const cells = row.cells;
    if (cells.length !== EXPECTED_CELLS) {
      problems.push(`a tasks.md work item has ${cells.length - 2} columns, expected 5: ${cells[TASK_INDEX]}`);
      continue;
    }

    // Scope, stated honestly: this grades a citation's SHAPE, not its truth. A self-consistent
    // citation of the wrong pull request still passes; only a human or a network call can catch
    // that. What is enforced is that every link is well formed, points at THIS repository, and
    // agrees with its own label.
    const cell = cells[PR_INDEX];
    const links = [...cell.matchAll(/\[#(\d+)\]\((\S+?)\)/g)];
    if (links.length === 0) {
      problems.push(`${cells[TASK_INDEX]} has no pull request link in its Pull request column`);
    }
    for (const [, label, url] of links) {
      const m = url.match(/^https:\/\/github\.com\/edgeorgie\/triage-desk\/pull\/(\d+)$/);
      if (!m) {
        problems.push(
          `${cells[TASK_INDEX]} cites #${label} with a link that is not an edgeorgie/triage-desk pull request: ${url}`,
        );
        continue;
      }
      if (label !== m[1]) {
        problems.push(`${cells[TASK_INDEX]} links to pull request #${m[1]} but is labelled #${label}`);
      }
    }

    const status = cells[STATUS_INDEX];
    if (!STATUSES.has(status)) {
      problems.push(`${cells[TASK_INDEX]} has status "${status}", expected one of: ${[...STATUSES].join(", ")}`);
    }
  }

  // Coverage comes only from the first table: an appendix must not certify anything.
  const claimedBy = new Map();
  for (const row of taskFirst) {
    if (row.cells.length !== EXPECTED_CELLS) continue;
    if (rowId(row, TASK_ID, "tasks.md", problems) === null) continue;
    const claims = requirementClaims(row.rawCells[REQUIREMENTS_INDEX]);
    if (claims === null) {
      problems.push(
        `${row.cells[TASK_INDEX]} has an unreadable Requirements cell "${describeToken(row.rawCells[REQUIREMENTS_INDEX])}", expected a comma-separated list of plain FR-n ids or "${QUALITY_ONLY}"`,
      );
      continue;
    }
    for (const id of claims) {
      if (!claimedBy.has(id)) claimedBy.set(id, []);
      claimedBy.get(id).push({ task: row.cells[TASK_INDEX], status: row.cells[STATUS_INDEX] });
    }
  }

  for (const id of ids) {
    const rows = claimedBy.get(id);
    if (!rows) {
      problems.push(`${id} is in requirements.json but no tasks.md work item claims it`);
      continue;
    }
    if (!rows.some((r) => DELIVERED_STATUSES.has(r.status))) {
      const where = rows.map((r) => `${r.task} (${r.status})`).join(", ");
      problems.push(`${id} is claimed only by work items that are not merged: ${where}`);
    }
  }
  for (const id of claimedBy.keys()) {
    if (!byId.has(id)) problems.push(`${id} is claimed by a tasks.md work item but is not in requirements.json`);
  }

  if (taskFirst.length === 0) {
    problems.push("tasks.md parsed to zero work-item rows — the coverage check cannot run");
  }

  return problems;
}

// Running as a script checks this repo's own documents; importing it from a test does not.
// Compared by resolved path rather than by string suffix, so the entry-point test cannot be
// fooled by how the script was invoked.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requirements = readFileSync("docs/spec/requirements.json", "utf8");
  const spec = readFileSync("docs/spec/spec.md", "utf8");
  const trace = readFileSync("docs/spec/traceability.md", "utf8");
  const tasks = readFileSync("docs/spec/tasks.md", "utf8");

  const problems = checkSpec({ requirements, spec, trace, tasks });
  if (problems.length > 0) {
    console.error(problems.map((p) => "- " + p).join("\n"));
    process.exit(1);
  }
  // The count is read from the structured source of truth, not derived from the markdown parse
  // that an attack would corrupt. A gate that computes its own count from the parse under attack
  // cannot witness its own truncation: five rounds of review watched this number move 9 -> 8
  // while the gate printed "passed".
  const declared = loadRequirements(requirements, []);
  console.log(`spec check passed: ${declared.length} requirements traced (from docs/spec/requirements.json)`);
}
