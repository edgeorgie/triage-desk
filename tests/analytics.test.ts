import assert from "node:assert/strict";
import { test } from "node:test";

// A developer's shell may carry a key; this file is about the path without one.
delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
const { analyticsEnabled, APP, loadAnalytics, track } = await import("../lib/analytics.ts");

test("without a key the web facade is inert", async () => {
  assert.equal(analyticsEnabled, false);
  track("triage_requested", { repo: "owner/name" });
  assert.equal(await loadAnalytics(), null);
});

test("the app property names this project", () => {
  assert.equal(APP, "triage-desk");
});
