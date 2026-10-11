# Plan: triage-desk

## Overview

The page builds an adapter for the chosen provider and runs the loop with the open issues as context. Each tool call is reported as a step. The loop ends when submit_triage passes validation.

## Modules

| Path | Responsibility |
|---|---|
| `lib/agent.ts` | Loop, prompts and provider adapters |
| `lib/tools.ts` | Tool definitions and executor |
| `lib/triage.ts` | Ruling schema and validation |
| `lib/similar.ts` | Duplicate ranking |
| `lib/github.ts` | Issue listing and file reads |
| `lib/analytics.ts`, `lib/analytics-sdk.ts` | Web analytics facade and the lazily imported vendor module |
| `lib/analytics-node.ts` | Bot analytics client, inert without a key |
| `components/` | Ledger, ruling and the pageview tracker |
| `instrumentation-client.ts` | Loads the analytics SDK on idle, only with a key |

## Analytics

Analytics is opt-in per deployment (FR-9). The build pins `NEXT_PUBLIC_POSTHOG_KEY` in `next.config.ts` so an unset key becomes `""` and the dynamic import of the SDK is dead code: a build without a key emits no analytics chunk, which was checked on both the Vercel build and the Pages export. On Vercel the SDK posts to `/ingest`, rewritten to PostHog by `next.config.ts`; a static export cannot rewrite, so its deploy names the host and `scripts/csp.mjs` allows it. The bot imports `posthog-node` only when `POSTHOG_KEY` is set and awaits `shutdown()` before it exits.

## Decisions

- [ADR 0001: Terminal tool for structured output](../adr/0001-terminal-tool-for-structured-output.md)
- [ADR 0002: Read-only agent](../adr/0002-read-only-agent.md)
- [ADR 0003: Cookieless analytics that is off without a key](../adr/0003-cookieless-analytics-off-without-a-key.md)

## Quality gates

`npm run verify`: typecheck, lint, spec check, tests and production build.
