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
 * Requirement ids declared by the specification, read from any heading depth.
 *
 * `^### ` alone silently dropped a requirement demoted to `####` or indented under a list, which
 * removes it from the gate entirely rather than failing it — a parser that loses its subject is
 * the exact failure mode this check exists to prevent.
 */
export function requirementIds(spec) {
  return [...spec.matchAll(/^\s{0,3}#{2,6}\s+(FR-\d+)/gm)].map((m) => m[1]);
}

/**
 * Work-item rows from the FIRST markdown table in tasks.md, as arrays of trimmed cells.
 *
 * Block-aware on purpose. A line-at-a-time `/^\|\s*T-\d+/` accepted rows inside HTML comments
 * and fenced code blocks, so a tasks.md holding nothing but a commented-out table passed green —
 * and because those lines inflated the row count they also satisfied the zero-row guard meant to
 * catch exactly that, making the anti-vacuous guard itself vacuous. Merely documenting the row
 * format inside that file was enough to neuter the gate.
 *
 * Only the first table counts: a second table elsewhere in the document used to satisfy coverage
 * just as well, letting a requirement be "claimed" by a row no reader would take as a work item.
 */
export function taskTableRows(tasks) {
  const rows = [];
  let inFence = false;
  let inComment = false;
  let seenTable = false;

  for (const raw of tasks.split("\n")) {
    const line = raw.trim();

    if (!inComment && /^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // A comment may open and close on one line, so check for the terminator before latching.
    if (!inComment && line.includes("<!--")) {
      inComment = !line.includes("-->");
      continue;
    }
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }

    if (line.startsWith("|")) {
      seenTable = true;
      if (/^\|\s*T-\d+/.test(line)) rows.push(line.split("|").map((c) => c.trim()));
      continue;
    }
    // A non-blank, non-table line after the table began ends it: everything below is prose.
    if (seenTable && line !== "") break;
  }
  return rows;
}

// `| T-n | PR | branch | requirements | status |` splits into a leading and trailing empty cell
// around the five real columns, so the Requirements cell is at index 4 *only* for a five-column
// row. A row with any other column count is a malformed work item, not a licence to read some
// other cell as the claim.
const EXPECTED_CELLS = 7;
const TASK_INDEX = 1;
const PR_INDEX = 2;
const REQUIREMENTS_INDEX = 4;

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

  // The Pull request column is graded too. Rewriting every row's link to `#1` used to pass green,
  // so the column that makes a row auditable carried no weight at all — and T-6 shipped citing
  // the wrong pull request for exactly that reason.
  for (const cells of wellFormed) {
    const cell = cells[PR_INDEX];
    if (!/\[#\d+\]\(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\)/.test(cell)) {
      problems.push(`${cells[TASK_INDEX]} has no pull request link in its Pull request column`);
      continue;
    }
    const label = cell.match(/\[#(\d+)\]/)?.[1];
    const target = cell.match(/\/pull\/(\d+)\)/)?.[1];
    if (label !== target) {
      problems.push(`${cells[TASK_INDEX]} links to pull request #${target} but is labelled #${label}`);
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
