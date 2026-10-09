# ACCURACY.md — triage-desk heuristic triage accuracy benchmark

Real, locally-measured numbers for `lib/heuristic-triage.ts` (the no-LLM-key fallback
path the production bot also uses — see `scripts/triage-bot.ts`), run directly via
`node --experimental-strip-types tests-local/benchmark-triage.mjs` — NOT through
GitHub Actions — against 18 synthetic issue bodies.

**Ground truth is self-labeled.** The expected kind/priority for each case was
assigned by the person who wrote this benchmark, by reading the heuristic's own
keyword rules — not from an external dataset or a third party's judgment. This is an
internal-consistency check, not an independently validated benchmark. Read it as "does
the heuristic behave as a careful reader of its own code would expect," not "does this
match real-world maintainer judgment."

## Results — 3 runs, 18 cases each

| Run | Kind accuracy | Priority accuracy | Both-correct | Avg latency/case (ms) |
|---|---|---|---|---|
| 1 | 83.3% (15/18) | 83.3% (15/18) | 83.3% (15/18) | 0.274 |
| 2 | 83.3% (15/18) | 83.3% (15/18) | 83.3% (15/18) | 0.029 |
| 3 | 83.3% (15/18) | 83.3% (15/18) | 83.3% (15/18) | 0.025 |

Identical across all 3 runs — expected, since the heuristic is pure keyword matching
with no randomness. Run 1's 0.274ms/case is the more realistic "cold" per-issue
latency for production (one issue per process start); later runs benefit from V8 JIT
warmup inside the same process.

## Confusion matrix (expected kind → predicted kind, identical across all 3 runs)

| Expected \ Predicted | bug | support | docs | feature | question |
|---|---|---|---|---|---|
| **bug** (7)      | 6 | 1 | – | – | – |
| **docs** (2)     | – | – | 2 | – | – |
| **feature** (3)  | – | – | – | 3 | – |
| **question** (3) | 1 | – | – | – | 2 |
| **support** (3)  | 1 | 1 | – | – | – |

3 of 18 misclassified:
- "App won't start after the latest update" (expected bug) → `support`: no listed
  bug-keyword (bug/error/crash/exception/broken/fails/traceback) appears, so the
  heuristic falls through to its default kind.
- "Dashboard feels slow and clunky" (expected support) → `bug`: no fail-keyword
  present either, but priority still came out p1, i.e. the real miss here is on the
  kind/priority coupling, not just the keyword list.
- "Is this expected behavior with pricing tiers?" (expected question) → `bug`: the
  word "bug" appears rhetorically in the question text, and the bug-keyword check is
  evaluated before the question-keyword check in the if/else chain, so mentioning
  "bug" at all biases classification toward bug even in a genuine question.

**Duplicate detection: 1/2 correctly flagged (50%).** Near-verbatim phrasing was
caught; a deliberately paraphrased duplicate was not — `lib/similar.ts`'s Jaccard
token-overlap check (0.35 confidence cutoff) is brittle to rewording, a real and
measured limitation, not hypothetical.

## Reproduce

```bash
node --no-warnings --experimental-strip-types tests-local/benchmark-triage.mjs
# Prints per-run accuracy/latency/confusion plus full per-case raw predictions.
```

## Limitations

- **Self-labeled ground truth** — not an independent/external benchmark.
- 18 cases is a small sample; the 83.3% figure has wide uncertainty at this n.
- Benchmarks the heuristic fallback only, not the LLM-reasoning path (requires an
  API key not present in this environment).
- Duplicate-detection rate (50%) is based on only 2 duplicate-intended cases —
  directionally informative, not statistically solid.
