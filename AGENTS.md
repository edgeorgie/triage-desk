# Agent harness

This repository is developed with AI assistance under spec-driven development. These rules apply to any agent or person working here.

## Workflow

1. **Specify.** Change `docs/spec/spec.md` first: requirement, acceptance criteria, non-goals. No code without a requirement id.
2. **Plan.** Update `docs/spec/plan.md` and add an ADR in `docs/adr` when a decision is hard to reverse.
3. **Break down.** Add tasks to `docs/spec/tasks.md`, each tied to requirement ids.
4. **Implement.** Work on a GitFlow branch from `develop` (`feature/*`). Keep changes inside the spec; if something is missing, go back to step 1.
5. **Verify.** Run `npm run verify`. Exercise the behavior in a browser for UI work. Record what was observed.
6. **Trace.** Update `docs/spec/traceability.md` with implementation files, tests and evidence. `npm run spec:check` fails if a requirement is untraced or points at a missing file.
7. **Review.** Open a pull request using the template and merge into `develop`.

## Rules

- Read `docs/spec/constitution.md` and `spec.md` before changing anything.
- Comments explain why, never what. No emojis. No dead code. No debug logging.
- Do not add features, options or dependencies the spec does not call for.
- Keys and user data stay in the browser. Do not add a server path for secrets.
- State uncertainty. Do not mark a requirement verified unless it was exercised.

## Quality gates

`npm run verify` runs typecheck, lint, the spec check, the tests and the production build. A change is done when it passes and the traceability matrix is current.

## Map

| Path | Purpose |
|---|---|
| `docs/spec/constitution.md` | Principles and standards |
| `docs/spec/spec.md` | Requirements and acceptance criteria |
| `docs/spec/plan.md` | Architecture and module map |
| `docs/spec/tasks.md` | Work items linked to pull requests |
| `docs/spec/traceability.md` | Requirement to code, test and evidence |
| `docs/adr/` | Decision records |
| `scripts/check-spec.mjs` | Traceability gate |
