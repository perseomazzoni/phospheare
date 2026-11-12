// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { moduleImports } from "./moduleImports.fixture";

const one = (source: string) => {
  const found = moduleImports(source);
  expect(found).toHaveLength(1);
  const [only] = found;
  return only;
};

describe("moduleImports", () => {
  it("reads a static import, with its line", () => {
    expect(one(`\n\nimport { a } from "./a";`)).toEqual({
      specifier: "./a",
      kind: "static",
      typeOnly: false,
      built: false,
      line: 3,
    });
    expect(one(`import a from "a";`)).toMatchObject({ typeOnly: false });
    expect(one(`import * as a from "a";`)).toMatchObject({ typeOnly: false });
  });

  it("reads an import spread over several lines", () => {
    expect(one(`import {\n  a,\n  b,\n} from\n  "../a/b";`)).toMatchObject({
      specifier: "../a/b",
      kind: "static",
      typeOnly: false,
    });
  });

  it("tells a type import from a value import", () => {
    expect(one(`import type { A } from "a";`).typeOnly).toBe(true);
    expect(one(`import type A from "a";`).typeOnly).toBe(true);
    expect(one(`import { type A, type B } from "a";`).typeOnly).toBe(true);
    expect(one(`import { type A, b } from "a";`).typeOnly).toBe(false);
    expect(one(`import C, { type A } from "a";`).typeOnly).toBe(false);
    expect(one(`import {} from "a";`).typeOnly).toBe(false);
  });

  it("reads a side-effect import", () => {
    expect(one(`import "./register";`)).toMatchObject({
      specifier: "./register",
      kind: "side-effect",
      typeOnly: false,
    });
  });

  it("reads a re-export, typed or not", () => {
    expect(one(`export { a } from "./a";`)).toMatchObject({
      kind: "re-export",
      typeOnly: false,
    });
    expect(one(`export * from "./a";`).typeOnly).toBe(false);
    expect(one(`export * as a from "./a";`).typeOnly).toBe(false);
    expect(one(`export type { A } from "./a";`).typeOnly).toBe(true);
    expect(one(`export { type A } from "./a";`).typeOnly).toBe(true);
    expect(moduleImports(`export { a };\nexport const b = 1;`)).toEqual([]);
  });

  it("reads a dynamic import, which is never type-only", () => {
    expect(one(`const m = await import("react");`)).toMatchObject({
      specifier: "react",
      kind: "dynamic",
      typeOnly: false,
      built: false,
    });
    expect(one("import(`./plain`)").specifier).toBe("./plain");
  });

  it("reads require, as a call and as an import", () => {
    expect(one(`const m = require("react");`)).toMatchObject({
      specifier: "react",
      kind: "require",
      typeOnly: false,
    });
    expect(one(`import m = require("react");`)).toMatchObject({
      specifier: "react",
      kind: "static",
      typeOnly: false,
    });
    expect(one(`import type m = require("react");`).typeOnly).toBe(true);
    expect(moduleImports(`this.require("react");`)).toEqual([]);
  });

  it("reads a type written as an import", () => {
    expect(one(`let n: typeof import("react");`)).toMatchObject({
      specifier: "react",
      kind: "import-type",
      typeOnly: true,
    });
  });

  it("marks a name built at run time", () => {
    expect(one("await import(`./${name}`);")).toMatchObject({
      specifier: "`./${name}`",
      kind: "dynamic",
      built: true,
    });
    expect(one(`require(path);`)).toMatchObject({
      kind: "require",
      built: true,
    });
  });

  it("ignores imports inside comments and strings", () => {
    expect(
      moduleImports(
        [
          `// import { a } from "./a";`,
          `/* import("react") */`,
          `const s = 'from "x"';`,
          'const t = `import "y"`;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("reads an import inside JSX", () => {
    expect(
      moduleImports(
        `import { a } from "./a";\nconst e = <div>{import("./b")}</div>;`,
      ).map((found) => found.specifier),
    ).toEqual(["./a", "./b"]);
  });

  it("reads both calls of a conditional", () => {
    expect(
      moduleImports(`const p = flag ? import("react") : import("./safe");`).map(
        (found) => found.specifier,
      ),
    ).toEqual(["react", "./safe"]);
    expect(
      moduleImports(`const m = flag ? require(a) : require("b");`).map(
        (found) => [found.specifier, found.built],
      ),
    ).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("ignores a template or a regular expression that only mentions one", () => {
    expect(
      moduleImports(
        [
          'const s = `import("react")`;',
          'const t = `a ${b} import x from "y"`;',
          'const r = /import("z")|[`"]/;',
          "const u = n / 2; // import('w')",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("reads an import inside a template's code", () => {
    expect(
      moduleImports(
        'const s = `${await import("./c")} and ${f({ a: 1 })}`; import("./d");',
      ).map((found) => found.specifier),
    ).toEqual(["./c", "./d"]);
  });

  it("skips a method that shares a call's name, and the // in a URL", () => {
    expect(
      moduleImports(
        [
          `class R { private require(id: string): T {} }`,
          `const u = "https://x.test"; import("./c");`,
        ].join("\n"),
      ).map((found) => found.specifier),
    ).toEqual(["./c"]);
  });
});
