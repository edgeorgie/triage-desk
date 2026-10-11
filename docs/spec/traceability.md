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
| FR-9 | `lib/analytics.ts`, `lib/analytics-sdk.ts`, `lib/analytics-node.ts`, `components/Analytics.tsx`, `instrumentation-client.ts`, `app/layout.tsx`, `app/page.tsx`, `next.config.ts`, `scripts/csp.mjs`, `scripts/deploy-pages.mjs`, `scripts/triage-bot.ts`, `.github/workflows/triage.yml` | `tests/analytics.test.ts`, `tests/analytics-node.test.ts`, `tests/csp.test.ts`, `tests/ingest-proxy.test.ts` | manual: No key: Vercel build and Pages export built from clean trees, `grep -rli posthog .next/static out` empty, and in headless Chromium the Vercel build made no analytics request, wrote no cookie or storage and printed nothing to the console. Control build with a key emits the 315 KB SDK chunk, lazily. With a fake key in Chromium (requests to /ingest stubbed): only same-origin /ingest requests, no cookies or storage from analytics, `$pageview` carried origin and path, `triage_requested` carried only `repo`, and a planted issue title, body, username and API key appeared in no payload. `/ingest` rewrites checked against the live host (asset 200 through rule 1, trailing-slash POST not redirected); with no key the config registers no `/ingest` rewrite (asserted by calling its `rewrites()`), so the app is not a relay. Bot run against a real issue in dry run: without a key `posthog-node` is never resolved and nothing is sent; with a key one `issue_triaged` is flushed before exit, also on the invalid-event and failure paths (requests intercepted). Not exercised: delivery to a PostHog project with a real token. | Implemented, not verified end to end |

"Verified" means the behavior was exercised. "Implemented, not verified end to end" means the code exists and its parts are tested, but a real external service or credential was not available.
