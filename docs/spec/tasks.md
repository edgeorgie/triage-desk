# Tasks: triage-desk

Work items in the order they landed. Each links to the pull request that carries its verification notes.

| Task | Pull request | Branch | Requirements | Status |
|---|---|---|---|---|
| T-1 Agent loop, tools and validation | [#1](https://github.com/edgeorgie/triage-desk/pull/1) | `feature/agent-core` | FR-1, FR-3, FR-4 | Merged |
| T-2 Timeline and ruling card | [#3](https://github.com/edgeorgie/triage-desk/pull/3) | `feature/restyle` | FR-2, FR-5 | Merged |
| T-3 Keyboard, batch and export | [#4](https://github.com/edgeorgie/triage-desk/pull/4) | `feature/keyboard-batch` | FR-6 | Merged |
| T-4 Production readiness | [#5](https://github.com/edgeorgie/triage-desk/pull/5) | `feature/production-readiness` | none (quality) | Merged |
| T-5 Opt-in cookieless analytics | [#33](https://github.com/edgeorgie/triage-desk/pull/33) | `feature/posthog-analytics` | FR-9 | Merged |
| T-6 Content Security Policy on the static export | [#11](https://github.com/edgeorgie/triage-desk/pull/11) | `feature/pages-deploy` | FR-8 | Merged |
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
what stops anyone from checking by hand. `scripts/check-spec.mjs` now also asserts that

- every `FR-n` declared in `spec.md` is claimed by at least one row in this table, and
- no row cites an `FR-n` that does not exist in `spec.md`.

Quality-only work (refactors, CI hardening, security guards that map to no single requirement)
is recorded as `none (quality)`. That is deliberate: forcing such work to invent a requirement
id would make the mapping dishonest rather than complete, so the check ignores those rows when
computing coverage instead of demanding an id from them.

Rows are not exhaustive over merged pull requests — 40 have merged, and listing every dependency
bump would bury the design decisions. The invariant enforced is requirement *coverage*, not
pull-request coverage.
