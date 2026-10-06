# triage-desk

An agent that triages open GitHub issues. Point it at a public repository, pick an issue, and it investigates with tools before ruling on it: kind, priority, labels, duplicate detection, what is missing from the report, and a suggested first reply.

## How the agent works

It runs a tool-use loop in your browser with your own Anthropic or OpenAI key. The key stays in this browser and requests go straight to the provider.

Tools the agent can call:

- `get_issue` reads another open issue
- `find_similar` ranks similar open issues for duplicate detection (token overlap, computed locally)
- `list_labels` shows the repository's label vocabulary
- `read_repo_file` reads a file such as README.md or CONTRIBUTING.md
- `submit_triage` files the structured decision, validated before it is accepted

If the model submits an invalid ruling, the validation error is fed back and it tries again. The loop is capped at 8 steps. Every tool call is shown as a ledger so you can audit how it decided. The agent is read-only: it never writes to GitHub.

## Limits

Public repositories only. GitHub allows 60 unauthenticated API calls per hour per IP.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Scripts

- `npm test` runs the agent loop, tools, similarity and validation tests
- `npm run build` creates a production build

## License

MIT

## Keyboard and batches

- `J` / `K` move through the issues, `R` or `Enter` rules on the selected one, `C` copies its suggested reply, `?` shows the shortcuts.
- `B` triages the next 5 issues in a row, then you can export every ruling as JSON.
