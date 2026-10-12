import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { load as loadYaml } from "js-yaml";

const REPO_ROOT = join(import.meta.dirname, "..");
const GITHUB_DIR = join(REPO_ROOT, ".github");

/** Directories that cannot contribute a step to a run, and are huge. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "out", "dist", "coverage"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Every YAML file in the repo that can contribute a step to a run.
 *
 * Two classes, because GitHub's own scoping rules are not the same for both:
 *
 *   1. Anything `*.yml`/`*.yaml` under `.github/` — workflows, and composite
 *      actions that happen to live there.
 *   2. Any file literally named `action.yml`/`action.yaml` ANYWHERE in the
 *      repo. `uses: ./path` resolves against the REPOSITORY ROOT, not against
 *      `.github/`, so a composite action in `src/`, `tools/` or at the root is
 *      just as executable as one under `.github/actions/`. A previous version
 *      of this guard walked only `.github/` while trusting every `./` ref
 *      unconditionally; that mismatch let a composite action one directory
 *      outside `.github/` carry `uses: attacker/evil@main` with the suite
 *      green. Discovery scope and trust scope must be the same scope.
 *
 * Extension matching is case-INSENSITIVE: whether GitHub loads `CI.YML` is not
 * a question worth leaving open for the cost of one regex flag.
 *
 * Discovered by walking the tree at runtime rather than listing paths here. A
 * hand-maintained list of files is the drift class this repo has repeatedly
 * been bitten by, and a workflow or composite action added later must not
 * arrive unexamined.
 */
function repoYamlFiles(dir: string = REPO_ROOT, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      repoYamlFiles(full, out);
    } else if (
      (/\.ya?ml$/i.test(entry) && full.startsWith(GITHUB_DIR + sep)) ||
      /^action\.ya?ml$/i.test(entry)
    ) {
      out.push(full);
    }
  }
  return out;
}

type Ref = { where: string; ref: string };

function parseYamlFile(file: string): unknown {
  const where = relative(REPO_ROOT, file);
  try {
    return loadYaml(readFileSync(file, "utf8"));
  } catch (cause) {
    // A file we cannot parse is not a file we can clear. Fail, rather than
    // skipping it and reporting the remaining set as clean.
    assert.fail(`${where} did not parse as YAML: ${(cause as Error).message}`);
  }
}

/**
 * Collect EVERY `uses` key in a parsed document, at any depth.
 *
 * This replaces an earlier walk of three known key paths
 * (`jobs.*.steps[].uses`, `jobs.*.uses`, `runs.steps[].uses`). Enumerating
 * positions is the same denylist mistake as enumerating `@main` spellings: the
 * first position nobody listed wins. Two were measured winning against the
 * positional walk on this very file:
 *
 *   - `- <<: *anchor` — js-yaml 5's default schema does NOT resolve merge keys,
 *     so the step parses as `{ "<<": { uses: "attacker/evil@main" } }` and
 *     `step.uses` is `undefined`. A deep walk finds the `uses` inside the
 *     merge-key value whether or not the parser resolves `<<`, which is the
 *     point: this guard must not silently change meaning when its YAML parser
 *     is bumped. (`js-yaml` is pinned exactly in package.json for the same
 *     reason, and the merge-key behaviour is asserted below.)
 *   - `with: { action: owner/repo@main }` — dangerous only for wrapper actions
 *     that take an action name as input, but free to cover here.
 *
 * A line-regex over `uses:` is not sufficient either, and was measured to be
 * defeated: `- { uses: foo@main }` (flow mapping), `"uses": foo@main` (quoted
 * key), `uses : foo@main` (space before the colon) and a value on the
 * following line are all valid YAML that GitHub executes and that no
 * reasonable regex catches. The parser resolves every spelling to the same
 * key, so it cannot be spelled around.
 */
function collectUses(node: unknown, path: string, out: Ref[]): void {
  if (Array.isArray(node)) {
    node.forEach((value, i) => collectUses(value, `${path}[${i}]`, out));
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "uses" && typeof value === "string" && value.length > 0) {
      out.push({ where: `${path}.uses`, ref: value });
      continue;
    }
    // `with.action` is an action reference for wrapper/dispatch actions that
    // take one as an input. No action used here takes such an input today, so
    // this is hardening rather than a live hole — and it is deliberately strict:
    // if a future action takes an `action` input that is NOT a reference, this
    // guard will fail on it, and the right response is to rename the input in
    // the call or to carve out that one call site here, with a reason.
    if (key === "with" && isRecord(value) && typeof value.action === "string") {
      out.push({ where: `${path}.with.action`, ref: value.action });
    }
    // `<<` is reported as the merge key it is rather than as a literal path
    // segment, so a failure message points at something a reader recognises.
    collectUses(value, key === "<<" ? `${path}(merge)` : `${path}.${key}`, out);
  }
}

/**
 * Every `image:` string inside a `container:`/service spec, at any depth, so a
 * spec assembled behind a merge key or an alias is still graded.
 */
function imagesInSpec(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((value) => imagesInSpec(value, out));
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "image" && typeof value === "string") out.push(value);
    else imagesInSpec(value, out);
  }
}

/**
 * Collect `jobs.*.container` and `jobs.*.services.*` images, at any depth, in
 * both the object (`container: {image: x}`) and string (`container: x`) forms
 * GitHub accepts.
 *
 * `jobs.<id>.container.image` is the image EVERY step in that job executes
 * inside, with full access to the job's secrets and `GITHUB_TOKEN` — a
 * strictly larger blast radius than one action step. The guard used to catch
 * that same image when it arrived via `uses: docker://...` and ignore it
 * entirely when it arrived via `container:`, which made the file's own stated
 * invariant false while a `:latest` tag was present.
 */
function collectImages(node: unknown, path: string, out: Ref[]): void {
  if (Array.isArray(node)) {
    node.forEach((value, i) => collectImages(value, `${path}[${i}]`, out));
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const here = key === "<<" ? `${path}(merge)` : `${path}.${key}`;
    if (key === "container") {
      if (typeof value === "string") out.push({ where: here, ref: value });
      else {
        const images: string[] = [];
        imagesInSpec(value, images);
        for (const image of images) out.push({ where: `${here}.image`, ref: image });
      }
    } else if (key === "services" && isRecord(value)) {
      for (const [name, svc] of Object.entries(value)) {
        if (typeof svc === "string") out.push({ where: `${here}.${name}`, ref: svc });
        else {
          const images: string[] = [];
          imagesInSpec(svc, images);
          for (const image of images) out.push({ where: `${here}.${name}.image`, ref: image });
        }
      }
    }
    collectImages(value, here, out);
  }
}

const isLocalRef = (ref: string) => ref === "./" || ref.startsWith("./");

/**
 * Resolve a local `./` action reference to the action file GitHub would
 * actually run, or fail.
 *
 * `./` is the only non-SHA form this guard accepts, on the grounds that a local
 * action moves only with this repo's own reviewed history. That argument holds
 * ONLY if the target is really in this repo and really gets graded. Trusting
 * the two-character prefix without resolving it is what let
 * `uses: ./src/ci-actions/deploy` launder `uses: attacker/evil@main`.
 *
 * Fails closed: a `./` ref whose action file cannot be found, or that escapes
 * the repository root, is a failure, not a pass.
 */
function resolveLocalAction(ref: string, where: string): string {
  const rel = ref.replace(/^\.\//, "").replace(/\/+$/, "");
  const base = resolve(REPO_ROOT, rel);
  assert.ok(
    base === REPO_ROOT || base.startsWith(REPO_ROOT + sep),
    `${where} -> ${ref}: local reference escapes the repository root (${base})`,
  );
  const candidates = /\.ya?ml$/i.test(base)
    ? [base]
    : [join(base, "action.yml"), join(base, "action.yaml")];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return assert.fail(
    `${where} -> ${ref}: resolves to no action file (looked for ${candidates
      .map((c) => relative(REPO_ROOT, c))
      .join(", ")}). A local reference this guard cannot resolve cannot be cleared.`,
  );
}

/**
 * Every action/workflow reference reachable from this repo, with local `./`
 * references resolved to their real action files and recursed into.
 *
 * Reference resolution flow:
 *
 *   discovered files (any y[a]ml under .github/  +  any action.y[a]ml in repo)
 *          |
 *          v  parse (fail closed on unparseable / multi-document)
 *   deep-walk every `uses` key at ANY depth  ---------------+
 *          |                                                |
 *          +--> external ref  -> graded by isImmutable()     |
 *          |                                                |
 *          +--> `./` ref -> resolveLocalAction()             |
 *                              | (fail closed if missing)    |
 *                              v                             |
 *                     parse the action file ----------------->+
 *                              (visited-set stops cycles)
 */
function actionReferences(): Ref[] {
  const files = repoYamlFiles();
  assert.ok(files.length > 0, `no YAML files found under ${REPO_ROOT}`);

  const refs: Ref[] = [];
  const visited = new Set<string>();
  const queue: string[] = [...files];

  while (queue.length > 0) {
    const file = queue.shift() as string;
    const key = resolve(file);
    if (visited.has(key)) continue;
    visited.add(key);

    const doc = parseYamlFile(file);
    if (!doc || typeof doc !== "object") continue;
    const where = relative(REPO_ROOT, file);
    const found: Ref[] = [];
    collectUses(doc, where, found);
    for (const ref of found) {
      refs.push(ref);
      if (isLocalRef(ref.ref)) {
        // Resolve (fail closed) and grade the target's own refs too, so a local
        // action cannot launder a floating external ref — transitively, through
        // any number of hops, inside `.github/` or anywhere else.
        const target = resolveLocalAction(ref.ref, ref.where);
        if (!visited.has(resolve(target))) queue.push(target);
      }
    }
  }
  return refs;
}

function containerImages(): Ref[] {
  const out: Ref[] = [];
  for (const file of repoYamlFiles()) {
    const doc = parseYamlFile(file);
    if (!doc || typeof doc !== "object") continue;
    collectImages(doc, relative(REPO_ROOT, file), out);
  }
  return out;
}

/**
 * A reference is immutable when GitHub resolves it to the same tree on every
 * run. Only two forms qualify:
 *
 *   - `./` or `./path` — a local composite action, which moves only with this
 *     repo's own reviewed history. This is NOT taken on trust: the target is
 *     resolved to a real `action.yml`/`action.yaml` on disk (absent file =
 *     failure), parsed, and its own `uses:` refs are collected and graded by
 *     this same predicate, recursively, with a visited-set for cycles. See
 *     `resolveLocalAction` and `actionReferences`.
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
 * enumerated (`@latest`, `@release/2`, a short SHA). Short SHAs are rejected on
 * purpose — they are ambiguous, and not what GitHub resolves immutably.
 */
function isImmutable(ref: string): boolean {
  if (isLocalRef(ref)) return true; // only ever reached after resolveLocalAction succeeded
  const at = ref.lastIndexOf("@");
  if (at <= 0) return false;
  return /^[0-9a-f]{40}$/.test(ref.slice(at + 1));
}

/**
 * A container image is immutable only when pinned by digest. Tags — including
 * `:latest` and `:1.2.3` — are repointable by whoever owns the registry
 * namespace, which is the same property that makes `@v4` unacceptable above.
 */
function isDigestPinned(image: string): boolean {
  return /@sha256:[0-9a-f]{64}$/.test(image);
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

test("every container and service image is digest-pinned", () => {
  const floating = containerImages().filter((r) => !isDigestPinned(r.ref));
  assert.deepEqual(
    floating,
    [],
    "these container/service images are not digest-pinned, so the code every " +
      "step in the job runs inside can change with no diff here:\n" +
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
    "docker://alpine:latest",
  ]) {
    assert.ok(!isImmutable(bad), `expected ${bad} to be rejected`);
  }
});

test("the image predicate requires a digest and refuses every tag", () => {
  // The repo currently defines no container or service images, so the aggregate
  // test above passes over an empty set. This is the non-vacuous half: it pins
  // what WOULD be accepted the day someone adds one.
  for (const good of [
    `ghcr.io/owner/payload@sha256:${"a".repeat(64)}`,
    `postgres@sha256:${"b".repeat(64)}`,
  ]) {
    assert.ok(isDigestPinned(good), `expected ${good} to be accepted`);
  }
  for (const bad of [
    "ghcr.io/attacker/payload:latest",
    "attacker/postgres:16",
    "postgres",
    `postgres@sha1:${"c".repeat(40)}`,
    `postgres@sha256:${"d".repeat(63)}`,
  ]) {
    assert.ok(!isDigestPinned(bad), `expected ${bad} to be rejected`);
  }
});

test("the deep walk sees uses: in every YAML shape a positional walk would miss", () => {
  // This is the assertion that makes the switch away from a line-regex, and
  // then away from a three-position walk, meaningful rather than cosmetic. Each
  // shape below is valid YAML, and each was measured passing an earlier version
  // of this guard while a floating ref was live in the file.
  const shapes: Record<string, string> = {
    "flow mapping": "jobs:\n  a:\n    steps:\n      - { name: x, uses: o/r@main }\n",
    "quoted key": 'jobs:\n  a:\n    steps:\n      - "uses": o/r@main\n',
    "space before colon": "jobs:\n  a:\n    steps:\n      - uses : o/r@main\n",
    "value on next line": "jobs:\n  a:\n    steps:\n      - uses:\n          o/r@main\n",
    "explicit string tag": "jobs:\n  a:\n    steps:\n      - uses: !!str o/r@main\n",
    "composite action step": "runs:\n  using: composite\n  steps:\n    - uses: o/r@main\n",
    "merge key": "x: &d\n  uses: o/r@main\njobs:\n  a:\n    steps:\n      - <<: *d\n        name: n\n",
    "merge key list":
      "x: &d\n  uses: o/r@main\ny: &e\n  shell: bash\njobs:\n  a:\n    steps:\n      - <<: [*d, *e]\n",
    "plain alias step": "x: &d\n  uses: o/r@main\njobs:\n  a:\n    steps:\n      - *d\n",
    "with.action input": "jobs:\n  a:\n    steps:\n      - with:\n          action: o/r@main\n",
    "steps nested under an unexpected key":
      "jobs:\n  a:\n    strategy:\n      matrix:\n        x:\n          - uses: o/r@main\n",
  };

  for (const [label, text] of Object.entries(shapes)) {
    const found: Ref[] = [];
    collectUses(loadYaml(text), label, found);
    const refs = found.map((r) => r.ref);
    // The anchor-definition shapes legitimately yield the ref twice (once at
    // the anchor, once where it is merged/aliased in); what matters is that the
    // ref is seen at all and that every sighting is rejected.
    assert.ok(refs.length > 0, `the walk missed the ${label} shape entirely`);
    assert.deepEqual(
      [...new Set(refs)],
      ["o/r@main"],
      `the walk misread the ${label} shape`,
    );
    for (const ref of refs) assert.ok(!isImmutable(ref), `${label}: floating ref not rejected`);
  }
});

test("a reusable workflow call at job level is still graded", () => {
  const found: Ref[] = [];
  collectUses(loadYaml("jobs:\n  a:\n    uses: o/r/.github/workflows/ci.yml@main\n"), "t", found);
  assert.deepEqual(
    found.map((r) => r.ref),
    ["o/r/.github/workflows/ci.yml@main"],
  );
  assert.ok(!isImmutable(found[0].ref));
});

test("the container/service image walk sees both the object and string forms", () => {
  const shapes: Record<string, string> = {
    "container object": "jobs:\n  a:\n    container:\n      image: ghcr.io/x/y:latest\n",
    "container string": "jobs:\n  a:\n    container: ghcr.io/x/y:latest\n",
    "service image": "jobs:\n  a:\n    services:\n      db:\n        image: ghcr.io/x/y:latest\n",
    "service string": "jobs:\n  a:\n    services:\n      db: ghcr.io/x/y:latest\n",
    "container behind a merge key":
      "x: &d\n  image: ghcr.io/x/y:latest\njobs:\n  a:\n    container:\n      <<: *d\n",
  };
  for (const [label, text] of Object.entries(shapes)) {
    const found: Ref[] = [];
    collectImages(loadYaml(text), label, found);
    assert.ok(found.length > 0, `the image walk missed the ${label} shape`);
    for (const image of found)
      assert.ok(!isDigestPinned(image.ref), `${label}: floating image not rejected`);
  }
});

test("the eval gate's action reference is SHA-pinned", () => {
  // `eval` is one of this repo's two required status checks, and this reference
  // is what decides it. The aggregate test above would also pass if the step
  // were deleted outright; this one asserts the specific call site still exists
  // and is pinned.
  const evalRefs = actionReferences().filter((r) => r.ref.startsWith("edgeorgie/eval-lab@"));
  assert.equal(evalRefs.length, 1, "expected exactly one eval-lab reference");
  assert.match(evalRefs[0].ref, /^edgeorgie\/eval-lab@[0-9a-f]{40}$/);
});

test("every committed workflow is reachable by this guard", () => {
  // The guard is only as good as its file discovery: if `.github/workflows`
  // were renamed, or a composite action landed somewhere the walk misses,
  // every test above would pass vacuously over an empty set.
  const files = repoYamlFiles().map((f) => relative(REPO_ROOT, f));
  const workflows = files.filter((f) => f.startsWith(".github/workflows/"));
  for (const expected of ["eval.yml", "release.yml", "triage.yml", "ci.yml"]) {
    assert.ok(
      workflows.some((f) => f.endsWith(`/${expected}`)),
      `${expected} was not discovered; found: ${workflows.join(", ")}`,
    );
  }
  assert.ok(actionReferences().length > 0, "no references found — discovery is broken");
});

test("the YAML parser this guard depends on is pinned exactly", () => {
  // The guard's correctness depends on its parser. js-yaml 5's default schema
  // does NOT resolve `<<` merge keys (measured: a merged step parses as
  // `{ "<<": { uses: ... } }`), which is why the walk above is depth-first over
  // every `uses` key instead of reading `step.uses` — that walk finds the ref
  // whether or not the parser resolves the merge. Pinning the version on top of
  // that means a minor release cannot change this file's meaning with no diff
  // here, which is the exact property this file exists to require of everything
  // else. A caret range here would be the guard floating its own dependency.
  const pkg = loadYaml(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  assert.ok(isRecord(pkg), "package.json did not parse");
  const dev = pkg.devDependencies;
  assert.ok(isRecord(dev), "package.json has no devDependencies");
  assert.match(
    typeof dev["js-yaml"] === "string" ? dev["js-yaml"] : "",
    /^\d+\.\d+\.\d+$/,
    "js-yaml must be pinned to an exact version, not a range",
  );
});

test("every workflow declares least-privilege permissions", () => {
  // Pinning a SHA bounds WHICH code runs; it does nothing to bound what that
  // code can do. `eval.yml` invokes an action from another repository and ran
  // for a while on the repository-default token permissions — i.e. write, on a
  // repo whose default is read-write — on every PR and every push to main.
  const workflows = repoYamlFiles().filter((f) =>
    relative(REPO_ROOT, f).startsWith(".github/workflows/"),
  );
  for (const file of workflows) {
    const where = relative(REPO_ROOT, file);
    const doc = parseYamlFile(file);
    assert.ok(isRecord(doc), `${where} did not parse as a mapping`);
    const permissions = doc.permissions;
    assert.ok(
      permissions === "read-all" || isRecord(permissions),
      `${where} declares no top-level permissions: block, so it runs on the ` +
        `repository-default GITHUB_TOKEN scope`,
    );
    if (isRecord(permissions)) {
      assert.ok(
        Object.keys(permissions).length > 0,
        `${where} declares an empty permissions: block`,
      );
    }
  }
});
