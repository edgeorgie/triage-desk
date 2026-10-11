// Client-side instrumentation (Next.js `instrumentation-client` convention).
//
// Schedules the analytics SDK for idle time so it never competes with first paint. Without a
// key at build time nothing is scheduled and the SDK is never downloaded. See lib/analytics.ts.
import { analyticsEnabled, loadAnalytics } from "@/lib/analytics";

if (analyticsEnabled) {
  const start = () => void loadAnalytics();
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 3000 });
  } else {
    setTimeout(start, 1500);
  }
}
