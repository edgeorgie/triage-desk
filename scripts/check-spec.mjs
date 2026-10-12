import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Fails when a requirement has no implementation file, no test or manual evidence, points at a
// missing file, or is not claimed by a work item in tasks.md.
//
// The logic lives in exported pure functions so `tests/check-spec.test.ts` can drive it over
// crafted documents. Before that split, the only validation this gate ever had was a manual
// mutation exercise recorded in a pull request body — nothing re-ran it, so every bypass found
// by review could regress silently the next time the parser was touched. A gate whose own
// correctness is unverified by anything executable is the same defect it exists to catch.

/**
 * Requirement ids declared by the specification, read from a heading at ANY depth.
 *
 * `^### ` alone silently dropped a requirement demoted to `####` or indented under a list, which
 * removes it from the gate entirely rather than failing it — a parser that loses its subject is
 * the exact failure mode this check exists to prevent. A review then showed the first attempt at
 * "any depth" still missed `#` (depth one) and anything indented four spaces or more, i.e. the
 * exact "indented under a list" case it claimed to handle. Depth and indentation are now
 * genuinely unbounded, and a heading inside a fenced code block is excluded so an example in the
 * prose cannot invent a requirement.
 */
export function requirementIds(spec) {
  const ids = [];
  let inFence = false;
  for (const raw of spec.split("\n")) {
    if (fenceDelimiter(raw.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = raw.match(/^\s*#+\s+(FR-\d+)\b/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/**
 * True when a trimmed line opens or closes a fenced code block.
 *
 * Markdown allows any run of three or more backticks or tildes, so a four-backtick fence can
 * contain a three-backtick line. A boolean toggle flipped on the inner line and leaked fence
 * state across the rest of the document, hiding ten of eleven real work items while the gate
 * stayed green. Callers must therefore track the opening delimiter, not just a flag.
 */
function fenceDelimiter(line) {
  const m = line.match(/^(`{3,}|~{3,})/);
  return m ? m[1] : null;
}

/**
 * Work-item rows from the contract table in tasks.md, as arrays of trimmed cells.
 *
 * Block-aware on purpose. A line-at-a-time `/^\|\s*T-\d+/` accepted rows inside HTML comments
 * and fenced code blocks, so a tasks.md holding nothing but a commented-out table passed green —
 * and because those lines inflated the row count they also satisfied the zero-row guard meant to
 * catch exactly that, making the anti-vacuous guard itself vacuous. Merely documenting the row
 * format inside that file was enough to neuter the gate.
 *
 * Only the FIRST table counts, and a blank line ends it. The first attempt at this ended the
 * table only on a non-blank, non-table line, so a fake row one blank line below the real table
 * was still accepted — "first table only" was asserted in a comment and not implemented, and its
 * test passed only because the fixture happened to separate the tables with prose.
 */
export function taskTableRows(tasks) {
  const rows = [];
  let fence = null;
  let inComment = false;
  let seenTable = false;

  for (const raw of tasks.split("\n")) {
    let line = raw.trim();

    // Fence state is keyed on the opening delimiter: only an equal-or-longer run of the same
    // character closes it, so an inner shorter fence cannot flip it.
    const delim = fenceDelimiter(line);
    if (fence) {
      if (delim && delim[0] === fence[0] && delim.length >= fence.length) fence = null;
      continue;
    }
    if (!inComment && delim) {
      fence = delim;
      continue;
    }

    // Comments are stripped rather than skipped by line. An inline `<!-- … -->` used to discard
    // the whole line, which deleted real rows from the gate's view — including a row whose cells
    // then escaped the pull-request grader entirely.
    if (inComment) {
      const end = line.indexOf("-->");
      if (end === -1) continue;
      line = line.slice(end + 3).trim();
      inComment = false;
    }
    while (true) {
      const open = line.indexOf("<!--");
      if (open === -1) break;
      const close = line.indexOf("-->", open + 4);
      if (close === -1) {
        line = line.slice(0, open).trim();
        inComment = true;
        break;
      }
      line = (line.slice(0, open) + line.slice(close + 3)).trim();
    }
    if (line === "") {
      // A blank line ends the contract table. Everything further down the document — prose,
      // a second table, an appendix — is outside it by construction.
      if (seenTable) break;
      continue;
    }

    if (line.startsWith("|")) {
      seenTable = true;
      if (/^\|\s*T-\d+/.test(line)) rows.push(splitRow(line));
      continue;
    }
    if (seenTable) break;
  }
  return rows;
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

// `| T-n | PR | branch | requirements | status |` splits into a leading and trailing empty cell
// around the five real columns, so the Requirements cell is at index 4 *only* for a five-column
// row. A row with any other column count is a malformed work item, not a licence to read some
// other cell as the claim.
const EXPECTED_CELLS = 7;
const TASK_INDEX = 1;
const PR_INDEX = 2;
const REQUIREMENTS_INDEX = 4;
const STATUS_INDEX = 5;

/**
 * Every problem found in the three specification documents, as human-readable strings.
 *
 * `exists` is injected so tests can describe a filesystem without touching one.
 */
export function checkSpec({ spec, trace, tasks, exists = existsSync }) {
  const problems = [];

  const ids = requirementIds(spec);
  if (ids.length === 0) {
    // Not a finding about the documents: the parser has lost its subject and every downstream
    // assertion would be vacuous, so say that instead of reporting a clean sheet.
    problems.push("spec.md yielded zero FR-n requirements — the parser cannot be trusted");
    return problems;
  }

  const traceRows = new Map(
    trace
      .split("\n")
      .filter((l) => /^\| FR-\d+ /.test(l))
      .map((l) => [l.split("|")[1].trim(), l.split("|").map((c) => c.trim())]),
  );

  for (const id of ids) {
    const cells = traceRows.get(id);
    if (!cells) {
      problems.push(`${id} is in spec.md but missing from traceability.md`);
      continue;
    }
    const [, , impl, tests, evidence] = cells;
    const paths = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const impls = paths(impl);
    if (impls.length === 0) problems.push(`${id} has no implementation file`);
    for (const p of [...impls, ...paths(tests)]) if (!exists(p)) problems.push(`${id} references a missing file: ${p}`);
    if (paths(tests).length === 0 && !/manual/i.test(tests + evidence)) {
      problems.push(`${id} has neither a test nor manual evidence`);
    }
  }
  for (const id of traceRows.keys()) if (!ids.includes(id)) problems.push(`${id} is in traceability.md but not in spec.md`);

  const taskRows = taskTableRows(tasks);
  for (const cells of taskRows.filter((c) => c.length !== EXPECTED_CELLS)) {
    problems.push(`a tasks.md work item has ${cells.length - 2} columns, expected 5: ${cells[TASK_INDEX]}`);
  }

  const wellFormed = taskRows.filter((c) => c.length === EXPECTED_CELLS);
  const claimed = new Set(
    wellFormed.flatMap((cells) => [...cells[REQUIREMENTS_INDEX].matchAll(/FR-\d+/g)].map((m) => m[0])),
  );

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

  // The Status column is graded against a closed enum. The original bug had two halves — a
  // missing row AND a row reading `In review` long after its pull request merged — and only the
  // first half was closed. Whether a pull request is really merged needs the network, so that
  // stays out of an offline gate; what is checkable here is that the value is one the project
  // actually defines, so a typo or an invented status cannot sit in the table unnoticed.
  const STATUSES = new Set(["Merged", "In review", "In progress", "Abandoned"]);
  for (const cells of wellFormed) {
    const status = cells[STATUS_INDEX];
    if (!STATUSES.has(status)) {
      problems.push(`${cells[TASK_INDEX]} has status "${status}", expected one of: ${[...STATUSES].join(", ")}`);
    }
  }

  for (const id of ids) if (!claimed.has(id)) problems.push(`${id} is in spec.md but no tasks.md work item claims it`);
  for (const id of claimed) if (!ids.includes(id)) problems.push(`${id} is claimed by a tasks.md work item but not in spec.md`);

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
