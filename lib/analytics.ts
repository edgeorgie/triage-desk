/**
 * Analytics facade for the web app (PostHog), the shape shared across the owner's apps.
 *
 * - No key at build time: `track()` is a no-op and no analytics code is bundled at all
 *   (next.config.ts pins an unset key to "", which makes the import below dead code).
 * - With a key: the vendor module (`./analytics-sdk.ts`) is imported on idle
 *   (instrumentation-client.ts) or on the first event; events queued before it loads are
 *   flushed afterwards.
 * - Cookieless and without person profiles, so there is nothing to consent to and no
 *   identity to protect. Transport goes through this origin (`/ingest`, see next.config.ts)
 *   on Vercel; the static export has no server and names the vendor host instead.
 * - Every event carries `app` and `surface`. User content is never sent: only counts,
 *   booleans, durations, enumerations and the public repository name.
 *
 * See docs/adr/0003-cookieless-analytics-off-without-a-key.md.
 */
export type Props = Record<string, string | number | boolean | null | undefined>;

/** The `app` super property; one PostHog project holds every app. */
export const APP = "triage-desk";
export const analyticsEnabled = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

interface Client {
  capture(event: string, props?: Props): unknown;
}

let client: Client | null = null;
let loading: Promise<Client | null> | null = null;
const queue: { event: string; props?: Props }[] = [];

export function loadAnalytics(): Promise<Client | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (loading) return loading;
  // The key is tested inline around the import on purpose: with next.config.ts pinning an unset key
  // to "", the bundler folds the condition and never emits the SDK chunk. A guard held in a variable
  // or an early return is not folded, and the unused chunk would still ship.
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    loading = import("./analytics-sdk.ts")
      .then(({ initAnalytics }) => {
        const ready = initAnalytics(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, { app: APP, surface: "web" });
        for (const q of queue.splice(0)) ready.capture(q.event, q.props);
        client = ready;
        return ready;
      })
      .catch(() => null);
    return loading;
  }
  return Promise.resolve(null);
}

/** Fire-and-forget event. Safe to call anywhere, in any environment. */
export function track(event: string, props?: Props): void {
  if (!analyticsEnabled) return;
  if (client) {
    client.capture(event, props);
    return;
  }
  queue.push({ event, props });
  void loadAnalytics();
}
