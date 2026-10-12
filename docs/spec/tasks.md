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
what stops anyone from reading it by hand. A cold review of the first version of that fix found
the same disease one level down — the row parser matched line by line, so a table inside an HTML
comment or a fenced code block counted as real work items. A `tasks.md` holding nothing but a
commented-out table passed green, and because the commented lines inflated the row count they
also satisfied the zero-row guard meant to catch exactly that. The anti-vacuous guard was itself
vacuous.

`scripts/check-spec.mjs` now asserts that

- every `FR-n` declared in `spec.md` is claimed by at least one row in this table,
- no row cites an `FR-n` that does not exist in `spec.md`,
- rows are read only from the first markdown table, skipping comments and code fences,
- every row has exactly five columns, so the Requirements cell cannot be read from the wrong
  position, and
- every row's Pull request cell holds a real link whose label matches its target. That column
  used to carry no weight at all: rewriting every row to point at `#1` passed green, and T-6
  shipped citing the wrong pull request for precisely that reason — the CSP work came from
  [#16](https://github.com/edgeorgie/triage-desk/pull/16), not
  [#11](https://github.com/edgeorgie/triage-desk/pull/11).

Requirement ids are also read from any heading depth now. `^### ` alone would have silently
dropped a requirement demoted to `####`, removing it from the gate rather than failing it.

Quality-only work (refactors, CI hardening, security guards that map to no single requirement)
is recorded as `none (quality)`. That is deliberate: forcing such work to invent a requirement
id would make the mapping dishonest rather than complete, so the check ignores those rows when
computing coverage instead of demanding an id from them. The hatch exempts a *row*, never a
*requirement* — marking a row `none (quality)` cannot hide an `FR-n` that spec.md declares.

Rows are not exhaustive over merged pull requests — listing every dependency bump would bury
the design decisions, and a hardcoded count here would be the same hand-maintained mirror this
file keeps proving rots. The invariant enforced is requirement *coverage*, not pull-request
coverage.
