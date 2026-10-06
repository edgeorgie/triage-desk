import assert from "node:assert/strict";
import { test } from "node:test";
import { clearKeys, readKeys, writeKeys } from "../lib/keystore.ts";
import type { StorageLike } from "../lib/keystore.ts";

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

test("keys go to the session store by default and not to the device store", () => {
  const session = memory();
  const local = memory();
  writeKeys("k", { a: "invalid-test-key-0000" }, false, session, local);
  assert.equal(local.data.size, 0);
  assert.deepEqual(readKeys("k", session, local), { value: { a: "invalid-test-key-0000" }, remember: false });
});

test("remembering moves keys to the device store and removes the session copy", () => {
  const session = memory();
  const local = memory();
  writeKeys("k", { a: "x" }, false, session, local);
  writeKeys("k", { a: "x" }, true, session, local);
  assert.equal(session.data.size, 0);
  assert.deepEqual(readKeys("k", session, local), { value: { a: "x" }, remember: true });
});

test("clear removes keys from both stores", () => {
  const session = memory();
  const local = memory();
  writeKeys("k", { a: "x" }, true, session, local);
  clearKeys("k", session, local);
  assert.deepEqual(readKeys("k", session, local), { value: null, remember: false });
});

test("corrupt or non-object values read as empty", () => {
  const session = memory();
  const local = memory();
  local.setItem("k", "not json");
  session.setItem("j", "5");
  assert.equal(readKeys("k", session, local).value, null);
  assert.equal(readKeys("j", session, local).value, null);
});
