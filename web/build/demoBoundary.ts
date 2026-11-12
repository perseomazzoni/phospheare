// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What the demo site's bundle must not contain, and the checks that find it.
// The demo site serves the landing and the demo editor only; the rest of the
// program is absent from its files, not switched off. The build gate in
// `vite.config.ts` runs both checks on every `build:demo` and fails the build
// on any finding.
//
// Build tooling: only `vite.config.ts` imports it, so it is in no bundle and
// the program never reads it.
//
// Pure: module ids and emitted text in, findings out. Do not widen a prefix
// to silence a finding; cut the import that brought the module in.

/**
 * Source prefixes under `web/src/`, posix-separated. A prefix without a
 * trailing slash covers every file whose path starts with it, so
 * `storage/drive` covers `driveGrant.ts` and `driveRest.ts`.
 */
export const FORBIDDEN_SOURCES: readonly string[] = [
  "auth/",
  "platform/",
  "writers/",
  "project/sync/",
  "profile/",
  "webapp/library/",
  "projectSetup/",
  "webapp/shell/",
  "webapp/ai/",
  "ai/host/",
  "webapp/entry/LoginSplash",
  "webapp/entry/loginSpark",
  "webapp/entry/landing/accountEntry",
  "storage/cache/",
  "storage/drive",
  "storage/local",
  "storage/handleStore",
  "storage/mockDrive",
  "storage/connections",
  "storage/mirrored",
  "storage/useDriveConnection",
  "storage/useLocalConnection",
  "ai/adapters/ollama",
  "ai/adapters/openrouter",
  "ai/adapters/routingProvider",
  "ai/adapters/directSearch",
  "ai/adapters/directWire",
  "ai/adapters/scripted",
  "ai/AiSettingsPane",
  "editor/export/",
  "editor/import/",
  "editor/ProjectRoute",
  "editor/useProjectRef",
  "editor/useProjectStore",
  "editor/services/account",
];

/** npm packages that only the stripped features use. */
export const FORBIDDEN_PACKAGES: readonly string[] = ["fflate", "pdfmake"];

/**
 * Text that names a host or a route the demo site does not have. Any of them
 * in an emitted file means stripped code or copy reached the bundle. Wikipedia
 * is matched by its search path, not its host: the kept Assistant names
 * Wikipedia hosts as labels for a source it shows.
 */
export const FORBIDDEN_MARKERS: readonly string[] = [
  "openrouter.ai",
  "googleapis.com",
  "accounts.google.com",
  "googleusercontent.com",
  "/w/rest.php",
  ":11434",
  "/identity/",
  "/app/project",
  "/app/settings",
];

/** One forbidden module, and the import chain from an entry down to it. */
export interface ModuleFinding {
  module: string;
  chain: string[];
}

/** One forbidden marker in one emitted file. */
export interface MarkerFinding {
  file: string;
  marker: string;
  excerpt: string;
}

/**
 * Names a module id the way the lists do: a `web/src/`-relative path without
 * its extension, or `npm:<package>` for a dependency. Another file under
 * `web/`, such as `index.html`, is named relative to `web/`. Ids outside all
 * three, such as Vite's virtual modules, come back as they are.
 *
 * @param srcRoot the absolute path of `web/src`, in any separator style.
 */
export function moduleName(id: string, srcRoot: string): string {
  const path = id.replace(/\\/g, "/").replace(/[?#].*$/, "");
  const pkg = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path);
  if (pkg) return `npm:${pkg[1]}`;
  const root = srcRoot.replace(/\\/g, "/").replace(/\/?$/, "/");
  if (path.toLowerCase().startsWith(root.toLowerCase()))
    return path.slice(root.length).replace(/\.[cm]?[jt]sx?$/, "");
  const web = root.replace(/[^/]+\/$/, "");
  if (path.toLowerCase().startsWith(web.toLowerCase()))
    return path.slice(web.length);
  return path;
}

/** Whether a name from `moduleName` is outside the demo's boundary. */
export function isForbidden(name: string): boolean {
  if (name.startsWith("npm:"))
    return FORBIDDEN_PACKAGES.includes(name.slice("npm:".length));
  return FORBIDDEN_SOURCES.some((prefix) => name.startsWith(prefix));
}

/**
 * The shortest import chain from an entry to `id`, entry first, found by
 * walking importers upward. A module no entry reaches gives `[id]`.
 */
export function importChain(
  id: string,
  importersOf: (id: string) => readonly string[],
  isEntry: (id: string) => boolean,
): string[] {
  const parent = new Map<string, string | null>([[id, null]]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift() as string;
    if (isEntry(current)) {
      const chain: string[] = [];
      for (
        let at: string | null = current;
        at !== null;
        at = parent.get(at) ?? null
      )
        chain.push(at);
      return chain;
    }
    for (const importer of importersOf(current)) {
      if (parent.has(importer)) continue;
      parent.set(importer, current);
      queue.push(importer);
    }
  }
  return [id];
}

/**
 * Every forbidden module among `ids`, each with its import chain, in names
 * from `moduleName`. One finding per module, sorted by name.
 */
export function findForbiddenModules(
  ids: Iterable<string>,
  srcRoot: string,
  importersOf: (id: string) => readonly string[],
  isEntry: (id: string) => boolean,
): ModuleFinding[] {
  const findings = new Map<string, ModuleFinding>();
  for (const id of ids) {
    const name = moduleName(id, srcRoot);
    if (!isForbidden(name) || findings.has(name)) continue;
    findings.set(name, {
      module: name,
      chain: importChain(id, importersOf, isEntry).map((link) =>
        moduleName(link, srcRoot),
      ),
    });
  }
  return [...findings.values()].sort((a, b) =>
    a.module.localeCompare(b.module),
  );
}

/** Characters of context on each side of a marker in a finding. */
const EXCERPT_REACH = 40;

/** Every forbidden marker in each emitted file, first occurrence per pair. */
export function findForbiddenMarkers(
  files: Iterable<readonly [file: string, text: string]>,
): MarkerFinding[] {
  const findings: MarkerFinding[] = [];
  for (const [file, text] of files) {
    for (const marker of FORBIDDEN_MARKERS) {
      const at = text.indexOf(marker);
      if (at < 0) continue;
      const excerpt = text
        .slice(
          Math.max(0, at - EXCERPT_REACH),
          at + marker.length + EXCERPT_REACH,
        )
        .replace(/\s+/g, " ");
      findings.push({ file, marker, excerpt });
    }
  }
  return findings;
}

/** The build error's text: every finding, one block per kind. */
export function describeFindings(
  modules: readonly ModuleFinding[],
  markers: readonly MarkerFinding[],
): string {
  const lines = [
    `The demo bundle contains ${modules.length} forbidden module(s) and ${markers.length} forbidden marker(s).`,
  ];
  if (modules.length) {
    lines.push("", "Modules (entry → … → module):");
    for (const finding of modules)
      lines.push(`  ${finding.module}`, `    ${finding.chain.join(" → ")}`);
  }
  if (markers.length) {
    lines.push("", "Markers:");
    for (const finding of markers)
      lines.push(
        `  ${finding.marker} in ${finding.file}: …${finding.excerpt}…`,
      );
  }
  return lines.join("\n");
}
