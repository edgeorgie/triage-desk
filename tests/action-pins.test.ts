import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const WORKFLOW_DIR = join(import.meta.dirname, "..", ".github", "workflows");

/**
 * Every `uses:` reference found across every workflow file, with the file and
 * line it came from so a failure names the exact call site.
 *
 * Derived by reading the workflow directory at runtime rather than listing the
 * files here: a hand-maintained list of workflows is the drift this repo has
 * repeatedly been bitten by, and a new workflow must not arrive unchecked.
 */
function actionReferences(): { file: string; line: number; ref: string }[] {
  const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  assert.ok(files.length > 0, `no workflow files found under ${WORKFLOW_DIR}`);

  const refs: { file: string; line: number; ref: string }[] = [];
  for (const file of files) {
    const lines = readFileSync(join(WORKFLOW_DIR, file), "utf8").split("\n");
    lines.forEach((text, i) => {
      // `uses:` only counts as a step key, never inside a comment.
      const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(text.replace(/\s+#.*$/, ""));
      if (match && !text.trimStart().startsWith("#")) {
        refs.push({ file, line: i + 1, ref: match[1].replace(/^["']|["']$/g, "") });
      }
    });
  }
  return refs;
}

/**
 * An action reference is immutable when GitHub resolves it to the same tree on
 * every run. Three forms qualify:
 *
 *   - `./` or `./path` — the checked-out commit itself, so it moves only with
 *     this repo's own reviewed history.
 *   - `owner/repo@<40-hex>` — a commit SHA, which cannot be repointed.
 *   - `owner/repo@vN[.N[.N]]` — a release tag. Technically re-taggable, but it
 *     is the versioning contract GitHub's own actions publish under, and
 *     Dependabot's `github-actions` ecosystem raises a reviewable PR when the
 *     major moves.
 *
 * Anything else fails. The rule is written as an allowlist of known-good shapes
 * rather than a denylist of `@main`/`@master`/`@develop` on purpose: a denylist
 * passes silently on the next form nobody enumerated (`@latest`, `@release/2`, a
 * bare `@sha` prefix), which is exactly how the floating-dependency class
 * survived in `package.json` until the pin guard there was rewritten to fail
 * closed. This fails closed too.
 */
function isImmutable(ref: string): boolean {
  if (ref === "./" || ref.startsWith("./")) return true;
  const at = ref.lastIndexOf("@");
  if (at <= 0) return false;
  const version = ref.slice(at + 1);
  if (/^[0-9a-f]{40}$/.test(version)) return true;
  return /^v\d+(\.\d+){0,2}$/.test(version);
}

test("no workflow pins an action to a mutable branch ref", () => {
  const floating = actionReferences().filter((r) => !isImmutable(r.ref));
  assert.deepEqual(
    floating,
    [],
    `these action references can change without any diff in this repo:\n` +
      floating.map((r) => `  ${r.file}:${r.line} -> ${r.ref}`).join("\n"),
  );
});

test("the guard recognises the real shapes and rejects every floating form", () => {
  // Positive control: the forms genuinely in use here must not be flagged, so a
  // green run above cannot be explained by the predicate accepting everything.
  for (const good of [
    "./",
    "./cli",
    "actions/checkout@v4",
    "actions/setup-node@v4.1.0",
    "edgeorgie/eval-lab@2ce08e791884cd9d65835b25da7f46831cd9a2ee",
  ]) {
    assert.ok(isImmutable(good), `expected ${good} to be accepted`);
  }

  // Negative control, including forms no denylist would have enumerated.
  for (const bad of [
    "edgeorgie/eval-lab@main",
    "actions/checkout@master",
    "owner/repo@develop",
    "owner/repo@latest",
    "owner/repo@release/2",
    "owner/repo@2ce08e7", // short SHA: ambiguous, and not what GitHub resolves immutably
    "owner/repo", // no ref at all resolves to the default branch
  ]) {
    assert.ok(!isImmutable(bad), `expected ${bad} to be rejected`);
  }
});

test("the eval gate's action reference is the one this repo's merge gate depends on", () => {
  // `eval` is triage-desk's only required status check, and it is the step
  // below that decides it. If this reference ever becomes mutable again, the
  // repo's merge gate becomes editable from another repository with no diff
  // here — so this asserts the specific call site, not just the aggregate.
  const evalRefs = actionReferences().filter((r) => r.ref.startsWith("edgeorgie/eval-lab@"));
  assert.equal(evalRefs.length, 1, "expected exactly one eval-lab reference");
  assert.match(evalRefs[0].ref, /^edgeorgie\/eval-lab@[0-9a-f]{40}$/);
});
