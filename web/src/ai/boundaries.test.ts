// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { moduleImports } from "../testing/moduleImports.fixture";

// Every form that loads a module counts: an import, a re-export, a dynamic
// `import("…")`, a bare side-effect `import "…"` and `require("…")`, as
// `moduleImports` finds them. The patterns below match a module's specifier
// whole.

// A host directory, imported bare (`"../../storage"`) or by a subpath
// (`"../../storage/types"`). Each of `storage/`, `editor/` and `webapp/`
// has an `index.ts`, so the bare form is a real import of the host, and a
// pattern that demands a trailing slash lets it through. The
// name must be a whole path segment, so an AI-local `"./storageKeys"` stays
// legal.
const host = (name: string) => new RegExp(`^(?:.*\\/)?${name}(?:\\/.*)?$`);

const CORE = import.meta.glob(
  ["./domain/**/*.ts", "./ports/**/*.ts", "./application/**/*.ts"],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;
const FORBIDDEN = [
  host("editor"),
  host("(?:project|profile)"),
  host("storage"),
  host("auth"),
  host("webapp"),
  host("adapters"),
  // `ai/host/` wires the AI to the account, the platform and the profile:
  // it is the outermost layer, and nothing inside the AI imports it.
  host("host"),
  /^react$/,
];
/** The network, which only the adapters reach. */
const FETCH = /\bfetch\s*\(/;

// The public entries and the settings pane (with its tests and its price
// format) do not reach into host implementations either: settings and the
// pane talk to AI-owned ports and shared UI primitives, never to the editor,
// the project layer or the storage port.
const PUBLIC = import.meta.glob(
  [
    "./index.ts",
    "./settings.ts",
    "./connectPath.ts",
    "./AiSettingsPane*.tsx",
    "./formatUsd*.ts",
  ],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;
const HOST_FORBIDDEN = [
  host("editor"),
  host("(?:project|profile)"),
  host("storage"),
  host("auth"),
];

// Adapters are the one layer allowed to `fetch`, which is why they sit
// outside `CORE`. They may not reach sideways into the host: an adapter that
// imports `auth/` to read a token, or `project/` to read a file, has become
// the application.
//
// The direct adapters read the writer's key through a thunk the composition
// root passes in (`ai/host/openrouterConnection.ts`), so none of them
// imports `auth/` or the platform to find one.
const ADAPTERS = import.meta.glob("./adapters/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const ADAPTER_FORBIDDEN = [
  host("auth"),
  host("(?:project|profile)"),
  host("editor"),
  host("storage"),
  host("webapp"),
  host("host"),
];

// The inner order of the hexagon. `CORE` treats domain, ports and
// application as one bucket, so it cannot see the domain importing the
// application. Domain imports nothing outward; ports import only the domain.
//
// Every file here imports a layer as a bare directory (`"../ports"`), so a
// pattern written as `ports\/` never matches and the gate passes vacuously.
// `layer()` matches the bare import, a subpath, and any depth of `../`, and
// the first test proves each one matches.
const layer = (...names: string[]) =>
  new RegExp(`^(?:\\.\\.?\\/)+(?:${names.join("|")})(?:\\/.*)?$`);
const DOMAIN = import.meta.glob("./domain/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const DOMAIN_FORBIDDEN = layer("application", "ports", "adapters");
const PORTS = import.meta.glob("./ports/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const PORTS_FORBIDDEN = layer("application", "adapters");

/** Each import in `files` whose module one of `patterns` names. */
const offenders = (files: Record<string, string>, patterns: RegExp[]) =>
  Object.entries(files).flatMap(([file, source]) =>
    moduleImports(source)
      .filter(({ specifier }) => patterns.some((p) => p.test(specifier)))
      .map(({ specifier, line }) => `${file}:${line} imports ${specifier}`),
  );
const reaches = (source: string, patterns: RegExp[]) =>
  offenders({ "sample.ts": source }, patterns).length > 0;

describe("AI hexagonal boundary", () => {
  it("can tell an outward import from an inward one", () => {
    for (const sample of [
      `import type { ModelProvider } from "../ports";`,
      `import { x } from "../ports/index";`,
      `import { y } from '../../application/tools';`,
      `import { z } from "../adapters";`,
      `const tools = await import("../application/tools");`,
      `import "../adapters/register";`,
      `const tools = require("../application/tools");`,
      `export { z } from "../adapters";`,
    ])
      expect(reaches(sample, [DOMAIN_FORBIDDEN]), sample).toBe(true);
    for (const sample of [
      `import { y } from "../application";`,
      `import { z } from "../../adapters/openrouterDirect";`,
    ])
      expect(reaches(sample, [PORTS_FORBIDDEN]), sample).toBe(true);

    expect(
      reaches(`import type { ModelRequest } from "../domain/types";`, [
        DOMAIN_FORBIDDEN,
      ]),
    ).toBe(false);
    expect(
      reaches(`import { ports } from "./portsOfCall";`, [DOMAIN_FORBIDDEN]),
    ).toBe(false);
    expect(
      reaches(`import type { ModelProvider } from "../ports";`, [
        PORTS_FORBIDDEN,
      ]),
    ).toBe(false);
  });

  it("keeps the domain free of every outer layer, and ports free of all but the domain", () => {
    expect(Object.keys(DOMAIN).length).toBeGreaterThan(0);
    expect(Object.keys(PORTS).length).toBeGreaterThan(0);
    expect(offenders(DOMAIN, [DOMAIN_FORBIDDEN])).toEqual([]);
    expect(offenders(PORTS, [PORTS_FORBIDDEN])).toEqual([]);
  });

  it("lets adapters fetch, and stops them reaching into the host", () => {
    expect(offenders(ADAPTERS, ADAPTER_FORBIDDEN)).toEqual([]);
  });

  it("keeps domain, ports and application independent from host implementations", () => {
    expect(offenders(CORE, FORBIDDEN)).toEqual([]);
    for (const [file, source] of Object.entries(CORE))
      expect(source, `${file} must not match ${FETCH}`).not.toMatch(FETCH);
  });

  // `storage/`, `editor/` and `webapp/` each have an `index.ts`, so
  // `"../../storage"` is a real import of the host, and a host pattern that
  // demands a trailing slash passes it vacuously.
  it("the host patterns catch a bare directory import", () => {
    const samples: [RegExp[], string][] = [
      [FORBIDDEN, `import { register } from "../../storage";`],
      [FORBIDDEN, `import { openEditor } from "../../editor";`],
      [ADAPTER_FORBIDDEN, `import { x } from "../../webapp";`],
      [HOST_FORBIDDEN, `import { y } from "../storage";`],
      // A dynamic import, a side-effect import and a require load the host
      // as surely.
      [FORBIDDEN, `const { register } = await import("../../storage");`],
      [FORBIDDEN, `import ( '../../editor/registry' )`],
      [ADAPTER_FORBIDDEN, `import "../../auth/session";`],
      [FORBIDDEN, `const { register } = require("../../storage");`],
      [FORBIDDEN, `const React = await import("react");`],
    ];
    for (const [patterns, sample] of samples)
      expect(reaches(sample, patterns), sample).toBe(true);
    // A whole path segment only: an AI-local name that merely starts with a
    // host's name stays legal.
    expect(reaches(`import { key } from "./storageKeys";`, FORBIDDEN)).toBe(
      false,
    );
  });

  it("keeps the public entries and the pane free of host implementations", () => {
    expect(offenders(PUBLIC, HOST_FORBIDDEN)).toEqual([]);
  });

  // A test may wire the pane to the real stores in `host/`, as the app's
  // composition does; the pane itself may not.
  it("keeps the public entries and the pane free of the AI's own host wiring", () => {
    const pane = Object.fromEntries(
      Object.entries(PUBLIC).filter(([file]) => !/\.test\.tsx?$/.test(file)),
    );
    expect(offenders(pane, [host("host")])).toEqual([]);
  });
});
