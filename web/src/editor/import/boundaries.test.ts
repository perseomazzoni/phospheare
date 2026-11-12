// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { moduleImports } from "../../testing/moduleImports.fixture";

// ── The import's layers ──────────────────────────────────────────────────────
//
// The same gate as `editor/export/boundaries.test.ts`, stricter because this
// hexagon reads files from anywhere. The layers:
//
//   domain        pure — the general internal structure, the plan, the draft,
//                 formats, limits, sniffing, numbers and patterns
//   ports         the domain's types only
//   application   reading, preparing, detecting, editing, drafting — domain
//                 and ports, nothing else
//   adapters      the readers, zip, xml, decoding — may reach the engine's
//                 codec, never the project or storage
//   host          the one layer that knows the project; it wires, never draws
//   presentation  the window — the kit, the domain and the application's types
//
// Two rules beyond the export's. Nothing in the hexagon builds markup from
// strings (`innerHTML` and its kin), because every byte read is untrusted and
// an imported `<img onerror>` must stay text. Nothing reaches the network or
// starts a worker: an import reads the writer's file and nothing else.

// A module is reached by `from "…"`, by `import("…")`, by `require("…")` or
// by a side-effect import, and the readers are loaded by `import()`, so every
// rule reads them all through `moduleImports` and matches the whole specifier.
const host = (name: string) => new RegExp(`^(?:.*\\/)?${name}(?:\\/.*)?$`);
const layer = (...names: string[]) =>
  new RegExp(`^(?:\\.\\.?\\/)+(?:${names.join("|")})(?:\\/.*)?$`);

const REACT = /^(?:react(?:-dom)?(?:\/.*)?|react-i18next)$/;
const I18N = /^i18next$/;

/** String-to-markup sinks and the network, banned in every layer. */
const UNSAFE = [
  /\.innerHTML\b/,
  /\.outerHTML\b/,
  /\binsertAdjacentHTML\b/,
  /\bdocument\.write\b/,
  /\bcreateContextualFragment\b/,
  /\bdangerouslySetInnerHTML\b/,
  /\bnew\s+Worker\b/,
  /\bXMLHttpRequest\b/,
  /\bfetch\s*\(/,
  /\beval\s*\(/,
  /\bnew\s+Function\b/,
];

const raw = (files: Record<string, string>) =>
  Object.entries(files).filter(
    ([path]) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"),
  );

const DOMAIN = import.meta.glob("./domain/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const PORTS = import.meta.glob("./ports/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const APPLICATION = import.meta.glob("./application/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const ADAPTERS = import.meta.glob("./adapters/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const HOST = import.meta.glob("./host/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const PRESENTATION = import.meta.glob("./presentation/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const ROOT = import.meta.glob("./*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const CORE_FORBIDDEN = [
  host("(?:project|profile)"),
  host("storage"),
  host("auth"),
  host("webapp"),
  host("engine"),
  layer("components", "tree", "reference"),
  host("(?:ai|assistant)"),
  layer("adapters", "host", "presentation"),
  REACT,
  I18N,
];
const DOMAIN_FORBIDDEN = layer("application", "ports");
const PORTS_FORBIDDEN = layer("application");
const ADAPTER_FORBIDDEN = [
  host("(?:project|profile)"),
  host("storage"),
  host("auth"),
  host("webapp"),
  layer("host", "presentation", "application"),
  REACT,
  I18N,
];
const HOST_FORBIDDEN = [layer("presentation"), REACT];
const PRESENTATION_FORBIDDEN = [
  host("(?:project|profile)"),
  host("storage"),
  host("auth"),
  host("engine"),
  host("webapp"),
  layer("adapters", "host"),
];

/** Each import in `files` whose module one of `patterns` names. */
const offenders = (files: Record<string, string>, patterns: RegExp[]) =>
  raw(files).flatMap(([path, source]) =>
    moduleImports(source)
      .filter(({ specifier }) => patterns.some((p) => p.test(specifier)))
      .map(({ specifier, line }) => `${path}:${line} imports ${specifier}`),
  );
const reaches = (source: string, ...patterns: RegExp[]) =>
  offenders({ "sample.ts": source }, patterns).length > 0;

/** Each file in `files` whose code one of `patterns` matches. */
const unsafe = (files: Record<string, string>, patterns: RegExp[]) =>
  raw(files)
    .filter(([, source]) => patterns.some((pattern) => pattern.test(source)))
    .map(([path]) => path);

describe("the import's hexagonal boundary", () => {
  it("can tell an outward import from an inward one", () => {
    expect(reaches(`import { x } from "../ports";`, DOMAIN_FORBIDDEN)).toBe(
      true,
    );
    expect(
      reaches(`import { x } from "../../application/detect";`, PORTS_FORBIDDEN),
    ).toBe(true);
    expect(
      reaches(`import { x } from "../adapters/readers";`, CORE_FORBIDDEN[7]),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "../../../project/naming";`,
        host("(?:project|profile)"),
      ),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "../../../webapp/library/destinations";`,
        host("webapp"),
      ),
    ).toBe(true);
    expect(
      reaches(`import { x } from "../host/seed";`, PRESENTATION_FORBIDDEN[5]),
    ).toBe(true);
    expect(
      reaches(
        `import type { SourceBlock } from "../domain/source";`,
        DOMAIN_FORBIDDEN,
      ),
    ).toBe(false);
    expect(
      reaches(
        `import { x } from "./projectRules";`,
        host("(?:project|profile)"),
      ),
    ).toBe(false);
    expect(`el.innerHTML = text;`).toMatch(UNSAFE[0]);
    expect(`await fetch(url)`).toMatch(UNSAFE[8]);
    expect(`new Worker(url)`).toMatch(UNSAFE[6]);
    expect(`const fetched = 1;`).not.toMatch(UNSAFE[8]);
  });

  it("finds every layer's files, so no rule passes over an empty glob", () => {
    for (const files of [
      DOMAIN,
      PORTS,
      APPLICATION,
      ADAPTERS,
      HOST,
      PRESENTATION,
    ])
      expect(raw(files).length).toBeGreaterThan(0);
  });

  it("keeps the core free of the project, storage, the engine, React and i18n", () => {
    expect(
      offenders({ ...DOMAIN, ...PORTS, ...APPLICATION }, CORE_FORBIDDEN),
    ).toEqual([]);
  });

  it("keeps the inner order: the domain imports nothing outward, ports only the domain", () => {
    expect(offenders(DOMAIN, [DOMAIN_FORBIDDEN])).toEqual([]);
    expect(offenders(PORTS, [PORTS_FORBIDDEN])).toEqual([]);
  });

  it("keeps the adapters from reaching sideways into the project or storage", () => {
    expect(offenders(ADAPTERS, ADAPTER_FORBIDDEN)).toEqual([]);
  });

  it("keeps the host from drawing", () => {
    expect(offenders(HOST, HOST_FORBIDDEN)).toEqual([]);
  });

  it("keeps the window on the kit and the core, never the host or the web app", () => {
    expect(offenders(PRESENTATION, PRESENTATION_FORBIDDEN)).toEqual([]);
  });

  it("builds no markup from strings and reaches no network, anywhere", () => {
    expect(
      unsafe(
        {
          ...DOMAIN,
          ...PORTS,
          ...APPLICATION,
          ...ADAPTERS,
          ...HOST,
          ...PRESENTATION,
          ...ROOT,
        },
        UNSAFE,
      ),
    ).toEqual([]);
  });
});

// ── The gate's own reach ─────────────────────────────────────────────────────

describe("the boundary's own reach", () => {
  it("sees a dynamic import(), a require and a side-effect import as well as a static one", () => {
    // The readers are loaded by `import()` in `adapters/readers/index.ts`,
    // so a layer can reach outward that way too, and the gate sees it.
    expect(
      reaches(
        `const m = await import("../../../project/naming");`,
        host("(?:project|profile)"),
      ),
    ).toBe(true);
    expect(
      reaches(
        `const m = await import("../host/seed");`,
        PRESENTATION_FORBIDDEN[5],
      ),
    ).toBe(true);
    expect(reaches(`const m = require("react-dom");`, ...HOST_FORBIDDEN)).toBe(
      true,
    );
    expect(
      reaches(`import "../../../storage/register";`, ...CORE_FORBIDDEN),
    ).toBe(true);
    expect(
      reaches(
        `// import { x } from "../host/seed";`,
        PRESENTATION_FORBIDDEN[5],
      ),
    ).toBe(false);
  });
});
