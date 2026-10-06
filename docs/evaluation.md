# Evaluation

A self-assessment against a reviewer's rubric. It states gaps plainly so a reviewer, a person or an agent, can verify or challenge each line.

| Criterion | Status | Notes |
|---|---|---|
| Onboarding | Pass | README has a one-command run, usage steps and configuration. |
| Reproducible build | Pass | Lockfile, Node 22 engine field, and one gate: `npm run verify`. |
| Automated tests | Partial | Unit tests cover the pure logic (3 of 6 requirements have tests). No browser end-to-end tests; UI behavior was verified manually and recorded in the traceability matrix. |
| Continuous integration | Gap | A workflow runs `npm run verify` but is not active until the repository token has the workflow permission. The gate runs locally. |
| Specification and traceability | Pass | Spec, plan, tasks, ADRs and a matrix enforced by `npm run spec:check`. |
| Documentation structure | Pass | Index, architecture with diagrams, glossary and design system. |
| Agent readiness | Pass | AGENTS.md, llms.txt, machine-readable requirements and a deterministic gate. There is no MCP server or OpenAPI document because the app is client-side. |
| LLM integration safety | Partial | Issue text is untrusted input to an agent with tools. Blast radius is limited: tools are read-only, file paths are guarded, the loop is capped at 8 steps and the ruling is schema-validated. A hostile issue could still mislead the ruling, so a human applies it. |
| Privacy and data flow | Pass | Every data path and its storage is tabulated in the README. |
| Accessibility | Partial | Shortcuts are documented in a dialog and every action has a button; the timeline is an ordered list. Not audited with automated tooling. |
| Performance | Partial | Each ruling is a few sequential model calls. Not measured with Lighthouse. |
| Security | Partial | The key lives in localStorage. No Content Security Policy is configured. |
| Deployment | Gap | Not deployed yet. A Vercel deploy button is in the README. |
| Licensing | Pass | MIT. |

## Verify it yourself

```bash
npm install
npm run verify
```

Requirements marked "Implemented, not verified end to end" in [spec.md](spec/spec.md) depend on a real external service or credential that was not exercised.
