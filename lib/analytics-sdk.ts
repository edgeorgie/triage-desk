// The only web module that names the analytics vendor. `./analytics.ts` imports it dynamically
// once a key exists, so a build without a key ships neither SDK code nor vendor hostnames.
import posthog from "posthog-js";
import type { Props } from "./analytics.ts";

export function initAnalytics(key: string, superProps: Props) {
  posthog.init(key, {
    // Vercel proxies /ingest to the vendor (next.config.ts); the static export cannot, so its deploy names the host.
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-08-30",
    cookieless_mode: "always",
    person_profiles: "never",
    autocapture: false,
    capture_pageview: false, // sent manually with the shared properties (components/Analytics.tsx)
    disable_session_recording: true,
    respect_dnt: true,
  });
  posthog.register(superProps);
  return posthog;
}
