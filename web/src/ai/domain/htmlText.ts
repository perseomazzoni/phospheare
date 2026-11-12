// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A search engine's HTML fragment as plain text: tags out first, entities
// second, so `&lt;b&gt;` stays the text "<b>" and never becomes a tag. Pure
// string work: the page runs under Trusted Types, so parsing into a DOM node
// is not an option, and nothing here ever renders markup.
//
// The named entities are the few an engine's escaper writes, plus the
// punctuation an excerpt commonly carries. A name outside the table stays as
// written, as an unknown entity does in HTML. What a decode can produce
// (controls, bidi overrides) is removed afterwards by
// `normalizeSearchResults`, never here.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201A",
  ldquo: "\u201C",
  rdquo: "\u201D",
  bdquo: "\u201E",
  laquo: "\u00AB",
  raquo: "\u00BB",
  middot: "\u00B7",
  bull: "\u2022",
  deg: "\u00B0",
  times: "\u00D7",
  minus: "\u2212",
  copy: "\u00A9",
  reg: "\u00AE",
  trade: "\u2122",
  sect: "\u00A7",
  para: "\u00B6",
  shy: "\u00AD",
};

/** A Unicode scalar value an entity may spell; anything else stays as written. */
function scalar(code: number): string | null {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

/** Entities decoded, the way an HTML5 decoder reads ones ending in `;`. */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#[xX]([0-9a-fA-F]{1,8})|#([0-9]{1,9})|([A-Za-z][A-Za-z0-9]{1,31}));/g,
    (
      whole,
      hex: string | undefined,
      decimal: string | undefined,
      name: string | undefined,
    ) => {
      if (hex !== undefined) return scalar(parseInt(hex, 16)) ?? whole;
      if (decimal !== undefined) return scalar(parseInt(decimal, 10)) ?? whole;
      if (
        name !== undefined &&
        Object.prototype.hasOwnProperty.call(NAMED, name)
      )
        return NAMED[name] ?? whole;
      return whole;
    },
  );
}

/**
 * Markup removed: comments, then anything shaped like a tag. A `<` not
 * followed by a letter, `/`, `!` or `?` is text, as in "a < b".
 */
export function stripTags(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<[A-Za-z/!?][^>]*(?:>|$)/g, "");
}

/** An HTML fragment as text, or the empty string for anything not a string. */
export function htmlToText(html: unknown): string {
  return typeof html === "string" ? decodeEntities(stripTags(html)) : "";
}
