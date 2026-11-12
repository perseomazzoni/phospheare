// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
// Not `it`: vitest owns that name here.
import italian from "../../locales/it.json";
import { NOTICE, PRIVACY, TERMS, type LegalDocument } from "./documents";
import { SITE_NOTICE, SITE_PRIVACY } from "./siteDocuments";
import { LEGAL_SET } from "../compose";
import { LEGAL_SET as SITE_SET } from "../compose.demo";
import { LEGAL, legalVariables } from "./facts";
import { interpolation } from "../../locales/i18nOptions";

// The texts' structure against the locale files: every key a document names
// has words in both languages, and every variable a string asks for is a fact
// the page supplies. Both builds' sets are checked: the full program's and
// the demo site's.

function read(root: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      root,
    );
}

/** Every key a document's renderer asks for. */
function keysOf(document: LegalDocument): string[] {
  const base = `legal.${document.text}`;
  const keys = [`${base}.title`, `${base}.lede`];
  if (document.closing) keys.push(`${base}.closing`);
  for (const section of document.sections) {
    const at = `${base}.${section.id}`;
    keys.push(`${at}.title`);
    for (const block of section.blocks) {
      const where = `${at}.${block.key}`;
      if (block.kind === "text") keys.push(where);
      if (block.kind === "list")
        keys.push(...block.items.map((item) => `${where}.${item}`));
      if (block.kind === "table") {
        keys.push(...block.columns.map((c) => `${where}.columns.${c}`));
        for (const row of block.rows)
          keys.push(...block.columns.map((c) => `${where}.rows.${row}.${c}`));
      }
    }
  }
  return keys;
}

const ALL = [NOTICE, PRIVACY, TERMS, SITE_NOTICE, SITE_PRIVACY].flatMap(keysOf);

describe("the legal sets", () => {
  it("serve the full program's three texts, and the demo site's notice and privacy notice only", () => {
    expect(LEGAL_SET).toEqual([NOTICE, PRIVACY, TERMS]);
    expect(SITE_SET.map((document) => document.id)).toEqual([
      "notice",
      "privacy",
    ]);
    expect(SITE_SET).toEqual([SITE_NOTICE, SITE_PRIVACY]);
  });
});

describe("the legal texts", () => {
  it("have words for every key, in both languages", () => {
    const missing = ALL.flatMap((key) =>
      [
        typeof read(en, key) === "string" ? null : `en ${key}`,
        typeof read(italian, key) === "string" ? null : `it ${key}`,
      ].filter((x) => x !== null),
    );
    expect(missing).toEqual([]);
  });

  it("ask only for variables the page supplies", () => {
    const supplied = new Set([
      ...Object.keys(legalVariables("en")),
      ...Object.keys(interpolation.defaultVariables),
    ]);
    const unknown = ALL.flatMap((key) =>
      [read(en, key), read(italian, key)].flatMap((text) =>
        [...String(text).matchAll(/\{\{(\w+)/g)]
          .map((match) => match[1])
          .filter((name) => !supplied.has(name))
          .map((name) => `${key}: ${name}`),
      ),
    );
    expect(unknown).toEqual([]);
  });

  it("set a filled date in the reader's language and show a placeholder as written", () => {
    const vars = legalVariables("it");
    if (/^\d{4}-\d{2}-\d{2}$/.test(LEGAL.updated))
      expect(vars.updated).not.toBe(LEGAL.updated);
    else expect(vars.updated).toBe(LEGAL.updated);
  });
});
