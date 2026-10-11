import assert from "node:assert/strict";
import { test } from "node:test";
import nextConfig from "../next.config.ts";

// The /ingest proxy is a server-side route, so no client-side gate can close it: registered without
// a key it would forward whatever is POSTed to /ingest/* to PostHog's public ingestion API. Reading
// the config source cannot prove a route is absent; calling its own rewrites() can.
type Rewrite = { source: string; destination: string };
const config = nextConfig as { rewrites?: () => Promise<Rewrite[]> };

async function rewritesWith(key: string | undefined): Promise<Rewrite[]> {
  const previous = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (key === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  else process.env.NEXT_PUBLIC_POSTHOG_KEY = key;
  try {
    assert.equal(typeof config.rewrites, "function");
    return await config.rewrites!();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    else process.env.NEXT_PUBLIC_POSTHOG_KEY = previous;
  }
}

test("no key: no /ingest route is registered at all", async () => {
  assert.deepEqual(await rewritesWith(undefined), []);
});

test("an empty key counts as no key", async () => {
  assert.deepEqual(await rewritesWith(""), []);
});

test("with a key the proxy reaches PostHog's own hosts only, catch-all last", async () => {
  const rewrites = await rewritesWith("phc_test_key");
  assert.deepEqual(
    rewrites.map((r) => r.source),
    ["/ingest/static/:path*", "/ingest/array/:path*", "/ingest/:path*"],
  );
  for (const r of rewrites) assert.match(new URL(r.destination).hostname, /\.i\.posthog\.com$/);
});
