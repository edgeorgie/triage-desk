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
| `components/` | Ledger and ruling |

## Decisions

- [ADR 0001: Terminal tool for structured output](../adr/0001-terminal-tool-for-structured-output.md)
- [ADR 0002: Read-only agent](../adr/0002-read-only-agent.md)

## Quality gates

`npm run verify`: typecheck, lint, spec check, tests and production build.
