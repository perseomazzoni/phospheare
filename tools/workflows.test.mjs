// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// node --test tools/workflows.test.mjs
//
// What the workflows decide by expression or script, run here against the
// values GitHub would give them.

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "workflows-"));
after(() => rmSync(temp, { recursive: true, force: true }));

const posix = (path) => path.replaceAll("\\", "/");
const workflow = (file) =>
  parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8"));

function workflowStep(file, name) {
  for (const job of Object.values(workflow(file).jobs)) {
    const step = (job.steps ?? []).find((s) => s.name === name);
    if (step) return step;
  }
  throw new Error(`${file} has no step named ${name}`);
}

/** Runs a step's script as Actions does, after `stubs`, with `env` added. */
function runStep(file, name, { stubs = "", env = {}, cwd } = {}) {
  const { run } = workflowStep(file, name);
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-eo", "pipefail", "-c", `${stubs}\n${run}`],
    { encoding: "utf8", env: { ...process.env, ...env }, cwd },
  );
  return { status: result.status, output: result.stdout + result.stderr };
}

/**
 * A workflow value with its `${{ }}` expressions evaluated. The expressions
 * used here (`==`, `&&`, `||`, quoted strings, context properties) read the
 * same in JavaScript.
 */
function evaluate(value, contexts) {
  const expression = (source) =>
    new Function(...Object.keys(contexts), `return (${source});`)(
      ...Object.values(contexts),
    );
  const whole = /^\$\{\{(.*)\}\}$/s.exec(value.trim());
  if (whole) return expression(whole[1]);
  return value.replace(/\$\{\{(.*?)\}\}/gs, (_, source) =>
    String(expression(source)),
  );
}

// ── Pinned actions ───────────────────────────────────────────────────────────
//
// A tag can be moved to other code; a commit cannot. Every action a workflow
// runs is pinned to a full commit SHA, with its version in the comment.

test("every action is pinned to a commit", () => {
  for (const file of readdirSync(join(ROOT, ".github/workflows"))) {
    const text = readFileSync(join(ROOT, ".github/workflows", file), "utf8");
    for (const [, ref] of text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
      if (ref.startsWith("./")) continue;
      assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${file}: ${ref}`);
    }
  }
});

// ── CI's concurrency ─────────────────────────────────────────────────────────
//
// GitHub keeps one pending run per concurrency group and cancels the one it
// replaces, whatever `cancel-in-progress` says. Every commit on main keeps its
// own verdict, so no main run may share a group with another.

function ciRun(github) {
  const { group, "cancel-in-progress": cancel } =
    workflow("ci.yml").concurrency;
  return {
    group: evaluate(group, { github }),
    cancels: Boolean(evaluate(String(cancel), { github })),
  };
}

const push = (sha) => ({ event_name: "push", ref: "refs/heads/main", sha });
const pullRequest = (sha) => ({
  event_name: "pull_request",
  ref: "refs/pull/7/merge",
  sha,
});

test("each push to main runs in a group of its own, never cancelled", () => {
  const first = ciRun(push("a".repeat(40)));
  const second = ciRun(push("b".repeat(40)));
  assert.notEqual(first.group, second.group);
  assert.equal(first.cancels, false);
});

test("a newer push to a pull request replaces its running checks", () => {
  const first = ciRun(pullRequest("a".repeat(40)));
  const second = ciRun(pullRequest("b".repeat(40)));
  assert.equal(first.group, second.group);
  assert.equal(second.cancels, true);
});

// ── The required check ───────────────────────────────────────────────────────
//
// `ci-ok` is the only required status check, so a job it does not wait for
// can fail and the pull request still merges.

test("the required check waits for every other CI job", () => {
  const { jobs } = workflow("ci.yml");
  const others = Object.keys(jobs).filter((id) => id !== "ci-ok");
  assert.deepEqual([...jobs["ci-ok"].needs].sort(), others.sort());
});

// A cheap failure must stop the expensive jobs: the browser suites start only
// when every fast check has passed.
test("browser checks wait for every fast check", () => {
  const { jobs } = workflow("ci.yml");
  const fast = ["desktop-checks", "identity-checks", "repo-checks", "web-checks"];
  for (const id of ["web-e2e-desktop", "web-e2e-mobile"])
    assert.deepEqual([...jobs[id].needs].sort(), fast, id);
});

// Steps are found by what they run, not by their labels, so a renamed step or
// a reflowed command still passes while a dropped check fails.
test("the demo boundary build and both CSS checks run in the fast checks", () => {
  const steps = workflow("ci.yml").jobs["web-checks"].steps;
  const runs = (pattern) =>
    steps.findIndex((one) => pattern.test(one.run ?? ""));
  const app = runs(/npm run build(?![:\w])/);
  const demo = runs(/npm run build:demo\b/);
  const css = runs(/check-built-css\.mjs/);
  assert.ok(app >= 0, "web-checks builds the app");
  assert.ok(demo >= 0, "web-checks builds the demo through its gate");
  assert.ok(css > Math.max(app, demo), "the CSS check follows both builds");
  const args = steps[css].run.split(/\s+/);
  for (const out of ["web/dist", "web/dist/demo"])
    assert.ok(args.includes(out), `the CSS check reads ${out}`);
});

test("CI checks the SPA, both Go modules and the repository", () => {
  const { jobs } = workflow("ci.yml");
  for (const id of [
    "web-checks",
    "identity-checks",
    "desktop-checks",
    "repo-checks",
  ])
    assert.ok(jobs[id], id);
  for (const id of ["identity-checks", "desktop-checks"]) {
    const go = jobs[id].steps.map((s) => s.run ?? "").join("\n");
    assert.match(go, /gofmt -l \./, id);
    assert.match(go, /go vet \.\/\.\.\./, id);
    assert.match(go, /go test -race \.\/\.\.\./, id);
  }
});

// ── The weekly run ───────────────────────────────────────────────────────────
//
// A new advisory or query can find a problem in code that no change touched,
// so CI and the CodeQL scan inside it run again every week.

test("CI runs every week, CodeQL scan included", () => {
  const ci = workflow("ci.yml");
  assert.ok(ci.on.schedule?.length, "ci.yml has no schedule");
  assert.equal(ci.jobs.codeql.uses, "./.github/workflows/codeql.yml");
  assert.deepEqual(
    workflow("codeql.yml").jobs.analyze.strategy.matrix.include.map(
      (entry) => entry.language,
    ),
    ["javascript-typescript", "actions", "go"],
  );
});

// ── The release ──────────────────────────────────────────────────────────────

test("release notes link to matching tagged source and build instructions", () => {
  const dir = mkdtempSync(join(temp, "source-notes-"));
  const summary = join(dir, "summary.md");
  const result = runStep("release.yml", "Write the release notes", {
    stubs: "git-cliff() { printf '%s\\n' 'Fixture release notes'; }",
    env: {
      TAG: "v1.2.3",
      GITHUB_REPOSITORY: "example/writer",
      RUNNER_TEMP: posix(dir),
      GITHUB_STEP_SUMMARY: posix(summary),
    },
  });
  assert.equal(result.status, 0, result.output);
  const notes = readFileSync(join(dir, "notes.md"), "utf8");
  assert.match(notes, /https:\/\/github.com\/example\/writer\/tree\/v1\.2\.3/);
  assert.match(notes, /archive\/refs\/tags\/v1\.2\.3\.tar\.gz/);
  assert.match(notes, /blob\/v1\.2\.3\/CONTRIBUTING\.md/);
  assert.match(notes, /blob\/v1\.2\.3\/README\.md#quickstart-for-everyone/);
});

// ── No program in the release ───────────────────────────────────────────────
//
// Writers build the program from a tag's source code. The smoke job tests the
// desktop archives, and the draft release receives the site archive only.

test("the smoke job gets every built file, the release only the site archive", () => {
  const dir = mkdtempSync(join(temp, "collect-"));
  const runner = join(dir, "runner");
  mkdirSync(join(dir, "desktop", "dist"), { recursive: true });
  mkdirSync(runner);
  writeFileSync(join(dir, "desktop", "dist", "program-windows.zip"), "w");
  writeFileSync(join(dir, "desktop", "dist", "program-linux.tar.gz"), "l");
  writeFileSync(join(runner, "site-1.2.3.tar.gz"), "s");
  const result = runStep("release.yml", "Collect the built files", {
    cwd: dir,
    env: { VERSION: "1.2.3", RUNNER_TEMP: posix(runner) },
  });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(readdirSync(join(runner, "build")).sort(), [
    "program-linux.tar.gz",
    "program-windows.zip",
    "site-1.2.3.tar.gz",
  ]);
  assert.deepEqual(readdirSync(join(runner, "release")), ["site-1.2.3.tar.gz"]);

  const { jobs } = workflow("release.yml");
  const download = (job) =>
    jobs[job].steps.find((one) => /download-artifact/.test(one.uses ?? ""))
      .with.name;
  const upload = (name) =>
    jobs["web-and-desktop"].steps.find((one) => one.with?.name === name).with
      .path;
  assert.equal(download("smoke"), "release-build");
  assert.equal(upload("release-build"), "${{ runner.temp }}/build");
  assert.equal(download("release"), "release-files");
  assert.equal(upload("release-files"), "${{ runner.temp }}/release");
});

test("the release attaches the tag's source code under a fixed name", () => {
  const { jobs } = workflow("release.yml");
  const steps = jobs.release.steps;
  const pack = steps.findIndex((one) => /git archive/.test(one.run ?? ""));
  const sums = steps.findIndex((one) => one.name === "Write SHA256SUMS");
  assert.ok(pack >= 0 && pack < sums, "the source is packed before SHA256SUMS");
  assert.match(
    steps[pack].run,
    /--prefix=once-dark-studio\/ -o "\$RUNNER_TEMP\/assets\/once-dark-studio-source\.zip" "\$TAG"/,
  );
});

test("the desktop archives are deleted at the end of every run", () => {
  const { jobs } = workflow("release.yml");
  const clean = jobs["clean-up"];
  assert.deepEqual(
    [...clean.needs].sort(),
    ["release", "smoke", "web-and-desktop"],
  );
  assert.equal(clean.if, "${{ always() }}");
  assert.deepEqual(clean.permissions, { actions: "write" });

  const dir = posix(mkdtempSync(join(temp, "clean-")));
  const log = `${dir}/gh.log`;
  const stubs = `
gh() {
  printf '%s\\n' "$*" >> '${log}'
  case "$*" in
    *"/runs/"*) printf '%s\\n' 11 12 ;;
  esac
}`;
  const result = runStep("release.yml", "Delete the desktop archives", {
    stubs,
    env: { GITHUB_REPOSITORY: "example/writer", GITHUB_RUN_ID: "7" },
  });
  assert.equal(result.status, 0, result.output);
  const calls = readFileSync(log, "utf8");
  assert.match(calls, /^api repos\/example\/writer\/actions\/runs\/7\/artifacts --jq .*"release-build"/m);
  assert.match(calls, /^api --method DELETE repos\/example\/writer\/actions\/artifacts\/11$/m);
  assert.match(calls, /^api --method DELETE repos\/example\/writer\/actions\/artifacts\/12$/m);
});

// ── The release's version ────────────────────────────────────────────────────

/**
 * Runs the version step in a checkout whose two `package.json` files say
 * `own` and `web` (by default the tag's version).
 */
function resolveVersion(tag, own = tag.replace(/^v/, ""), web = own) {
  const dir = mkdtempSync(join(temp, "version-"));
  mkdirSync(join(dir, "web"));
  const manifest = (version) =>
    JSON.stringify({ name: "x", version, dependencies: { y: "1.0.0" } }, null, 2);
  writeFileSync(join(dir, "package.json"), manifest(own));
  writeFileSync(join(dir, "web", "package.json"), manifest(web));
  const output = posix(
    join(temp, `output-${Math.random().toString(36).slice(2)}`),
  );
  const result = runStep("release.yml", "Resolve the version", {
    cwd: dir,
    env: { TAG: tag, GITHUB_OUTPUT: output },
  });
  let written = "";
  try {
    written = readFileSync(output, "utf8");
  } catch {
    // The step wrote nothing.
  }
  return { ...result, version: /^version=(.*)$/m.exec(written)?.[1] };
}

test("a version tag gives the version without its v", () => {
  for (const [tag, version] of [
    ["v1.2.3", "1.2.3"],
    ["v1.2.3-beta.1", "1.2.3-beta.1"],
  ]) {
    const result = resolveVersion(tag);
    assert.equal(result.status, 0, result.output);
    assert.equal(result.version, version);
  }
});

test("a tag whose package.json says another version fails the release", () => {
  for (const [own, web] of [
    ["1.2.2", "1.2.3"],
    ["1.2.3", "1.2.2"],
  ]) {
    const result = resolveVersion("v1.2.3", own, web);
    assert.notEqual(result.status, 0, `${own} ${web}`);
    assert.match(result.output, /says version 1\.2\.2, the tag v1\.2\.3/);
    assert.equal(result.version, undefined);
  }
});

test("any other tag fails the release before it builds", () => {
  for (const tag of ["1.2.3", "v1.2", "vnext", "v1.2.3;echo"]) {
    const result = resolveVersion(tag);
    assert.notEqual(result.status, 0, tag);
    assert.equal(result.version, undefined, tag);
  }
});

test("every release archive passes native smoke acceptance before drafting", () => {
  const { jobs } = workflow("release.yml");
  const targets = jobs.smoke.strategy.matrix.include.map((one) => one.target);
  assert.deepEqual(targets.sort(), [
    "darwin-amd64",
    "darwin-arm64",
    "linux-amd64",
    "linux-arm64",
    "windows-amd64",
  ]);
  assert.equal(jobs.smoke.needs, "web-and-desktop");
  assert.ok(jobs.release.needs.includes("smoke"));
  const step = jobs.smoke.steps.find((one) =>
    /node tools\/smoke-desktop\.mjs/.test(one.run ?? ""),
  );
  assert.ok(step, "the native smoke job runs the current acceptance script");
});

// ── The checksums ────────────────────────────────────────────────────────────

test("SHA256SUMS lists every release file and not itself", () => {
  const dir = mkdtempSync(join(temp, "sums-"));
  const assets = join(dir, "assets");
  mkdirSync(assets);
  writeFileSync(join(assets, "b.zip"), "b");
  writeFileSync(join(assets, "a.tar.gz"), "a");
  const result = runStep("release.yml", "Write SHA256SUMS", {
    cwd: assets,
    env: { RUNNER_TEMP: posix(dir) },
  });
  assert.equal(result.status, 0, result.output);
  const sums = readFileSync(join(assets, "SHA256SUMS"), "utf8");
  const names = sums
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+\*?/)[1]);
  assert.deepEqual(names, ["a.tar.gz", "b.zip"]);
  // Git for Windows' sha256sum marks binary mode with `*`; Linux writes a
  // second space. `sha256sum -c` reads both.
  assert.match(
    sums,
    /^ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb [ *]a\.tar\.gz$/m,
  );
});

// ── The draft release ────────────────────────────────────────────────────────

/**
 * Runs the release step against a stubbed `gh`. `existing` is `null` for no
 * release under the tag, or whether the existing one is a draft.
 */
function draft(tag, existing) {
  const dir = posix(mkdtempSync(join(temp, "draft-")));
  const log = `${dir}/gh.log`;
  const view =
    existing === null
      ? "return 1"
      : `printf '%s\\n' '${existing ? "true" : "false"}'`;
  const stubs = `
mkdir -p '${dir}/assets'
: > '${dir}/assets/SHA256SUMS'
gh() {
  printf '%s\\n' "$*" >> '${log}'
  case "$1 $2" in
    "release view") ${view} ;;
  esac
}`;
  const result = runStep("release.yml", "Create the draft release", {
    stubs,
    env: { TAG: tag, RUNNER_TEMP: dir },
  });
  let calls = "";
  try {
    calls = readFileSync(log, "utf8");
  } catch {
    // No call was made.
  }
  return { ...result, calls };
}

test("a new tag gets a draft release, never a published one", () => {
  const result = draft("v1.2.3", null);
  assert.equal(result.status, 0, result.output);
  assert.match(
    result.calls,
    /^release create v1\.2\.3 --draft --verify-tag --title/m,
  );
  assert.doesNotMatch(result.calls, /--prerelease/);
});

test("a pre-release tag is drafted as a pre-release", () => {
  const result = draft("v1.2.3-beta.1", null);
  assert.equal(result.status, 0, result.output);
  assert.match(
    result.calls,
    /^release create v1\.2\.3-beta\.1 --draft --verify-tag --prerelease/m,
  );
});

test("a draft from an earlier run receives the new files", () => {
  const result = draft("v1.2.3", true);
  assert.equal(result.status, 0, result.output);
  assert.match(result.calls, /^release upload v1\.2\.3 --clobber /m);
  assert.doesNotMatch(result.calls, /release create/);
});

test("a published release is never changed", () => {
  const result = draft("v1.2.3", false);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.calls, /release (create|upload)/);
});

// ── The site ─────────────────────────────────────────────────────────────────
//
// The release builds the site once and tests it as served; publishing a
// release that is not a pre-release deploys that archive, and nothing else.

test("the release builds the site after the desktop archives and serves it to the demo suite", () => {
  const { jobs } = workflow("release.yml");
  const runs = (steps, pattern) =>
    steps.findIndex((one) => pattern.test(one.run ?? ""));
  const build = jobs["web-and-desktop"].steps;
  const desktop = runs(build, /sh desktop\/build\.sh/);
  const site = runs(build, /npm run build:demo\b/);
  const collect = runs(build, /site-\$VERSION\.tar\.gz" "\$RUNNER_TEMP\/release\/"/);
  assert.ok(desktop >= 0 && site > desktop, "the site follows the desktop archives");
  assert.ok(collect > site, "the site archive is a release file");
  const served = jobs.smoke.steps.find((one) =>
    /npx playwright test/.test(one.run ?? ""),
  );
  assert.ok(served, "the smoke job drives the site archive");
  assert.equal(served.if, "matrix.browser");
  assert.equal(served.env.E2E_DEMO, "1");
  assert.match(served.run, /tar -xzf "\$RUNNER_TEMP\/assets\/site-\$VERSION\.tar\.gz"/);
});

test("only a published release that is not a pre-release deploys the site", () => {
  const site = workflow("site.yml");
  assert.deepEqual(Object.keys(site.on), ["release"]);
  assert.deepEqual(site.on.release.types, ["published"]);
  const deploys = (prerelease) =>
    Boolean(evaluate(site.jobs.site.if, { github: { event: { release: { prerelease } } } }));
  assert.equal(deploys(false), true);
  assert.equal(deploys(true), false);
  assert.deepEqual(site.jobs.deploy.needs, "site");
});

test("only the deploy job can write to Pages, one deployment at a time", () => {
  const site = workflow("site.yml");
  assert.deepEqual(site.permissions, { contents: "read" });
  assert.equal(site.jobs.site.permissions, undefined);
  assert.deepEqual(site.jobs.deploy.permissions, {
    pages: "write",
    "id-token": "write",
  });
  assert.equal(site.jobs.deploy.environment.name, "github-pages");
  assert.deepEqual(site.concurrency, {
    group: "pages",
    "cancel-in-progress": false,
  });
});

/**
 * Runs the deploy's check on a release holding a site archive and its
 * `SHA256SUMS`. `sums` can replace the checksums and `missingFile` can
 * leave a required file out of an otherwise valid archive.
 */
function checkSite(sums, missingFile) {
  const dir = posix(mkdtempSync(join(temp, "site-")));
  const content = `${dir}/content`;
  mkdirSync(`${content}`);
  for (const file of [
    "index.html",
    "404.html",
    "LICENSE.txt",
    "third-party-notices.txt",
  ].filter((file) => file !== missingFile))
    writeFileSync(join(content, file), file);
  mkdirSync(`${dir}/release`);
  const packed = spawnSync(
    "bash",
    ["-c", `tar -czf release/site-1.2.3.tar.gz -C content . && (cd release && sha256sum site-1.2.3.tar.gz > SHA256SUMS)`],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(packed.status, 0, packed.stderr);
  if (sums !== undefined) writeFileSync(join(dir, "release/SHA256SUMS"), sums);
  const result = runStep("site.yml", "Check the archive and unpack it", {
    env: { TAG: "v1.2.3", RUNNER_TEMP: dir },
  });
  let unpacked = [];
  try {
    unpacked = readdirSync(join(dir, "site")).sort();
  } catch {
    // Nothing was unpacked.
  }
  return { ...result, unpacked };
}

test("the deploy unpacks a site archive that matches SHA256SUMS", () => {
  const result = checkSite();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.unpacked, [
    "404.html",
    "LICENSE.txt",
    "index.html",
    "third-party-notices.txt",
  ]);
});

test("the deploy refuses a matching site archive without the program licence", () => {
  const result = checkSite(undefined, "LICENSE.txt");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /has no LICENSE\.txt/);
});

test("the deploy refuses a site archive SHA256SUMS does not list or does not match", () => {
  for (const sums of [
    `${"0".repeat(64)}  other.zip\n`,
    `${"0".repeat(64)}  site-1.2.3.tar.gz\n`,
  ]) {
    const result = checkSite(sums);
    assert.notEqual(result.status, 0, sums);
    assert.deepEqual(result.unpacked, [], sums);
  }
});
