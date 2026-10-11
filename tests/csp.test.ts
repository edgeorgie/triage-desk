import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { addCsp, analyticsOrigins } from "../scripts/csp.mjs";

const body = 'self.__next_f.push([1,"x"])';
const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
const page = `<html><head><meta charSet="utf-8"/></head><body><script>${body}</script><script src="/a.js"></script></body></html>`;

test("inline scripts are allowed by hash and external ones only from self", () => {
  const out: string = addCsp(page, ["https://api.openai.com"]);
  assert.ok(out.includes(`script-src 'self' ${hash}`));
  assert.ok(out.includes("connect-src 'self' https://api.openai.com"));
  assert.ok(out.includes("object-src 'none'"));
  assert.ok(!out.includes("unsafe-eval"));
});

test("the policy is the first thing in head and is not duplicated on a second pass", () => {
  const once: string = addCsp(page);
  const twice: string = addCsp(once);
  assert.equal(once, twice);
  assert.ok(once.indexOf("Content-Security-Policy") < once.indexOf("charSet"));
});

test("analytics origins reach script-src and connect-src only when a host is named", () => {
  assert.deepEqual(analyticsOrigins(undefined), []);
  assert.deepEqual(analyticsOrigins(""), []);
  const origins = analyticsOrigins("https://us.i.posthog.com");
  assert.deepEqual(origins, ["https://us.i.posthog.com", "https://us-assets.i.posthog.com"]);
  const out: string = addCsp(page, origins, origins);
  assert.ok(out.includes(`script-src 'self' ${hash} https://us.i.posthog.com https://us-assets.i.posthog.com`));
  assert.ok(out.includes("connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com"));
  assert.ok(!addCsp(page).includes("posthog"));
});
