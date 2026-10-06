# Traceability: triage-desk

Every requirement maps to implementation files and to tests or manual evidence. `npm run spec:check` enforces that each requirement has an implementation, that files exist, and that there is a test or a manual note.

| Requirement | Implementation | Tests | Evidence | Status |
|---|---|---|---|---|
| FR-1 | `lib/agent.ts`, `lib/tools.ts` | `tests/agent.test.ts` | PR 1: loop tests with a scripted model. | Verified |
| FR-2 | `lib/agent.ts` | manual | manual: PR 3, scripted Anthropic responses in Chrome exercised two model calls with tool results appended. OpenAI not exercised. | Implemented, not verified end to end |
| FR-3 | `lib/similar.ts`, `lib/tools.ts` | `tests/agent.test.ts` | PR 1: similarity test. | Verified |
| FR-4 | `lib/triage.ts`, `lib/tools.ts`, `lib/agent.ts`, `lib/github.ts` | `tests/agent.test.ts`, `tests/untrusted-input.test.ts` | PR 1: validation tests. | Verified |
| FR-5 | `components/Ledger.tsx`, `components/Ruling.tsx`, `app/page.tsx` | manual | manual: PR 3, rendered in Chrome with a scripted model. | Verified |
| FR-6 | `app/page.tsx`, `lib/keys.ts` | `tests/keys.test.ts` | manual: PR 4, verified against zod with a scripted model: five calls, five priority marks, export shown. | Verified |
| FR-7 | `lib/keystore.ts`, `components/KeyNotes.tsx`, `app/page.tsx` | `tests/keystore.test.ts` | In Chrome with an invalid test key the key stayed in sessionStorage (SEC-002). | Verified |
| FR-8 | `scripts/csp.mjs`, `scripts/deploy-pages.mjs` | `tests/csp.test.ts` | Hash and policy tests; published site checked in Chrome after deploy (SEC-001). | Verified |

"Verified" means the behavior was exercised. "Implemented, not verified end to end" means the code exists and its parts are tested, but a real external service or credential was not available.
