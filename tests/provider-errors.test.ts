import { test } from "node:test";
import assert from "node:assert/strict";
import { providerError } from "../lib/agent.ts";

test("provider errors say what to do", () => {
  assert.match(providerError("Anthropic", 401).message, /Check your API key/);
  assert.match(providerError("OpenAI", 403).message, /Check your API key/);
  assert.match(providerError("OpenAI", 429).message, /Rate limit/);
  assert.match(providerError("Anthropic", 503).message, /having problems/);
  assert.match(providerError("Anthropic", 400).message, /rejected the request/);
  assert.equal(providerError("Anthropic", 401).message.startsWith("Anthropic error 401."), true);
});
