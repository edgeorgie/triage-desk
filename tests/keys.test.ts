import assert from "node:assert/strict";
import { test } from "node:test";
import { handlesOwnKeys } from "../lib/keys.ts";

test("buttons, tabs, fields and links keep their own keys", () => {
  for (const tag of ["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A", "summary"]) assert.equal(handlesOwnKeys(tag, null, false), true);
  assert.equal(handlesOwnKeys("DIV", "tab", false), true);
  assert.equal(handlesOwnKeys("DIV", null, true), true);
});

test("the page body and plain containers do not", () => {
  assert.equal(handlesOwnKeys("BODY", null, false), false);
  assert.equal(handlesOwnKeys("DIV", null, false), false);
});
