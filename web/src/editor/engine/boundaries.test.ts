// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Enforces the engine's dependency rule: the layers point one way and nothing
// crosses the engine's edge, as `engine/index.ts` states. The test walks
// every file under `engine/` and fails on any import that breaks it.
//
//   1. Nothing under `engine/` imports anything outside it: no views, React,
//      DOM or storage. The engine is pure TypeScript.
//   2. No file imports react, react-dom or the DOM library, bare or scoped.
//   3. A layer imports only the layers `ALLOWED_IMPORTS` lists: domain knows
//      nothing; application knows domain and ports; ports know domain, which
//      types their signatures; adapters know everything below them.
//
// A failure is fixed by moving the import where it belongs or re-exporting
// through the engine barrel, never by weakening the rule.
//
// The engine has no Node types, so the walk uses Vite's `import.meta.glob`
// with raw imports instead of `node:fs`. Glob keys are relative to this file,
// at the engine root, so the check runs in engine-root-relative paths.

import { describe, expect, it } from "vitest";
import { moduleImports } from "../../testing/moduleImports.fixture";

// Layer → layers it may import from (by first path segment under engine/).
const ALLOWED_IMPORTS: Record<string, string[]> = {
  domain: ["domain"],
  application: ["domain", "application", "ports"],
  ports: ["domain"],
  adapters: ["domain", "application", "ports", "adapters"],
};

const FORBIDDEN_BARE = ["react", "react-dom", "dom"];

// Joins path segments, resolving '.' and '..', for the relative specifiers
// this test inspects, without `node:path`. Paths are engine-root-relative: a
// result that starts with '..' has escaped the engine root.
function resolve(fromDir: string, specifier: string): string {
  const parts = [...fromDir.split("/"), ...specifier.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0) out.pop();
      else return "..";
    } else {
      out.push(part);
    }
  }
  return out.join("/");
}

interface Violation {
  file: string;
  line: number;
  specifier: string;
  reason: string;
}

function violationsFor(relative: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const layer = relative.split("/")[0];
  const dir = relative.includes("/")
    ? relative.slice(0, relative.lastIndexOf("/"))
    : "";

  for (const { specifier, line } of moduleImports(source)) {
    if (specifier.startsWith(".")) {
      const target = resolve(dir, specifier);
      if (target === ".." || target.startsWith("../")) {
        violations.push({
          file: relative,
          line,
          specifier,
          reason: "escapes the engine root",
        });
        continue;
      }
      const targetLayer = target.split("/")[0];
      const allowed = ALLOWED_IMPORTS[layer];
      if (allowed && !allowed.includes(targetLayer)) {
        violations.push({
          file: relative,
          line,
          specifier,
          reason: `${layer}/ may not import ${targetLayer}/`,
        });
      }
      continue;
    }

    for (const forbidden of FORBIDDEN_BARE) {
      if (specifier === forbidden || specifier.startsWith(`${forbidden}/`)) {
        violations.push({
          file: relative,
          line,
          specifier,
          reason: `imports ${forbidden}`,
        });
      }
    }
  }
  return violations;
}

describe("engine boundaries", () => {
  it("sees every form a module is named in", () => {
    const reasons = (source: string) =>
      violationsFor("domain/model.ts", source).map((v) => v.reason);
    expect(reasons(`const m = await import("react");`)).toEqual([
      "imports react",
    ]);
    expect(reasons(`const m = require("react-dom/client");`)).toEqual([
      "imports react-dom",
    ]);
    expect(reasons(`export { x } from "../application/run";`)).toEqual([
      "domain/ may not import application/",
    ]);
    expect(reasons(`import "../../views/engine";`)).toEqual([
      "escapes the engine root",
    ]);
    expect(
      reasons(`import type {\n  Block,\n} from "./block";\n// import "react";`),
    ).toEqual([]);
  });

  it("every engine file respects the dependency rule", () => {
    // Keys are engine-root-relative with a leading './', as in
    // './domain/model.ts'.
    const files = import.meta.glob("./**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const sourceFiles = Object.entries(files).filter(
      ([key]) => !key.endsWith(".test.ts"),
    );
    expect(sourceFiles.length).toBeGreaterThan(0);

    const violations = sourceFiles.flatMap(([key, source]) =>
      violationsFor(key.slice(2), source),
    );
    const formatted = violations.map(
      (v) => `${v.file}:${v.line}: import '${v.specifier}' — ${v.reason}`,
    );
    expect(formatted, formatted.join("\n")).toEqual([]);
  });
});
