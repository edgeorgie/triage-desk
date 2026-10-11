import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { botEvent, createBotAnalytics, installationId } from "../lib/analytics-node.ts";

const REPO = "Owner/Repo";

test("the installation id is a stable hash that does not name the repository", () => {
  const id = installationId(REPO);
  assert.equal(id, installationId("owner/repo"));
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.notEqual(id, installationId("owner/other"));
});

test("every bot event carries app and surface and opts out of person profiles", () => {
  const e = botEvent(REPO, "webhook_rejected", { reason: "invalid_event" });
  assert.equal(e.distinctId, installationId(REPO));
  assert.equal(e.event, "webhook_rejected");
  assert.equal(e.properties.app, "triage-desk");
  assert.equal(e.properties.surface, "bot");
  assert.equal(e.properties.reason, "invalid_event");
  assert.equal(e.properties.$process_person_profile, false);
});

test("without a key the bot client is inert and sends nothing", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("{}");
  }) as typeof fetch;
  try {
    const analytics = await createBotAnalytics(REPO, undefined);
    analytics.capture("issue_triaged", { outcome: "posted" });
    await analytics.shutdown();
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 0);
});

test("with a key one batch reaches the analytics host carrying only the run's shape", async () => {
  type Batch = { batch: { event: string; distinct_id: string; properties: Record<string, unknown> }[] };
  const requests: { url: string; body: Batch }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body as string | Uint8Array;
    const gzip = new Headers(init?.headers).get("content-encoding") === "gzip";
    const text = gzip ? gunzipSync(Buffer.from(raw as Uint8Array)).toString() : String(raw);
    requests.push({ url: String(input), body: JSON.parse(text) as Batch });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const analytics = await createBotAnalytics(REPO, "phc_test");
    analytics.capture("issue_triaged", { repo: REPO, labels_applied: 2, model: "heuristic", latency_ms: 40, outcome: "posted" });
    await analytics.shutdown();
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.startsWith("https://us.i.posthog.com/"), requests[0].url);
  const [event] = requests[0].body.batch;
  assert.equal(event.event, "issue_triaged");
  assert.equal(event.distinct_id, installationId(REPO));
  assert.equal(event.properties.app, "triage-desk");
  assert.equal(event.properties.surface, "bot");
  assert.equal(event.properties.$process_person_profile, false);
  assert.equal(event.properties.$geoip_disable, true);
  // Only the allowlist and the SDK's own `$`-prefixed bookkeeping: no title, body, author or token can ride along.
  const custom = Object.keys(event.properties).filter((k) => !k.startsWith("$")).sort();
  assert.deepEqual(custom, ["app", "labels_applied", "latency_ms", "model", "outcome", "repo", "surface"]);
});
