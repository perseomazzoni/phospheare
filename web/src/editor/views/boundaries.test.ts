// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Fences the editor core's writing views. With `engine/boundaries.test.ts`,
// the core (`engine/` and `views/`) imports nothing outside itself, so it
// could leave the app as a package of its own:
//
//   1. A file under `views/` imports only `views/` itself and the engine's
//      entry point (`engine/index.ts`), never a file inside the engine.
//   2. Its only packages are React, its renderer and `react-i18next`, which
//      a host provides.
//   3. What it needs of the app (the plane, the keyboard, the HTML sink, the
//      station's glyph) comes in through `ViewHost` in `view/port.ts`.
//
// The tests and the two suites' helpers (`view/viewProps.fixture.ts`,
// `view/contract.fixture.ts`) stand outside the fence: they build a host
// from the app's real pieces and import the test runner.

import { describe, expect, it } from "vitest";
import { importedModules } from "../../testing/moduleImports.fixture";

const SOURCES = import.meta.glob(
  [
    "./**/*.{ts,tsx}",
    "!./**/*.test.{ts,tsx}",
    "!./view/viewProps.fixture.ts",
    "!./view/contract.fixture.ts",
  ],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const PACKAGES = /^(?:react(?:-dom)?(?:\/.*)?|react-i18next)$/;

/** Where a relative import lands, from `editor/`; null for a package. */
function resolve(file: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const url = new URL(
    spec,
    `file:///editor/views/${file.replace(/^\.\//, "")}`,
  );
  return url.pathname.slice("/editor/".length);
}

function crossings(file: string, source: string): string[] {
  return importedModules(source).flatMap((spec) => {
    const target = resolve(file, spec);
    if (target === null)
      return PACKAGES.test(spec) ? [] : [`${file} imports ${spec}`];
    if (target.startsWith("views/")) return [];
    if (target === "engine" || target === "engine/index") return [];
    return [`${file} → ${spec}`];
  });
}

describe("the editor core's views", () => {
  it("can tell an import inside the core from one outside it", () => {
    expect(
      crossings("./view/EditorCore.tsx", `const m = await import("../../ui");`),
    ).toHaveLength(1);
    expect(
      crossings("./view/EditorCore.tsx", `const m = require("../../ui");`),
    ).toHaveLength(1);
    expect(
      crossings("./view/EditorCore.tsx", `export { x } from "../../ui";`),
    ).toHaveLength(1);
    expect(crossings("./view/EditorCore.tsx", `import "./port";`)).toEqual([]);
    expect(
      crossings("./view/EditorCore.tsx", `import { x } from "../../engine";`),
    ).toEqual([]);
    expect(
      crossings("./writing/dom.ts", `import { x } from "../../engine/domain";`),
    ).toHaveLength(1);
    expect(
      crossings("./view/EditorCore.tsx", `import { Icon } from "../../../ui";`),
    ).toHaveLength(1);
    expect(
      crossings(
        "./view/EditorCore.tsx",
        `import { x } from "../../useNarrow";`,
      ),
    ).toHaveLength(1);
    expect(crossings("./engine.ts", `import { t } from "i18next";`)).toEqual([
      "./engine.ts imports i18next",
    ]);
    expect(
      crossings("./engine.ts", `import { jsx } from "react/jsx-runtime";`),
    ).toEqual([]);
  });

  it("imports only itself, the engine's entry point, React and react-i18next", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    expect(
      Object.entries(SOURCES).flatMap(([file, source]) =>
        crossings(file, source),
      ),
    ).toEqual([]);
  });
});
