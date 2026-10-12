# Tasks: triage-desk

Work items in the order they landed. Each links to the pull request that carries its verification notes.

| Task | Pull request | Branch | Requirements | Status |
|---|---|---|---|---|
| T-1 Agent loop, tools and validation | [#1](https://github.com/edgeorgie/triage-desk/pull/1) | `feature/agent-core` | FR-1, FR-3, FR-4 | Merged |
| T-2 Timeline and ruling card | [#3](https://github.com/edgeorgie/triage-desk/pull/3) | `feature/restyle` | FR-2, FR-5 | Merged |
| T-3 Keyboard, batch and export | [#4](https://github.com/edgeorgie/triage-desk/pull/4) | `feature/keyboard-batch` | FR-6 | Merged |
| T-4 Production readiness | [#5](https://github.com/edgeorgie/triage-desk/pull/5) | `feature/production-readiness` | none (quality) | Merged |
| T-5 Opt-in cookieless analytics | [#33](https://github.com/edgeorgie/triage-desk/pull/33) | `feature/posthog-analytics` | FR-9 | Merged |
| T-6 Content Security Policy on the static export | [#16](https://github.com/edgeorgie/triage-desk/pull/16) | `fix/keyboard-run-guard-and-keys` | FR-8 | Merged |
| T-7 Provider key kept in the session by default | [#16](https://github.com/edgeorgie/triage-desk/pull/16) | `fix/keyboard-run-guard-and-keys` | FR-7 | Merged |
| T-8 Gate the `/ingest` proxy on the key | [#34](https://github.com/edgeorgie/triage-desk/pull/34) | `fix/gate-ingest-proxy` | FR-9 | Merged |
| T-9 Run the test suite in CI and pin every action ref | [#43](https://github.com/edgeorgie/triage-desk/pull/43) | `fix/critic-f1-f8-ci-and-parser` | none (quality) | Merged |
| T-10 Resolve local action refs and gate container images | [#47](https://github.com/edgeorgie/triage-desk/pull/47) | `fix/action-pin-guard-resolve-local-actions` | none (quality) | Merged |
| T-11 Grade job-level workflow permissions | [#50](https://github.com/edgeorgie/triage-desk/pull/50) | `security/ci-job-level-permissions-guard` | none (quality) | Merged |

New work starts in `spec.md`, then adds a row here before code.

## How this table stays honest

"Adds a row here before code" was a stated contract with nothing enforcing it, and it was
violated. FR-7 (session-scoped provider key) and FR-8 (CSP on the static export) shipped with
implementations, tests and traceability rows but never got a task row at all, and T-5 sat at
`In review` long after [#33](https://github.com/edgeorgie/triage-desk/pull/33) merged.
`npm run spec:check` reported "9 requirements traced" throughout, because it read only
`spec.md` and `traceability.md` and never opened this file.

A gate that certifies a document it does not read is worse than no gate: the green tick is
what stops anyone from reading it by hand. Two independent cold reviews then found the same
disease one layer down each time, which is the honest history of this section.

The first review showed the row parser matched line by line, so a table inside an HTML comment
or a fenced code block counted as real work items. A `tasks.md` holding nothing but a
commented-out table passed green — and because the commented lines inflated the row count, they
also satisfied the zero-row guard added to catch exactly that. The anti-vacuous guard was itself
vacuous.

The second review landed eight further bypasses against the fix for the first, because every
test written for it exercised only the fixture already known to be correct, never a boundary. A
blank line did not end the table, so a fake row one line below the real one still counted —
"first table only" was asserted in a comment and never implemented. A four-backtick fence was
closed by a three-backtick line inside it, leaking fence state and hiding ten of the eleven real
rows. An inline `<!-- -->` deleted the row carrying it. Pull request links to *any* repository on
GitHub were accepted, and only the first link in a cell was graded. Requirement headings at depth
one or indented four spaces vanished silently, which was the exact case the fix claimed to have
handled.

The third review found that every one of those fixes had landed in the parser for *this* file
and nowhere else. `scripts/check-spec.mjs` held three parsers of wildly unequal strength — one
per document — and each round had hardened whichever one that round's reviewer attacked. So the
same bypasses were still live one document over: wrapping the whole of `traceability.md`'s table
in `<!-- -->`, or in a code fence, left the gate printing "9 requirements traced" with no
traceability present at all, and a leaked four-backtick fence in `spec.md` let a requirement be
declared with no implementation, no test, no traceability row and no task row while the printed
count stayed at 9 — because the anti-vacuous guard only ever caught *total* loss of a document's
subject, never partial.

That is the lesson this section exists to record: a bypass is not closed by fixing the parser
you are looking at. All three documents are now read through one shared block-context reader, so
there is a single implementation of "what counts as document content" and a construct closed
anywhere is closed everywhere. The adversarial tests are parameterised over all three documents
for the same reason.

`scripts/check-spec.mjs` now asserts that

- every `FR-n` declared in `spec.md` is claimed by at least one row in this table,
- no row cites an `FR-n` that does not exist in `spec.md`,
- at least one row claiming an `FR-n` has Status `Merged`, so a requirement cannot be "covered"
  by work the table itself records as abandoned or unfinished,
- a row's Requirements cell is a comma-separated list of bare `FR-n` ids or exactly
  `none (quality)`, so prose such as "explicitly NOT FR-9" is a malformed cell rather than a
  claim to have delivered FR-9,
- rows come only from the first table in the document, which ends at the first line that is not
  one of its rows — a blank line, prose, a code fence, or a four-space-indented code block,
- the table's header row matches the columns the checker reads by position, so the document
  cannot misdescribe its own columns,
- every row has exactly five columns — counting pipes inside inline code and escaped pipes as
  text, not separators — so the Requirements cell cannot be read from the wrong position,
- every link in a row's Pull request cell points at a pull request *in this repository* and
  agrees with its own label, and
- every row's Status is one of `Merged`, `In review`, `In progress` or `Abandoned`.

The same reader grades `traceability.md`, which previously had none of this: its rows also come
only from its first table, are checked for exactly five columns and for a header matching the
columns read, a second row for the same requirement is an error rather than silently replacing
the first, and manual evidence must be claimed as `manual` in the Tests column together with a
`manual:` note in Evidence — a substring search for the word "manual" was satisfied by evidence
text reading "no manual testing was ever performed".

Requirement ids are read from a heading at any depth and any indentation. A heading inside a
code fence or inside an HTML comment does not declare a requirement, so an example in the prose
cannot invent one and commenting out work the project decided not to build does not break the
build. A heading indented four or more spaces *does* still declare one: of the two ways to be
wrong, inventing a requirement that must then be proven is the safe direction, while dropping one
would let unbuilt work through — indentation is therefore never a way to remove a requirement
from this gate. Text that renders identically is parsed identically, so a non-breaking hyphen or
space cannot delete a line from the checks. An unterminated fence or comment, which hides every
line after it, is reported rather than silently swallowing the rest of the file, and a `spec.md`
yielding zero requirements or a document whose table parses to zero rows reports a parser failure
rather than a clean sheet.

**What this gate does not and cannot check.** The Pull request column is graded for *shape*, not
truth: a self-consistent citation of the wrong pull request still passes. T-6 originally
attributed FR-8 to [#11](https://github.com/edgeorgie/triage-desk/pull/11) when the CSP work came
from [#16](https://github.com/edgeorgie/triage-desk/pull/16), and no offline check can catch that
— only a reader or a network call can. Likewise the Status column is checked against a closed set
of values but not against whether its pull request really merged, for the same reason. Both are
stated here rather than implied as covered, because the whole point of this section is that a
gate claiming more than it enforces is the original bug.

Quality-only work (refactors, CI hardening, security guards that map to no single requirement)
is recorded as `none (quality)`. That is deliberate: forcing such work to invent a requirement
id would make the mapping dishonest rather than complete, so the check ignores those rows when
computing coverage instead of demanding an id from them. The hatch exempts a *row*, never a
*requirement* — marking a row `none (quality)` cannot hide an `FR-n` that spec.md declares.

Rows are not exhaustive over merged pull requests — listing every dependency bump would bury
the design decisions, and a hardcoded count here would be the same hand-maintained mirror this
file keeps proving rots. The invariant enforced is requirement *coverage*, not pull-request
coverage.
