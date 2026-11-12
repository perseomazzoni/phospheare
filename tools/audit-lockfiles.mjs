// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Fails when any npm lockfile in the repository installs a package with a
// known advisory, at any severity, that `audit-exceptions.json` does not
// excuse.
//
//     node tools/audit-lockfiles.mjs
//
// Every tracked `package-lock.json` is audited, not only the app's: the tool
// trees under `tools/` are installed and run by CI jobs that hold release
// credentials, so an advisory there reaches the runner even though no writer
// ever loads it. Dev dependencies count for the same reason.
//
// An exception names one advisory by its `GHSA-` id, the lockfile it applies to,
// why the vulnerable path cannot be reached, and a date it lapses on. A lapsed
// exception fails the run like no exception at all, so an accepted risk is
// looked at again rather than forgotten. Do not add an exception without a
// reason that names the call path.

import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const lockfiles = execFileSync("git", ["ls-files", "*package-lock.json"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter((path) => path && !path.includes("node_modules/"));

/** @type {{ advisory: string, lockfile: string, reason: string, expires: string }[]} */
const exceptions = JSON.parse(
  readFileSync(join(root, "tools/audit-exceptions.json"), "utf8"),
).exceptions;

const today = new Date().toISOString().slice(0, 10);
const failures = [];

for (const lockfile of lockfiles) {
  const dir = dirname(join(root, lockfile));
  let report;
  try {
    // A fixed command line with no interpolated part, run through the
    // shell so Windows finds `npm.cmd`.
    report = execSync("npm audit --json --ignore-scripts", {
      cwd: dir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm exits non-zero whenever it finds anything; the JSON is still on
    // stdout. No stdout is a failure of the audit itself.
    if (!error.stdout) throw error;
    report = error.stdout;
  }

  // An audit that could not run (the registry unreachable, a broken
  // lockfile) also prints JSON, with an `error` and no `vulnerabilities`.
  // That is not a clean lockfile, and it fails the run.
  const parsed = JSON.parse(report);
  if (parsed.error || typeof parsed.vulnerabilities !== "object") {
    failures.push(`${lockfile}: the audit did not run`);
    continue;
  }
  for (const [name, entry] of Object.entries(parsed.vulnerabilities)) {
    for (const via of entry.via) {
      // A string names another vulnerable package, reported on its own.
      if (typeof via === "string") continue;
      const advisory = via.url?.split("/").pop() ?? "";
      const excused = exceptions.find(
        (one) =>
          one.advisory === advisory &&
          one.lockfile === lockfile &&
          one.expires >= today,
      );
      if (!excused)
        failures.push(`${lockfile}: ${name} ${via.severity} ${via.url}`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    `Lockfiles that fail the audit:\n  ${[...new Set(failures)].join("\n  ")}`,
  );
  process.exit(1);
}

console.log(`${lockfiles.length} lockfiles audited; nothing unexcused.`);
