// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Reads imports with patterns rather than a parser: the SPA's TypeScript 7
// package has no compiler API, and the app writes its imports in the plain
// forms below. A first pass blanks the comments and marks the text inside
// strings, so neither can pass for an import. The code inside a template's
// `${…}` stays code.

/**
 * How a module is named:
 *
 * - `static`: `import … from "m"` and `import x = require("m")`;
 * - `side-effect`: `import "m"`;
 * - `re-export`: `export … from "m"`;
 * - `dynamic`: an `import("m")` call;
 * - `require`: a `require("m")` call;
 * - `import-type`: a type written as `typeof import("m")`.
 */
export type ImportKind =
  | "static"
  | "side-effect"
  | "re-export"
  | "dynamic"
  | "require"
  | "import-type";

export interface ModuleImport {
  /**
   * The module as written. For a call whose argument is not a literal, the
   * argument's source text, with `built` set.
   */
  specifier: string;
  kind: ImportKind;
  /**
   * Whether the line names types alone: `import type`, `export type … from`,
   * an import or re-export whose every named binding is `type`-qualified,
   * and `typeof import("m")`. A call never is. Under
   * `verbatimModuleSyntax`, `import { type T } from "m"` still compiles to
   * `import {} from "m"`, so the module loads although no value is taken.
   */
  typeOnly: boolean;
  /** Whether the name is computed at run time, so no rule can read it. */
  built: boolean;
  /** One-based line of the statement or call. */
  line: number;
}

const NAME = String.raw`[\w$]+`;
/** A quoted name, whose quote is capture group `group`. */
const quoted = (group: number) =>
  String.raw`(["'])([^"'\n]*)` + "\\" + String(group);
const STATIC = new RegExp(
  String.raw`^[ \t]*import\s+(type\s+)?((?:${NAME}\s*,\s*)?(?:\*\s*as\s+${NAME}|\{[^}]*\})|${NAME})\s*from\s*` +
    quoted(3),
  "gm",
);
const REQUIRE_IMPORT = new RegExp(
  String.raw`^[ \t]*import\s+(type\s+)?${NAME}\s*=\s*require\(\s*` + quoted(2),
  "gm",
);
const SIDE_EFFECT = new RegExp(String.raw`^[ \t]*import\s*` + quoted(1), "gm");
const RE_EXPORT = new RegExp(
  String.raw`^[ \t]*export\s+(type\s+)?(\*(?:\s*as\s+${NAME})?|\{[^}]*\})\s*from\s*` +
    quoted(3),
  "gm",
);
// `this.require(…)` is a method call, never a module.
const CALL = (word: string, notAfter = "") =>
  new RegExp(
    String.raw`(?<![\w$.])${notAfter}${word}\s*\(\s*([^)]*?)\s*\)`,
    "g",
  );
const DYNAMIC = CALL("import");
const REQUIRE = CALL(
  "require",
  String.raw`(?<!\bimport\s+(?:type\s+)?${NAME}\s*=\s*)`,
);
// A method of that name being declared, `private require(id: string): T {`:
// first in its line or after a brace or semicolon, but for modifiers, and a
// body or return type after it. In a conditional, a call follows `?` or `:`.
const MODIFIERS =
  /(?:^|[\n{};])[ \t]*(?:(?:public|private|protected|static|async|override)\s+)*$/;
const DECLARED = /^\s*[:{]/;

/**
 * Every module a source names, in source order. Text inside a comment or a
 * string is never one.
 */
export function moduleImports(source: string): ModuleImport[] {
  const { code, inString } = scan(source);
  const found: (ModuleImport & { at: number })[] = [];
  const lineOf = (at: number) => code.slice(0, at).split("\n").length;
  const add = (
    at: number,
    specifier: string,
    kind: ImportKind,
    typeOnly: boolean,
    built = false,
  ) => {
    if (!inString[at])
      found.push({ at, specifier, kind, typeOnly, built, line: lineOf(at) });
  };
  // A statement pattern starts at its line's indent; the keyword is where
  // the statement is.
  const keyword = (m: RegExpExecArray) => m.index + m[0].search(/\S/);
  const call = (m: RegExpExecArray) => {
    const name = literal(m[1]);
    const declared =
      name === null &&
      MODIFIERS.test(code.slice(0, m.index)) &&
      DECLARED.test(code.slice(m.index + m[0].length));
    return declared ? undefined : { name, built: name === null };
  };

  for (const m of code.matchAll(STATIC))
    add(keyword(m), m[4], "static", !!m[1] || allTyped(m[2]));
  for (const m of code.matchAll(REQUIRE_IMPORT))
    add(keyword(m), m[3], "static", !!m[1]);
  for (const m of code.matchAll(SIDE_EFFECT))
    add(keyword(m), m[2], "side-effect", false);
  for (const m of code.matchAll(RE_EXPORT))
    add(keyword(m), m[4], "re-export", !!m[1] || allTyped(m[2]));
  for (const m of code.matchAll(DYNAMIC)) {
    const hit = call(m);
    if (!hit) continue;
    const typed = /\btypeof\s*$/.test(code.slice(0, m.index));
    add(
      m.index,
      hit.name ?? m[1],
      typed ? "import-type" : "dynamic",
      typed,
      hit.built,
    );
  }
  for (const m of code.matchAll(REQUIRE)) {
    const hit = call(m);
    if (hit) add(m.index, hit.name ?? m[1], "require", false, hit.built);
  }

  return found
    .sort((a, b) => a.at - b.at)
    .map(({ at: _at, ...entry }) => entry);
}

/** The specifiers of `moduleImports`, for a rule that reads names alone. */
export const importedModules = (source: string) =>
  moduleImports(source).map((found) => found.specifier);

/** A braced list whose every name is `type`-qualified, and not empty. */
function allTyped(clause: string): boolean {
  const braced = /^\{([^}]*)\}$/.exec(clause.trim());
  if (!braced) return false;
  const names = braced[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((name) => /^type\s/.test(name));
}

/** A call's argument as a plain string, or null when it is built. */
function literal(argument: string): string | null {
  return (
    /^(["'])([^"'\n]*)\1$/.exec(argument)?.[2] ??
    /^`([^`$]*)`$/.exec(argument)?.[1] ??
    null
  );
}

// What may stand before a regular expression, read from the code's last few
// characters. `<` is left out: in JSX it opens a closing tag, `</div>`.
const REGEX_MAY_START = /(?:^|[(,=:[!&|?{};+\-*%>~^]|\breturn|\btypeof)\s*$/;

/**
 * The source with every comment turned to spaces, newlines kept, so offsets
 * and line numbers still match, and a mark on each character inside a
 * string. The `//` in a URL is not a comment, and a template's `${…}` is code
 * again until its closing brace.
 */
function scan(source: string): { code: string; inString: Uint8Array } {
  let code = "";
  const inString = new Uint8Array(source.length);
  // One entry per open brace in code inside a template: "`" for the brace
  // that returns to the template, "{" for any other.
  const braces: string[] = [];
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (quote !== null) {
      if (char === quote || (char === "\n" && quote !== "`")) {
        quote = null;
      } else if (quote === "`" && char === "$" && next === "{") {
        braces.push("`");
        quote = null;
        code += char + next;
        i++;
        continue;
      } else {
        inString[i] = 1;
        if (char === "\\" && i + 1 < source.length) {
          code += char;
          inString[++i] = 1;
          code += source[i];
          continue;
        }
      }
      code += char;
      continue;
    }
    if (char === "/" && (next === "/" || next === "*")) {
      const end =
        next === "/" ? source.indexOf("\n", i) : source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : next === "/" ? end : end + 2;
      code += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
      continue;
    }
    // A regular expression, where an operand may start: its quotes and
    // backticks open no string. A slash after a value is a division.
    if (char === "/" && REGEX_MAY_START.test(code.slice(-32))) {
      let j = i + 1;
      for (let inClass = false; j < source.length && source[j] !== "\n"; j++) {
        if (source[j] === "\\") j++;
        else if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        else if (source[j] === "/" && !inClass) break;
      }
      if (source[j] === "/") {
        inString.fill(1, i + 1, j);
        code += source.slice(i, j + 1);
        i = j;
        continue;
      }
    }
    if (braces.length > 0 && char === "{") braces.push("{");
    else if (braces.length > 0 && char === "}" && braces.pop() === "`")
      quote = "`";
    else if (char === '"' || char === "'" || char === "`") quote = char;
    code += char;
  }
  return { code, inString };
}
