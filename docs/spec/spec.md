# Specification: triage-desk

An agent that investigates open GitHub issues with tools and rules on them.

## Baseline

This specification describes the behavior verified for the 0.1.0 baseline (2026-10-06) and is the source of truth from here on. Every change starts in this document and follows the workflow in `AGENTS.md`.

## Users

Maintainers who triage issues.

## Goals

- Produce a structured ruling the maintainer can audit.
- Show every tool call the agent made.
- Stay read-only: the agent never writes to GitHub.

## Non-goals

- Applying labels or posting replies.
- Private repositories.

## Requirements

### FR-1 Tool-use loop

Status: Verified.

- Given a scripted model, then tools run in order, results are fed back, and the loop ends when a ruling is submitted.
- Given an invalid ruling, then the validation error is returned and the model may retry.
- Given no decision within the step budget, then a clear error is raised.

### FR-2 Provider adapters

Status: Implemented, not verified end to end.

- Given Anthropic or OpenAI, then tool calls and tool results are encoded in each provider's format.

### FR-3 Duplicate detection

Status: Verified.

- Given an issue and the open pool, then similar issues are ranked and unrelated ones excluded.

### FR-4 Ruling validation

Status: Verified.

- Given model output, then kind, priority, summary and reply are required, confidence is clamped, and unknown values are rejected, `duplicate_of` must be a loaded open issue, and summary and reply are length-limited.
- Given issue text or file contents, then they reach the model delimited as untrusted data, and `read_repo_file` accepts only plain relative paths (no dot segments, encoded or not).

### FR-5 Auditable ledger and ruling view

Status: Verified.

- Given a run, then each completed tool call appears on a timeline and the ruling shows kind, priority, labels, duplicate, missing information and a copyable reply.

### FR-6 Keyboard, batch and export

Status: Verified.

- Given the list, then J/K move, R rules, B triages the next five in sequence, C copies the reply, and all rulings export as JSON.

## Open risks

- Token overlap similarity misses paraphrased duplicates.
- Unauthenticated GitHub calls are limited to 60 per hour.
