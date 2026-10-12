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
| T-12 Make requirements.json the source of truth for the coverage gate | [#56](https://github.com/edgeorgie/triage-desk/pull/56) | `fix/spec-gate-structured-source-of-truth` | none (quality) | Merged |

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
you are looking at. All three documents were then routed through one shared block-context reader,
so there was a single implementation of "what counts as document content".

**That was still not enough, and the fifth review proved it the hard way.** The unification added
NFKC normalisation to stop a confusable deleting a line, and applied it *before* classifying
fences and HTML comments. So every character NFKC folds **into** a delimiter became a delimiter:
three U+FF40 fullwidth grave accents became a ``` fence, and U+FF1C U+FF01 U+FF0D U+FF0D became
the ASCII HTML comment opener. Those render as their original literal text in every markdown
renderer, so a document
looked completely normal on github.com while the gate treated part of it as commented out and
stopped grading it. The CSP security requirement FR-8 could be removed from all three documents,
an unbuilt FR-22 planted, and the gate printed `spec check passed: 8 requirements traced` and
exited 0. The same attack against the *previous* commit exited 1 — the hardening was a regression.

The structural answer, and the reason this file reads differently from here on: **the gate no
longer discovers which requirements exist by parsing prose.** `docs/spec/requirements.json` — which
already existed in this repository and which the gate never read — is the source of truth for
requirement identity, and the three markdown documents are *reconciled* against it.

```
  docs/spec/requirements.json  ← SOURCE OF TRUTH for identity
       (JSON.parse; strict `FR-<n>` allowlist; every field validated)
                  │
                  │  the expected id set, and each requirement's
                  │  implementation / tests / evidence / status
                  ▼
      ┌──────────────────── reconcile ────────────────────┐
      │                     │                             │
   spec.md             traceability.md                 tasks.md
   headings            first-table rows               first-table rows  → COVERAGE
      │                     │                             │
      └─── all read through markdownBlockContext ──────────┘
                            │                        ALL rows → SHAPE
                            ▼
              classify block structure on the RAW line
              (fences, HTML comments — nothing folded yet)
                            │
                            ▼
              normalise SEMANTIC CONTENT of surviving lines
              (NFKC, unicode hyphens — structure already decided)
                            │
                            ▼
              ids go through the strict allowlist, which REJECTS
              a non-conforming spelling rather than folding it
```

Two rules make that reading safe, and they are the root-cause fixes:

1. **Block structure is classified on the raw line.** Normalisation is applied only to the
   semantic content of lines that survived classification, so a character can never be folded
   into a delimiter. Folding a U+2011 hyphen in a row's title is still correct and still happens —
   just downstream of the decision about what is a fence.
2. **A requirement or task id is confined to a strict ASCII allowlist at the identity layer.** An
   id that is not already its own canonical form is a hard error naming the offending characters.
   Five rounds of "normalise it away" produced five ways to alias one requirement onto another's
   proof: `FR-2<ZWJ>2` renders as `FR-22` and used to parse as a duplicate `FR-2`, inheriting the
   real FR-2's implementation, test, traceability row and task row, so a brand-new requirement
   arrived pre-proven.

The printed count is read from `requirements.json`, not derived from the markdown parse. A count a
gate computes from the same parse an attack corrupts cannot witness its own truncation — which is
why five rounds watched it move 9 → 8 while the gate printed "passed".

`scripts/check-spec.mjs` now asserts that

- `requirements.json` parses, is a non-empty array, and every entry has a conforming `FR-<n>` id
  and a readable title, implementation, tests, evidence and status — or the gate reports that it
  has no subject rather than a clean sheet,
- `spec.md` declares a heading for exactly the requirements `requirements.json` declares, with
  matching titles, in both directions,
- every row of this table's and `traceability.md`'s **first** table agrees with `requirements.json`
  cell by cell, so an edit that changes what the gate reads without changing what renders is a
  mismatch that names the cell,
- every `FR-n` declared is claimed by at least one row in this table, and no row cites an `FR-n`
  that `requirements.json` does not declare,
- at least one row claiming an `FR-n` has Status `Merged`, so a requirement cannot be "covered"
  by work the table itself records as abandoned or unfinished,
- a row's Requirements cell is a comma-separated list of bare `FR-n` ids or exactly
  `none (quality)`, so prose such as "explicitly NOT FR-9" is a malformed cell rather than a
  claim to have delivered FR-9,
- **coverage** is computed only from the first table in each document, which ends at the first
  line that is not one of its rows — but **shape** (column count, citation, status enum) is graded
  over *every* matching row anywhere in the document. Those are different questions and were
  conflated: rows past the terminator used to be parsed and then never graded, so a row citing an
  unrelated repository with the literal status text "NOT A REAL STATUS" passed green while
  rendering as an ordinary contract row,
- the table's header row matches the columns the checker reads by position, so the document
  cannot misdescribe its own columns,
- every row has exactly five columns — counting pipes inside inline code and escaped pipes as
  text, not separators,
- every link in a row's Pull request cell points at a pull request *in this repository* and
  agrees with its own label, and
- every row's Status is one of `Merged`, `In review`, `In progress` or `Abandoned`.

Requirement ids are read from a heading at any depth and any indentation. A heading inside a
code fence or inside an HTML comment does not declare a requirement, so an example in the prose
cannot invent one and commenting out work the project decided not to build does not break the
build. A heading indented four or more spaces *does* still declare one: of the two ways to be
wrong, inventing a requirement that must then be proven is the safe direction. An unterminated
fence or comment, which hides every line after it, is reported rather than silently swallowing the
rest of the file.

The anti-duplication guard is **shape-based**, not keyed to an identifier spelling. The previous
one grepped the source for the literal tokens `function fenceDelimiter` and the HTML comment
opener, and a cold review defeated it by appending a second, fully working parser with renamed
helpers and that opener assembled by string concatenation — 83 of 83 tests stayed green with a
sixth near-copy in the file. The guard now
extracts the module's top-level function bodies, folds string concatenation, and scans each body
for block-structure *primitives*, requiring the set of carriers to equal a two-name allowlist that
has its own assertion. It is mutation-validated against exactly that renamed duplicate.

**What this gate does not and cannot check.** The Pull request column is graded for *shape*, not
truth: a self-consistent citation of the wrong pull request still passes. T-6 originally
attributed FR-8 to [#11](https://github.com/edgeorgie/triage-desk/pull/11) when the CSP work came
from [#16](https://github.com/edgeorgie/triage-desk/pull/16), and no offline check can catch that
— only a reader or a network call can. Likewise the Status column is checked against a closed set
of values but not against whether its pull request really merged, for the same reason. And the
gate cannot tell whether `requirements.json` itself is honest: editing it is now the way to change
what the project is accountable for, which is the intended tradeoff — that edit is structured,
machine-readable and visible in a diff, rather than an invisible character in prose. Both are
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
