import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { load as loadYaml } from "js-yaml";

const REPO_ROOT = join(import.meta.dirname, "..");
const GITHUB_DIR = join(REPO_ROOT, ".github");

/**
 * Every YAML file under `.github/` that can contribute a step to a run:
 * workflows, and any local composite action's `action.yml`.
 *
 * Discovered by walking the tree at runtime rather than listing paths here. A
 * hand-maintained list of files is the drift class this repo has repeatedly
 * been bitten by, and a workflow or composite action added later must not
 * arrive unexamined.
 */
function githubYamlFiles(dir: string = GITHUB_DIR, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      githubYamlFiles(full, out);
    } else if (/\.ya?ml$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The slice of a workflow/action document this guard reads. Deliberately
 * minimal and `unknown`-valued rather than `any`: every field is validated at
 * the point of use below, so a malformed document is rejected by the checks
 * rather than silently trusted by a cast.
 */
type Step = { uses?: unknown };
type Job = { uses?: unknown; steps?: unknown };
type GithubYamlDoc = { jobs?: Record<string, unknown>; runs?: { steps?: unknown } };

const asSteps = (value: unknown): Step[] =>
  Array.isArray(value) ? value.filter((s): s is Step => !!s && typeof s === "object") : [];

/**
 * Every action/workflow reference in the repo, found by loading each file with
 * a real YAML parser and walking the document.
 *
 * A line-regex over `uses:` is NOT sufficient, and was measured to be
 * defeated: `- { uses: foo@main }` (flow mapping), `"uses": foo@main` (quoted
 * key), `uses : foo@main` (space before the colon) and a value on the
 * following line are all valid YAML that GitHub executes and that no
 * reasonable regex catches. Patching the regex per spelling is the denylist
 * mistake one level below the predicate — the next spelling wins. The parser
 * resolves every spelling to the same key, so it cannot be spelled around.
 *
 * Three reference positions exist, and all three are collected:
 *   - `jobs.<id>.steps[].uses`  — a step running an action
 *   - `jobs.<id>.uses`          — a reusable WORKFLOW call, at job level
 *   - `runs.steps[].uses`       — a step inside a local composite action
 */

function actionReferences(): { where: string; ref: string }[] {
  const files = githubYamlFiles();
  assert.ok(files.length > 0, `no YAML files found under ${GITHUB_DIR}`);

  const refs: { where: string; ref: string }[] = [];
  for (const file of files) {
    const where = relative(REPO_ROOT, file);
    let doc: unknown;
    try {
      doc = loadYaml(readFileSync(file, "utf8"));
    } catch (cause) {
      // A file we cannot parse is not a file we can clear. Fail, rather than
      // skipping it and reporting the remaining set as clean.
      assert.fail(`${where} did not parse as YAML: ${(cause as Error).message}`);
    }
    if (!doc || typeof doc !== "object") continue;
    const parsed = doc as GithubYamlDoc;

    const push = (ref: unknown, at: string) => {
      if (typeof ref === "string" && ref.length > 0) refs.push({ where: `${where} ${at}`, ref });
    };

    for (const [id, value] of Object.entries(parsed.jobs ?? {})) {
      if (!value || typeof value !== "object") continue;
      const job = value as Job;
      push(job.uses, `jobs.${id}.uses`); // reusable workflow call
      asSteps(job.steps).forEach((step, i) => push(step.uses, `jobs.${id}.steps[${i}]`));
    }

    const runSteps = parsed.runs?.steps;
    asSteps(runSteps).forEach((step, i) => push(step.uses, `runs.steps[${i}]`));
  }
  return refs;
}

/**
 * A reference is immutable when GitHub resolves it to the same tree on every
 * run. Only two forms qualify:
 *
 *   - `./` or `./path` — a local composite action, which moves only with this
 *     repo's own reviewed history. This is NOT taken on trust transitively:
 *     a local action's own `uses:` refs are collected and checked too (see
 *     `runs.steps[].uses` above), so a local action cannot launder a floating
 *     external ref.
 *   - `owner/repo@<40-hex>` — a commit SHA, which cannot be repointed.
 *
 * A `vN`/`vN.N.N` tag is deliberately NOT accepted, even though it is the
 * convention GitHub's own actions publish under. A git tag is movable by
 * whoever owns the repo, so `@v4` is a promise rather than a guarantee, and
 * Dependabot raising a PR when the MAJOR moves is a different property from
 * detecting a tag silently repointed at a new commit. Accepting tags would
 * also make this test's own name false.
 *
 * The rule is an allowlist of known-good shapes rather than a denylist of
 * `@main`/`@master`: a denylist passes silently on the first form nobody
 * enumerated (`@latest`, `@release/2`, a short SHA), which is exactly how the
 * floating-dependency class survived in `package.json` until the pin guard
 * there was rewritten to fail closed. This fails closed too. Short SHAs are
 * rejected on purpose — they are ambiguous, and not what GitHub resolves
 * immutably.
 */
function isImmutable(ref: string): boolean {
  if (ref === "./" || ref.startsWith("./")) return true;
  const at = ref.lastIndexOf("@");
  if (at <= 0) return false;
  return /^[0-9a-f]{40}$/.test(ref.slice(at + 1));
}

test("no action or workflow reference can change without a diff in this repo", () => {
  const floating = actionReferences().filter((r) => !isImmutable(r.ref));
  assert.deepEqual(
    floating,
    [],
    "these references resolve at run time and can change with no diff here:\n" +
      floating.map((r) => `  ${r.where} -> ${r.ref}`).join("\n"),
  );
});

test("the predicate accepts the shapes in use and rejects every floating form", () => {
  // Positive control: a green run above must not be explainable by a predicate
  // that accepts everything.
  for (const good of [
    "./",
    "./.github/actions/helper",
    "actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8",
    "edgeorgie/eval-lab@2ce08e791884cd9d65835b25da7f46831cd9a2ee",
  ]) {
    assert.ok(isImmutable(good), `expected ${good} to be accepted`);
  }

  // Negative control, including forms no denylist would have enumerated and
  // the movable tags this predicate deliberately refuses.
  for (const bad of [
    "edgeorgie/eval-lab@main",
    "actions/checkout@master",
    "owner/repo@develop",
    "owner/repo@latest",
    "owner/repo@release/2",
    "actions/checkout@v4",
    "actions/checkout@v4.1.0",
    "owner/repo@2ce08e7",
    "owner/repo",
  ]) {
    assert.ok(!isImmutable(bad), `expected ${bad} to be rejected`);
  }
});

test("the parser sees uses: in every YAML spelling a regex would miss", () => {
  // This is the assertion that makes the switch away from a line-regex
  // meaningful rather than cosmetic. Each spelling below is valid YAML that
  // GitHub executes, and each was measured to pass a regex-based version of
  // this guard while a floating ref was live in the file.
  const spellings: Record<string, string> = {
    "flow mapping": "jobs:\n  a:\n    steps:\n      - { name: x, uses: o/r@main }\n",
    "quoted key": 'jobs:\n  a:\n    steps:\n      - "uses": o/r@main\n',
    "space before colon": "jobs:\n  a:\n    steps:\n      - uses : o/r@main\n",
    "value on next line": "jobs:\n  a:\n    steps:\n      - uses:\n          o/r@main\n",
    "explicit string tag": "jobs:\n  a:\n    steps:\n      - uses: !!str o/r@main\n",
    "reusable workflow at job level": "jobs:\n  a:\n    uses: o/r/.github/workflows/ci.yml@main\n",
    "composite action step": "runs:\n  using: composite\n  steps:\n    - uses: o/r@main\n",
  };

  for (const [label, text] of Object.entries(spellings)) {
    const doc = loadYaml(text) as GithubYamlDoc;
    const found: string[] = [
      ...Object.values(doc.jobs ?? {}).flatMap((value) => {
        const job = (value ?? {}) as Job;
        return [job.uses, ...asSteps(job.steps).map((s) => s.uses)];
      }),
      ...asSteps(doc.runs?.steps).map((s) => s.uses),
    ].filter((r): r is string => typeof r === "string");

    const expected =
      label === "reusable workflow at job level"
        ? ["o/r/.github/workflows/ci.yml@main"]
        : ["o/r@main"];
    assert.deepEqual(found, expected, `the parser missed the ${label} spelling`);
    assert.ok(!isImmutable(found[0]), `${label}: the floating ref was not rejected`);
  }
});

test("the eval gate's action reference is SHA-pinned", () => {
  // `eval` is this repo's only required status check, and this reference is
  // what decides it. The aggregate test above would also pass if the step were
  // deleted outright; this one asserts the specific call site still exists and
  // is pinned.
  const evalRefs = actionReferences().filter((r) => r.ref.startsWith("edgeorgie/eval-lab@"));
  assert.equal(evalRefs.length, 1, "expected exactly one eval-lab reference");
  assert.match(evalRefs[0].ref, /^edgeorgie\/eval-lab@[0-9a-f]{40}$/);
});

test("every committed workflow is reachable by this guard", () => {
  // The guard is only as good as its file discovery: if `.github/workflows`
  // were renamed, or a composite action landed somewhere the walk misses,
  // every test above would pass vacuously over an empty set.
  const files = githubYamlFiles().map((f) => relative(REPO_ROOT, f));
  const workflows = files.filter((f) => f.startsWith(".github/workflows/"));
  for (const expected of ["eval.yml", "release.yml", "triage.yml", "ci.yml"]) {
    assert.ok(
      workflows.some((f) => f.endsWith(`/${expected}`)),
      `${expected} was not discovered; found: ${workflows.join(", ")}`,
    );
  }
  assert.ok(actionReferences().length > 0, "no references found — discovery is broken");
});
