# Traceability: triage-desk

Every requirement maps to implementation files and to tests or manual evidence. `npm run spec:check` enforces that each requirement has an implementation, that files exist, and that there is a test or a manual note.

| Requirement | Implementation | Tests | Evidence | Status |
|---|---|---|---|---|
| FR-1 | `lib/agent.ts`, `lib/tools.ts` | `tests/agent.test.ts` | PR 1: loop tests with a scripted model. | Verified |
| FR-2 | `lib/agent.ts` | manual | manual: PR 3, scripted Anthropic responses in Chrome exercised two model calls with tool results appended. OpenAI not exercised. | Implemented, not verified end to end |
| FR-3 | `lib/similar.ts`, `lib/tools.ts` | `tests/agent.test.ts` | PR 1: similarity test. | Verified |
| FR-4 | `lib/triage.ts` | `tests/agent.test.ts` | PR 1: validation tests. | Verified |
| FR-5 | `components/Ledger.tsx`, `components/Ruling.tsx`, `app/page.tsx` | manual | manual: PR 3, rendered in Chrome with a scripted model. | Verified |
| FR-6 | `app/page.tsx` | manual | manual: PR 4, verified against zod with a scripted model: five calls, five priority marks, export shown. | Verified |

"Verified" means the behavior was exercised. "Implemented, not verified end to end" means the code exists and its parts are tested, but a real external service or credential was not available.
