# Contributing

Changes follow spec-driven development. The short version:

1. Update `docs/spec/spec.md` first: the requirement and its acceptance criteria.
2. Add or update tasks in `docs/spec/tasks.md`, and an ADR in `docs/adr` for hard-to-reverse decisions.
3. Branch from `develop` as `feature/<name>` (GitFlow).
4. Implement, keeping to the spec. Comments explain why, not what. No emojis or debug logging.
5. Run `npm run verify` and exercise UI changes in a browser.
6. Update `docs/spec/traceability.md` and `docs/spec/requirements.json`.
7. Open a pull request with the template: requirement ids, spec changes, verification, out of scope.

Full rules for agents and people are in [AGENTS.md](AGENTS.md).
