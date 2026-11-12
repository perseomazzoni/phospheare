// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Fails when a `.sarif` report holds a high or critical finding that is not
// suppressed in the source.
//
//     node tools/check-sarif.mjs <report.sarif>...
//
// High and critical are a security severity of 7.0 and up, GitHub's own
// thresholds. A finding below that is printed and does not fail. A finding is
// suppressed by a comment on the line above it that names its rule and says
// why, such as `// codeql[js/incomplete-sanitization] a hard break, not an
// escape`, the form GitHub code scanning reads as well.
//
// In GitHub Actions each finding is also an annotation on the pull request's
// diff.

import { existsSync, readFileSync } from "node:fs";

const HIGH = 7.0;
const inActions = process.env.GITHUB_ACTIONS === "true";

/**
 * The rule a result belongs to, from the driver or a query pack. A
 * `toolComponent.index` counts into `tool.extensions`, where CodeQL keeps its
 * query packs; a result naming no component may be any of them.
 */
function ruleOf(run, result) {
  const extensions = run.tool.extensions ?? [];
  const at = result.rule?.toolComponent?.index;
  const pool =
    at === undefined ? [run.tool.driver, ...extensions] : [extensions[at]];
  for (const component of pool) {
    const rule = (component?.rules ?? []).find((r) => r.id === result.ruleId);
    if (rule) return rule;
  }
  return undefined;
}

/** Whether the line above the finding names its rule in a suppression. */
function suppressedInSource(result, path, line) {
  if ((result.suppressions ?? []).length > 0) return true;
  if (!existsSync(path) || line < 2) return false;
  const above = readFileSync(path, "utf8").split(/\r?\n/)[line - 2] ?? "";
  return above.includes(`codeql[${result.ruleId}]`);
}

let failing = 0;
for (const file of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(file, "utf8"));
  for (const run of report.runs) {
    for (const result of run.results ?? []) {
      const where = result.locations?.[0]?.physicalLocation;
      const path = where?.artifactLocation?.uri ?? "";
      const line = where?.region?.startLine ?? 0;
      if (suppressedInSource(result, path, line)) continue;
      const severity = Number(
        ruleOf(run, result)?.properties?.["security-severity"] ?? 0,
      );
      const high = severity >= HIGH;
      if (high) failing++;
      const text = `${result.ruleId} (${severity || "no severity"}): ${result.message?.text ?? ""}`;
      console.log(
        inActions
          ? `::${high ? "error" : "warning"} file=${path},line=${line}::${text}`
          : `${high ? "error" : "warning"} ${path}:${line} ${text}`,
      );
    }
  }
}

if (failing > 0) {
  console.error(`${failing} high or critical finding(s) not suppressed.`);
  process.exit(1);
}
console.log("no high or critical findings");
