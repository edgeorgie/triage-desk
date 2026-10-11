# ADR 0003: Cookieless analytics that is off without a key

Status: accepted

## Context

The owner wants to know how the project is used: whether the web app is opened and run, and what the triage bot does across installations. Analytics is a privacy decision here. The web app promises that keys and user data stay in the browser, and the bot reads issue text that belongs to other people.

## Decision

Product analytics through PostHog, built so that it can never carry user content and costs nothing when unused.

- **Off without a key.** The web app needs `NEXT_PUBLIC_POSTHOG_KEY` at build time and the bot needs `POSTHOG_KEY` at run time. Without them there is no analytics code in the web bundle (`next.config.ts` pins an unset key to `""` so the dynamic import is dead code; a build with an unset variable would otherwise still emit the SDK chunk), no network request, and the bot does not import `posthog-node`.
- **Allowlist, not autocapture.** Four events: `$pageview` and `triage_requested` (web), `issue_triaged` and `webhook_rejected` (bot). Properties are counts, booleans, durations in milliseconds, enumerations and the public `owner/name` of a repository. Every event carries `app` (`triage-desk`) and `surface` (`web` or `bot`).
- **Never sent:** issue titles, bodies and comments, usernames, rulings and replies, provider keys, GitHub tokens, file contents and paths, URL query strings and fragments. The web app's pageview reports origin and path only. The bot's `model` is the provider path (`anthropic`, `openai` or `heuristic`), not a model name.
- **No identity.** The browser uses `cookieless_mode: "always"` and `person_profiles: "never"`, never calls `identify`, sets no cookie and uses no browser storage, so there is nothing to consent to. Autocapture and session recording are off and Do Not Track is respected. The bot uses one anonymous id per installation, the SHA-256 of the lower-cased repository name, with `$process_person_profile: false` and GeoIP disabled.
- **IP addresses.** PostHog still sees the connecting IP address at ingestion, and the browser SDK's `ip` option is deprecated and has no effect (posthog-js 1.438.7). The project must therefore enable the PostHog setting "Discard client IP data".
- **Transport.** On Vercel the browser posts to `/ingest` on the app's own origin, rewritten to PostHog, so tracking blockers that filter by domain do not drop it. This is a rewrite to the vendor, not application code: provider keys never travel through it because they are never part of an event. The GitHub Pages export cannot rewrite, so its deploy sets `NEXT_PUBLIC_POSTHOG_HOST`, and only then does the export's content security policy allow the PostHog script and connection hosts.
- **Bot lifecycle.** The bot is a short-lived process, so it queues events with `capture` and awaits `shutdown()` before exiting, including on failure.
- **Dependencies.** `posthog-js` for the browser and `posthog-node` for the bot, the only new dependencies. The SDKs are loaded lazily and only with a key.

## Consequences

- With no key the deployment behaves exactly as before; this was checked by building without a key and finding no analytics code in the client output of either build.
- The browser SDK adds its standard context to every event (browser, operating system, viewport, referrer, page URL). None of it comes from user content, but it is not zero data, which is why the project-level IP setting matters.
- On start the browser SDK makes one feature-flag request (`/ingest/flags/`) although no flags are used, and if the PostHog project has web vitals enabled it also sends page timings. Neither carries user content. Switching the flag request off is a possible follow-up; it is not part of the shared option set.
- A cookieless id changes daily, so there is no cross-day identity. That is the intended trade for having no consent surface.
- The project token is public by design; the bot reads it from a repository secret only to keep it out of the workflow file.
- Delivery to a real PostHog project has not been exercised; FR-9 stays "Implemented, not verified end to end" until it is.
