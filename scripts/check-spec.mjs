import { createHash } from "node:crypto";
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
// SIX consecutive rounds of review hardened a hand-written markdown parser here, and every one of
// them shipped a working bypass. Rounds one to five patched CHARACTERS: whichever delimiter or
// confusable that round's reviewer used to hide a line was added to a deny-list, and the next
// reviewer found another. Round six changed the shape of the problem instead, and correctly:
// `docs/spec/requirements.json` became the source of truth for WHICH requirements exist, so
// hiding a line of markdown can no longer shrink the gate's subject.
//
// Round seven — this change — closes the bypasses round six left behind, and they share one
// cause that is NOT a character and NOT identity:
//
//   Round six hardened the IDENTITY layer and left the COLLECTION layer alone.
//
// Every grader only ever saw lines that a regex had already decided were rows, and headings that
// a regex had already decided were headings. The failure mode of those collection regexes was
// `continue` — silence. So a line that failed to match was not graded at all, while still
// rendering to a human as a perfectly ordinary contract row or heading. That is the same
// "invisible to the gate, visible to the reader" inversion the previous five rounds died of,
// moved one layer outward:
//
//   - `| Task 13 Disable CSP | ... |` inside the live first table of tasks.md does not match
//     `/^\|\s*\S*T-\d/`, so it was never collected and never column-counted, citation-graded or
//     status-graded. A foreign-repository pull request link and an invented status passed green.
//   - `### <U+2066>FR-22 ...` did not match the loose `looksLikeRequirementId` pre-filter, so it
//     was `continue`d. Removing a requirement was loud; PLANTING one was silent. "Reconciliation
//     is bidirectional" was true only for ids spelled the way the gate expected.
//
// The fix is therefore stated as a property of COLLECTION, not of a character set:
//
//   1. Every pipe-delimited line inside a table region is a row and is graded. Membership of the
//      graded set is no longer the attacker's choice. A row whose id cell does not canonicalise
//      to a plain `T-<n>` / `FR-<n>` is a NAMED error, not an uncollected line. Coverage is still
//      computed only from the first table — those are two different questions, now computed
//      separately rather than conflated by one regex.
//   2. The loose id pre-filter FAILS LOUD. A heading token that folds to `FR` plus a digit under
//      aggressive folding reaches the strict check and is REPORTED if it does not conform. A
//      non-ASCII codepoint anywhere in an id token is rejected outright: the allowlist is
//      `[A-Za-z0-9-]`, so nothing legitimate is lost and no future invisible needs deny-listing.
//   3. The gate's subject has a PERSISTED witness. A count the gate derives from its own parse
//      cannot witness that parse being truncated, and after round six the subject is
//      `requirements.json`, so truncating IT is the attack. `requirements.lock.json` records the
//      declared id set and its checksum; `spec:check` itself fails on drift, not a unit test.
//   4. `acceptance` — the substantive content of a requirement — is validated and reconciled in
//      both directions. Round six certified identity and five metadata fields while the
//      requirement's MEANING was unguarded: FR-8's CSP allowlist could be rewritten in spec.md to
//      "any origin" and the gate exited 0.
//
// Two rules from round six are preserved verbatim, because they are right and because losing
// them is how round five shipped a regression:
//
//   A. Block structure is classified on the RAW line. Normalisation is applied only to the
//      semantic content of lines that survived classification, so a character can never be folded
//      INTO a delimiter.
//   B. An id that is not already its own canonical form is a HARD ERROR naming the offending
//      text, never a silently different id.

// ---------------------------------------------------------------------------------------------
// Identity layer — requirement and task ids, under a strict allowlist
// ---------------------------------------------------------------------------------------------

/**
 * Zero-width characters, bidi controls and separators that are invisible in a renderer.
 *
 * This list exists to make an error message READ correctly ("it renders as FR-22"), not to decide
 * what is accepted. Deciding acceptance by deny-list is what produced five rounds of patches: the
 * attacker always had one more codepoint. Acceptance is decided by `ASCII_ID`, an allow-list.
 * U+2066-U+2069 (bidi isolates), U+FE00-U+FE0F (variation selectors), U+180E, U+115F, U+1160,
 * U+3164 and U+FFA0 are included because a sixth review landed a planted requirement through
 * U+2066 while this list did not cover it.
 */
const INVISIBLE =
  /[\u00ad\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
/** Combining marks, which can be stacked onto an ASCII letter to alias one id onto another. */
const COMBINING = /[\u0300-\u036f]/g;

/**
 * The only characters an id token may contain.
 *
 * Note honestly what this does and does not do. At every call site acceptance is
 * `conforming && REQUIREMENT_ID.test(canonical)` (or `TASK_ID`), and both patterns are anchored
 * and pure ASCII — so `canonical === token` plus an anchored ASCII pattern ALREADY implies the
 * token was ASCII. This allowlist is therefore defence in depth, not the operative check, and a
 * mutation that removes it does not turn the suite red. It is kept because it makes the intent
 * explicit at the identity layer and because it is what keeps the property true if a future
 * change ever loosens `REQUIREMENT_ID`; the equivalence is asserted in the suite so this comment
 * cannot drift from the code. The operative C-1 fix is `looksLikeRequirementId` failing loud.
 */
const ASCII_ID = /^[A-Za-z0-9-]+$/;

/** A requirement id, exactly. Anything else is a hard error rather than a different id. */
const REQUIREMENT_ID = /^FR-[1-9][0-9]*$/;
/** A work-item id, exactly. */
const TASK_ID = /^T-[1-9][0-9]*$/;

/**
 * Canonicalise an id token and report whether the token was ALREADY canonical AND pure ASCII.
 *
 * `conforming` is the load-bearing half. Earlier rounds normalised a confusable id into the real
 * one, which quietly made `FR-2<ZWJ>2` — a heading that renders as `FR-22` — into a second
 * `FR-2` that inherited the real FR-2's implementation, test, traceability row and task row. A
 * brand-new requirement therefore arrived pre-proven. Canonicalising is only ever used to
 * RECOGNISE that a token was meant to be an id; a token that needed canonicalising is rejected.
 *
 * The ASCII clause is the part that stops this being a deny-list. Round six's `conforming` test
 * was `canonical === token`, which passes for any non-ASCII codepoint that NFKC happens to leave
 * alone and that no deny-list names — U+2066 was exactly such a codepoint. An id is now required
 * to be `[A-Za-z0-9-]+` outright, so there is no "next character" to find.
 */
export function canonicaliseId(token) {
  const canonical = token
    .replace(INVISIBLE, "")
    .replace(COMBINING, "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .toUpperCase();
  return { canonical, conforming: canonical === token && ASCII_ID.test(token) };
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
 * This is the pre-filter whose failure mode used to be silence, and that silence was the bug: it
 * was a loose filter guarding entry into a strict check, so it — not the strict check — was the
 * real allowlist, and it was attacker-steerable. `/^FR-\d/` over the canonical form failed at
 * position 0 for `"\u2066FR-22"`, so the heading was `continue`d and the planted requirement was
 * never reported, while rendering on github.com as `FR-22 Delete any repository the agent can
 * reach`.
 *
 * The detector is therefore AGGRESSIVE and its hits are REPORTED, not skipped. Everything that is
 * not an ASCII letter or digit is stripped before testing, and `FR` followed by a digit is sought
 * ANYWHERE in what remains — not just at position 0, which is what a prefixed character defeats.
 * So every spelling of the id — bidi isolate, zero-width joiner, variation selector, fullwidth,
 * lowercase, unicode hyphen, Hangul filler, a mathematical-alphanumeric `F` — lands in the strict
 * check and is rejected BY NAME. Over-matching is the safe direction: a false positive is a loud
 * error on a heading that should not have been written that way. `Requirements`, `Baseline`,
 * `Non-goals`, `Open risks` and `Framework` do not match, and that is asserted.
 */
function looksLikeRequirementId(token) {
  const folded = token
    .replace(COMBINING, "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  return /FR\d/.test(folded);
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
 * not tracked inside a fence, where a comment opener is literal text.
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
    // from the gate's view, and an inline comment was enough to hide a row's cells from the
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
 * EVERY pipe-delimited line inside a table region, flagged with first-table membership.
 *
 * This is the COLLECTION layer, and it is where round six's remaining bypass lived. That version
 * took a `rowPattern` (`/^\|\s*\S*T-\d/`) and did `if (!rowPattern.test(line.text)) continue;`.
 * Its invariant was stated as "shape is graded over every MATCHING row" — literally true and
 * materially misleading, because matching was the attacker's choice. A row reading
 * `| Task 13 Disable CSP | [#1](https://github.com/attacker/evil/pull/1) | ... | Shipped |`
 * inside the LIVE first table matched nothing, so it was never collected and therefore received
 * zero grading: foreign-repository citation and invented status, exit 0, rendering as an ordinary
 * contract row.
 *
 * There is no row pattern any more. A table region is a run of consecutive content lines that
 * begin with `|`; every line in it is a row, and the caller grades all of them — including the id
 * cell, so a row that carries no readable id is itself a named error rather than an uncollected
 * line.
 *
 * Coverage remains a different question and is answered separately, from `inFirstTable` only: an
 * appendix of rejected drafts must not certify anything.
 *
 * Header validation applies to EVERY region, not just the first. A header is recognised the way
 * markdown recognises one — a row immediately followed by a `|---|---|` separator — so a second
 * table that misdescribes its own columns is reported instead of being silently graded by the
 * first table's positional indices. A region with no separator has no header and is all rows.
 */
function tableRows(ctx, { header, document: documentName, problems }) {
  const rows = [];
  let region = null;
  let regionCount = 0;

  const flush = () => {
    if (region === null) return;
    const group = region;
    region = null;
    regionCount += 1;
    const inFirstTable = regionCount === 1;

    let start = 0;
    if (group.length >= 2 && isSeparatorRow(group[1].text)) {
      const cells = splitRow(group[0].text);
      const actual = cells.slice(1, -1).join(" | ");
      const expected = header.join(" | ");
      if (actual !== expected) {
        problems.push(
          `${documentName} table header is \`${actual}\`, expected \`${expected}\` (line ${group[0].number})`,
        );
      }
      start = 2;
    }
    for (let i = start; i < group.length; i += 1) {
      const line = group[i];
      // A stray separator mid-table is formatting noise, not a contract row.
      if (isSeparatorRow(line.text)) continue;
      rows.push({
        cells: splitRow(line.text),
        rawCells: splitRow(line.raw),
        number: line.number,
        inFirstTable,
        id: null,
      });
    }
  };

  for (const line of ctx.lines) {
    // Blank, fenced and indented-code lines are block boundaries, and so is any non-pipe content.
    if (line.kind !== "content" || !line.text.startsWith("|")) {
      flush();
      continue;
    }
    (region ??= []).push(line);
  }
  flush();
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
 *
 * `acceptance` is validated here, and that is new. Round six validated `title`, `evidence`,
 * `implementation`, `tests` and `status` and never read `acceptance` at all — zero references in
 * the whole file — so the field carrying each requirement's actual testable MEANING could be
 * deleted, emptied, or replaced with the wrong type with no finding.
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
    if (
      !Array.isArray(entry.acceptance) ||
      entry.acceptance.length === 0 ||
      entry.acceptance.some((a) => typeof a !== "string" || a.trim() === "")
    ) {
      fieldProblems.push("acceptance");
    }
    if (fieldProblems.length > 0) {
      problems.push(`${id} in requirements.json has a missing or unreadable ${fieldProblems.join(", ")}`);
      continue;
    }
    out.push(entry);
  }
  return out.length === 0 ? null : out;
}

// ---------------------------------------------------------------------------------------------
// The persisted witness for the gate's own subject
// ---------------------------------------------------------------------------------------------

/**
 * The lock record for a set of declared ids: sorted ids, their count, and their checksum.
 *
 * A count a gate derives from the parse under attack cannot witness that parse being truncated.
 * Round six fixed the DERIVATION (the printed count comes from `requirements.json`, not from the
 * markdown) and stopped there — but after round six `requirements.json` IS the subject, so
 * truncating it is the attack. Removing FR-8 coherently from all four documents made the real
 * gate print `spec check passed: 8 requirements traced` and exit 0. The only thing that caught it
 * was a bare literal `9` in a unit test, which is an accidental witness: uncommented, inside a
 * test about something else, and routinely edited to make the suite green.
 *
 * So the witness is persisted, outside the subject, and `spec:check` itself fails on drift.
 * Deleting a requirement now requires a deliberate, reviewable edit to `requirements.lock.json`
 * in the same commit; it cannot happen as a side effect of editing prose or data.
 */
export function declaredIdLock(ids) {
  const sorted = [...ids].sort();
  return {
    count: sorted.length,
    ids: sorted,
    sha256: createHash("sha256").update(sorted.join("\n")).digest("hex"),
  };
}

/**
 * Reconcile the declared id set against its persisted lock, naming every id that moved.
 *
 * Three independent disagreements are reported, because each catches a different edit: the
 * checksum catches the lock's own id list being edited without recomputing it, the id set catches
 * a requirement appearing or disappearing, and the count catches a lock written by hand with a
 * stale total.
 */
export function reconcileDeclaredIds(lockJson, declared, problems) {
  const LOCK = "requirements.lock.json";
  let lock;
  try {
    lock = JSON.parse(lockJson);
  } catch (e) {
    problems.push(`${LOCK} is not valid JSON (${e.message}) — the gate cannot witness truncation of its own subject`);
    return;
  }
  if (
    lock === null ||
    typeof lock !== "object" ||
    !Array.isArray(lock.ids) ||
    lock.ids.some((i) => typeof i !== "string") ||
    typeof lock.sha256 !== "string" ||
    typeof lock.count !== "number"
  ) {
    problems.push(
      `${LOCK} must record a numeric count, an array of ids and a sha256 — the gate has no truncation witness`,
    );
    return;
  }

  const recomputed = declaredIdLock(lock.ids);
  if (recomputed.sha256 !== lock.sha256) {
    problems.push(
      `${LOCK} checksum does not match the id list it records (expected ${recomputed.sha256}, found ${lock.sha256}) — regenerate it with \`npm run spec:lock\``,
    );
  }
  if (lock.count !== lock.ids.length) {
    problems.push(`${LOCK} records a count of ${lock.count} but lists ${lock.ids.length} ids`);
  }

  const locked = new Set(lock.ids);
  const actual = new Set(declared.map((r) => r.id));
  for (const id of lock.ids) {
    if (!actual.has(id)) {
      problems.push(
        `${id} is recorded in ${LOCK} but is no longer declared in requirements.json — if the removal is deliberate, update ${LOCK} in the same commit`,
      );
    }
  }
  for (const id of actual) {
    if (!locked.has(id)) {
      problems.push(
        `${id} is declared in requirements.json but is not recorded in ${LOCK} — add it there in the same commit`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The three markdown documents, reconciled against the structured source
// ---------------------------------------------------------------------------------------------

/**
 * Normalise an acceptance criterion for comparison across the two documents that carry it.
 *
 * Inline code backticks and run-length whitespace are presentation, and spec.md legitimately
 * marks up identifiers that the JSON stores as plain text. Everything else — every word, every
 * host name in an allowlist — must agree exactly, so "allows scripts and connections from any
 * origin" can never silently replace a named allowlist.
 */
function normaliseCriterion(text) {
  return text.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Every requirement section declared by a heading in `spec.md`, with its acceptance criteria.
 *
 * This no longer DISCOVERS the gate's subject — `requirements.json` does — so a heading hidden
 * from this function can no longer remove a requirement from grading. What it does is reconcile:
 * the set of headings must equal the set of declared ids, in both directions, and each section's
 * title and acceptance criteria must match the structured source.
 *
 * The id pre-filter FAILS LOUD (see `looksLikeRequirementId`). A heading whose token folds to
 * `FR` plus a digit but is not a plain ASCII `FR-<n>` is reported by name rather than skipped,
 * which is what makes the claim "reconciliation is bidirectional" true for PLANTING as well as
 * for removal. Round six reported removals and silently ignored plants spelled with any
 * codepoint its deny-list did not name.
 *
 * A heading inside a fenced code block or an HTML comment does not declare a requirement: it is
 * not document content, so an example in prose cannot invent one. A heading inside an INDENTED
 * code block does, deliberately — indentation is never a way to remove a requirement.
 *
 * A section's ACCEPTANCE CRITERIA are the first contiguous run of `-` bullets inside it. That
 * boundary is a stated contract rather than a guess: it is what lets FR-9 carry a `Non-goals:`
 * list after its criteria without the two being conflated.
 */
export function specRequirementSections(spec, problems = []) {
  const sections = [];
  let current = null;
  let bulletsClosed = false;

  for (const line of markdownBlockContext(spec).lines) {
    if (line.kind !== "content" && line.kind !== "code") continue;

    // Read the token from the RAW text: the point is to SEE the confusable, not to fold it away.
    const heading = line.raw.match(/^#+\s+(\S+)/);
    if (heading) {
      current = null;
      bulletsClosed = false;
      const token = heading[1];
      if (!looksLikeRequirementId(token)) continue;
      const { canonical, conforming } = canonicaliseId(token);
      if (!conforming || !REQUIREMENT_ID.test(canonical)) {
        problems.push(
          `spec.md line ${line.number} declares a requirement id "${describeToken(token)}", which is not a plain \`FR-<n>\` id — it renders as ${canonical} but is not that id`,
        );
        continue;
      }
      // The TITLE is read from the normalised text, and only from the heading line itself.
      const titled = line.text.match(/^#+\s+\S+\s*([\s\S]*)$/);
      current = { id: canonical, title: (titled?.[1] ?? "").trim(), line: line.number, acceptance: [] };
      sections.push(current);
      continue;
    }

    if (current === null || bulletsClosed) continue;
    const bullet = line.text.match(/^[-*]\s+([\s\S]*)$/);
    if (bullet) {
      current.acceptance.push({ text: bullet[1].trim(), line: line.number });
      continue;
    }
    if (current.acceptance.length > 0) bulletsClosed = true;
  }

  return sections;
}

/** Requirement ids declared by a heading in `spec.md`, in document order. */
export function requirementIds(spec, problems = []) {
  return specRequirementSections(spec, problems).map((s) => s.id);
}

const TRACE_HEADER = ["Requirement", "Implementation", "Tests", "Evidence", "Status"];
const TASKS_HEADER = ["Task", "Pull request", "Branch", "Requirements", "Status"];

/** Every row of every table in traceability.md, flagged with first-table membership. */
export function traceabilityRows(trace, problems = []) {
  return tableRows(markdownBlockContext(trace), {
    header: TRACE_HEADER,
    document: "traceability.md",
    problems,
  });
}

/** Every row of every table in tasks.md, flagged with first-table membership. */
export function taskTableRows(tasks, problems = []) {
  return tableRows(markdownBlockContext(tasks), {
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
 *
 * This now runs over EVERY row in a table region, not only over rows a pattern already accepted.
 * A row whose first cell reads `Task 13 Disable CSP` is a row with an unreadable id — a named
 * error — rather than a line the gate never saw.
 */
function rowId(row, pattern, documentName, problems) {
  const token = (row.rawCells[ID_INDEX] ?? "").split(/\s+/)[0] ?? "";
  const { canonical, conforming } = canonicaliseId(token);
  if (!conforming || !pattern.test(canonical)) {
    problems.push(
      `${documentName} line ${row.number} is a table row whose id is "${describeToken(token)}", which is not a plain \`${pattern === REQUIREMENT_ID ? "FR" : "T"}-<n>\` id`,
    );
    return null;
  }
  return canonical;
}

/**
 * Every problem found across the structured source and the three documents it describes.
 *
 * `requirements` is the JSON text of `docs/spec/requirements.json` and `lock` the JSON text of
 * `docs/spec/requirements.lock.json`. `exists` is injected so tests can describe a filesystem
 * without touching one.
 *
 * The parameter types are declared rather than inferred: `lock = null` alone makes the checker
 * infer `null` as the whole type of the parameter, so every real caller passing lock text becomes
 * a type error. `lock` is optional because unit tests exercise the other checks without building a
 * lock; the real entry point always passes one, and a missing lock is itself reported.
 *
 * @param {object} input
 * @param {string} input.requirements
 * @param {string} [input.lock]
 * @param {string} input.spec
 * @param {string} input.trace
 * @param {string} input.tasks
 * @param {(path: string) => boolean} [input.exists]
 * @returns {string[]}
 */
export function checkSpec({ requirements, lock = null, spec, trace, tasks, exists = existsSync }) {
  const problems = [];

  problems.push(...blockStructureProblems("spec.md", markdownBlockContext(spec)));
  problems.push(...blockStructureProblems("traceability.md", markdownBlockContext(trace)));
  problems.push(...blockStructureProblems("tasks.md", markdownBlockContext(tasks)));

  const declared = loadRequirements(requirements, problems);
  if (declared === null) return problems;

  // The persisted truncation witness, checked before anything derived from the subject, so a
  // coherent deletion is reported even when every document agrees with itself afterwards.
  if (typeof lock !== "string") {
    problems.push("requirements.lock.json was not read — the gate has no witness for its own subject");
  } else {
    reconcileDeclaredIds(lock, declared, problems);
  }

  const byId = new Map(declared.map((r) => [r.id, r]));
  const ids = [...byId.keys()];

  // --- spec.md: the prose must declare exactly the requirements the source of truth declares --
  //
  // Both directions matter, and both are now loud. A heading hidden by any construct whatsoever
  // shows up as a declared requirement with no heading; a heading PLANTED with any spelling the
  // strict allowlist rejects shows up as a named id error rather than being skipped.
  const sections = specRequirementSections(spec, problems);
  const headingCounts = new Map();
  for (const s of sections) headingCounts.set(s.id, (headingCounts.get(s.id) ?? 0) + 1);
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

  for (const s of sections) {
    const r = byId.get(s.id);
    if (!r) continue;

    // The title is anchored to THE heading line found for this id. Round six searched every
    // content line for `l.text.replace(/^#+\s+/, "") === want`, and the `replace` was optional,
    // so any bare prose line matched just as well: renaming a heading and adding a decoy
    // paragraph carrying the old title passed green.
    if (s.title !== r.title) {
      problems.push(
        `${s.id}'s heading in spec.md does not match its requirements.json title "${r.title}" — line ${s.line} reads "${s.title}"`,
      );
    }

    // Acceptance criteria, reconciled in both directions and in order. This is the requirement's
    // substance: round six read this field NOWHERE, so FR-8's CSP allowlist could be rewritten in
    // spec.md to permit any origin and the gate exited 0.
    const got = s.acceptance.map((a) => normaliseCriterion(a.text));
    const want = r.acceptance.map(normaliseCriterion);
    if (got.length !== want.length) {
      problems.push(
        `${s.id} has ${got.length} acceptance criteria under its heading in spec.md but ${want.length} in requirements.json`,
      );
    }
    for (let i = 0; i < Math.min(got.length, want.length); i += 1) {
      if (got[i] !== want[i]) {
        problems.push(
          `${s.id}'s acceptance criterion ${i + 1} in spec.md (line ${s.acceptance[i].line}) does not match requirements.json: spec.md says "${got[i]}", requirements.json says "${want[i]}"`,
        );
      }
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

  // Shape is graded over EVERY row in EVERY table region — including the id cell, which is what
  // stops a row opting out of grading by not looking like one.
  for (const row of traceRows) {
    if (row.cells.length !== EXPECTED_CELLS) {
      problems.push(
        `a traceability.md row has ${row.cells.length - 2} columns, expected 5: line ${row.number}`,
      );
      continue;
    }
    row.id = rowId(row, REQUIREMENT_ID, "traceability.md", problems);
    const status = row.cells[STATUS_INDEX];
    if (!REQUIREMENT_STATUSES.has(status)) {
      problems.push(
        `a traceability.md row has status "${status}", expected one of: ${[...REQUIREMENT_STATUSES].join(", ")} (line ${row.number})`,
      );
    }
  }

  // Coverage comes only from the first table.
  const seenTrace = new Set();
  for (const row of traceFirst) {
    if (row.cells.length !== EXPECTED_CELLS) continue;
    const id = row.id;
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

  // Shape over EVERY row in EVERY table region, id cell included. The row that defeated round
  // six — `| Task 13 Disable CSP | [#1](https://github.com/attacker/evil/pull/1) | ... |` inside
  // the LIVE first table — is now three named findings rather than silence.
  for (const row of taskRows) {
    const cells = row.cells;
    if (cells.length !== EXPECTED_CELLS) {
      problems.push(`a tasks.md work item has ${cells.length - 2} columns, expected 5: ${cells[TASK_INDEX]}`);
      continue;
    }

    row.id = rowId(row, TASK_ID, "tasks.md", problems);

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
    if (row.id === null) continue;
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
  const lock = readFileSync("docs/spec/requirements.lock.json", "utf8");
  const spec = readFileSync("docs/spec/spec.md", "utf8");
  const trace = readFileSync("docs/spec/traceability.md", "utf8");
  const tasks = readFileSync("docs/spec/tasks.md", "utf8");

  const problems = checkSpec({ requirements, lock, spec, trace, tasks });
  if (problems.length > 0) {
    console.error(problems.map((p) => "- " + p).join("\n"));
    process.exit(1);
  }
  // The count is read from the structured source of truth, not derived from the markdown parse
  // that an attack would corrupt — AND the structured source is itself reconciled against the
  // persisted lock above, so a coherent deletion of a requirement from every document on disk
  // fails this gate instead of printing a quietly smaller number.
  const declared = loadRequirements(requirements, []);
  console.log(
    `spec check passed: ${declared.length} requirements traced (from docs/spec/requirements.json, witnessed by docs/spec/requirements.lock.json)`,
  );
}
