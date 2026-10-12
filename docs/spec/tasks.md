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

`scripts/check-spec.mjs` now asserts that

- every `FR-n` declared in `spec.md` is claimed by at least one row in this table,
- no row cites an `FR-n` that does not exist in `spec.md`,
- rows come only from the first table, which a blank line ends, with comments stripped inline and
  fenced blocks tracked by their opening delimiter,
- every row has exactly five columns — counting pipes inside inline code and escaped pipes as
  text, not separators — so the Requirements cell cannot be read from the wrong position,
- every link in a row's Pull request cell points at a pull request *in this repository* and
  agrees with its own label, and
- every row's Status is one of `Merged`, `In review`, `In progress` or `Abandoned`.

Requirement ids are read from a heading at any depth and any indentation, and a heading inside a
fenced block does not declare one. A `spec.md` yielding zero requirements reports a parser
failure rather than a clean sheet.

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
