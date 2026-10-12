// Regenerate docs/spec/requirements.lock.json from docs/spec/requirements.json.
//
// The lock is the gate's PERSISTED witness for its own subject. A count a gate derives from the
// parse under attack cannot witness that parse being truncated — and since requirement identity
// comes from `requirements.json`, truncating that file is the attack. A coherent removal of a
// requirement from every document on disk used to make the gate print a quietly smaller number
// and exit 0; now it fails `spec:check` by name until this file is regenerated deliberately, in
// the same commit, where a reviewer sees it in the diff.
import { readFileSync, writeFileSync } from "node:fs";

import { declaredIdLock, loadRequirements } from "./check-spec.mjs";

const problems = [];
const declared = loadRequirements(readFileSync("docs/spec/requirements.json", "utf8"), problems);
if (declared === null) {
  console.error(problems.map((p) => "- " + p).join("\n"));
  process.exit(1);
}

const lock = declaredIdLock(declared.map((r) => r.id));
writeFileSync("docs/spec/requirements.lock.json", JSON.stringify(lock, null, 2) + "\n");
console.log(`wrote docs/spec/requirements.lock.json: ${lock.count} ids, sha256 ${lock.sha256}`);
