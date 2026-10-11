/**
 * Analytics for the headless bot (PostHog via posthog-node), the Node counterpart of
 * `./analytics.ts`. The vendor module is imported only once a key exists, so a run without
 * `POSTHOG_KEY` loads no SDK and opens no connection. Events describe the run, never the
 * issue: counts, enumerations, durations and the public repository name.
 */
import { createHash } from "node:crypto";
import { APP } from "./analytics.ts";
import type { Props } from "./analytics.ts";

export interface BotAnalytics {
  capture(event: string, props: Props): void;
  /** Flushes queued events; the process must await it before exiting. */
  shutdown(): Promise<void>;
}

const HOST = "https://us.i.posthog.com";

/** One stable anonymous id per installation. Lower-cased because GitHub repository names are case-insensitive. */
export function installationId(repo: string): string {
  return createHash("sha256").update(repo.toLowerCase()).digest("hex");
}

/** Every bot event carries the shared `app` and `surface` properties and opts out of person profiles, like the browser side. */
export function botEvent(repo: string, event: string, props: Props): { distinctId: string; event: string; properties: Props } {
  return { distinctId: installationId(repo), event, properties: { app: APP, surface: "bot", ...props, $process_person_profile: false } };
}

export async function createBotAnalytics(repo: string, key = process.env.POSTHOG_KEY): Promise<BotAnalytics> {
  if (!key) return { capture: () => undefined, shutdown: () => Promise.resolve() };
  const { PostHog } = await import("posthog-node");
  // GeoIP is on by default server-side; the source is a CI runner, so enriching events with it is noise at best.
  const client = new PostHog(key, { host: HOST, disableGeoip: true });
  return {
    capture: (event, props) => client.capture(botEvent(repo, event, props)),
    shutdown: () => client.shutdown(),
  };
}
