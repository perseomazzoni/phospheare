// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  WIKI_LANGUAGE,
  acceptableQuery,
  normalizeSearchResults,
  searchCost,
} from "./searchResults";
import { decodeEntities, htmlToText, stripTags } from "./htmlText";
import { QUERY_MAX } from "./webText";

// Pins the engine-side checks every search answer passes, in their
// order, and the HTML-to-text step that runs before them without a DOM.

const row = (overrides: Record<string, unknown> = {}) => ({
  url: "https://en.wikipedia.org/wiki/Rome",
  title: "Rome",
  excerpt: "Rome is the capital city of Italy.",
  ...overrides,
});

describe("normalizing an engine's rows", () => {
  it("keeps a well-formed row as it came", () => {
    expect(normalizeSearchResults([row()])).toEqual([row()]);
  });

  it("drops a row that is not three strings", () => {
    expect(
      normalizeSearchResults([
        null,
        "x",
        row({ title: 3 }),
        row({ excerpt: undefined }),
        row({ url: {} }),
      ]),
    ).toEqual([]);
    expect(normalizeSearchResults("rows")).toEqual([]);
  });

  it("takes invisible characters out of the text and collapses whitespace", () => {
    const [kept] = normalizeSearchResults([
      row({
        title: "Ro\u202Eme\u200B\u00A0 city",
        excerpt: "  a\n\tb\u2060c \uFE0F ",
      }),
    ]);
    expect(kept?.title).toBe("Ro me city");
    expect(kept?.excerpt).toBe("a b c");
  });

  it("drops a row whose excerpt has nothing visible", () => {
    expect(normalizeSearchResults([row({ excerpt: "\u200B \u2060" })])).toEqual(
      [],
    );
  });

  it("takes a lone surrogate out like any invisible", () => {
    const [kept] = normalizeSearchResults([row({ title: "Rome\uD800" })]);
    expect(kept?.title).toBe("Rome");
  });

  it("hands on the URL as the browser opens it", () => {
    const [kept] = normalizeSearchResults([
      row({ url: "https://@example.org/" }),
    ]);
    expect(kept?.url).toBe("https://example.org/");
  });

  it.each([
    "javascript:alert(1)",
    "ftp://example.org/x",
    "https://user:pass@example.org/",
    "https://exa mple.org/",
    "https://example.org/\\x",
    "https://exa\u200Bmple.org/",
    "https://example.org/\u202E",
    "/relative",
    "",
    `https://example.org/${"a".repeat(2_048)}`,
  ])("drops a row whose URL is %j, never cleans it", (url) => {
    expect(normalizeSearchResults([row({ url })])).toEqual([]);
  });

  it("removes duplicates by page, ignoring the fragment and the host's case", () => {
    const kept = normalizeSearchResults([
      row(),
      row({ url: "HTTPS://EN.Wikipedia.org/wiki/Rome#History" }),
      row({ url: "https://en.wikipedia.org/wiki/rome" }),
    ]);
    expect(kept.map((one) => one.url)).toEqual([
      "https://en.wikipedia.org/wiki/Rome",
      "https://en.wikipedia.org/wiki/rome",
    ]);
  });

  it("pins the rows to one host when asked", () => {
    const kept = normalizeSearchResults(
      [row(), row({ url: "https://evil.example/wiki/Rome" })],
      { host: "en.wikipedia.org" },
    );
    expect(kept.map((one) => one.url)).toEqual([
      "https://en.wikipedia.org/wiki/Rome",
    ]);
  });

  it("clips by code points at the last space near the cap", () => {
    const words = `${"word ".repeat(70)}end`;
    const [kept] = normalizeSearchResults([
      row({ title: words, excerpt: "\u{1F600}".repeat(2_100) }),
    ]);
    expect(Array.from(kept?.title ?? "").length).toBeLessThanOrEqual(300);
    expect(kept?.title.endsWith("word")).toBe(true);
    expect(Array.from(kept?.excerpt ?? "")).toHaveLength(2_000);
  });

  it("keeps at most five, in the engine's order", () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      row({ url: `https://example.org/${index}` }),
    );
    expect(normalizeSearchResults(rows).map((one) => one.url)).toEqual(
      [0, 1, 2, 3, 4].map((index) => `https://example.org/${index}`),
    );
  });
});

describe("a reported cost", () => {
  it("is kept only as a finite number at least zero", () => {
    expect(searchCost(0)).toBe(0);
    expect(searchCost(0.004)).toBe(0.004);
    for (const value of [-1, Infinity, Number.NaN, "0.01", null, undefined])
      expect(searchCost(value)).toBeUndefined();
  });
});

describe("a query that may leave", () => {
  it("is visible text of at most the cap", () => {
    expect(acceptableQuery("fondazione di Roma")).toBe(true);
    expect(acceptableQuery("\u{1D400}".repeat(QUERY_MAX))).toBe(true);
    expect(acceptableQuery("x".repeat(QUERY_MAX + 1))).toBe(false);
    expect(acceptableQuery("")).toBe(false);
  });

  it.each(["a\nb", "a\u200Bb", "a\uFE0Fb", "a\u202Eb", "a\uD800b", "a\u0000b"])(
    "refuses %j",
    (query) => {
      expect(acceptableQuery(query)).toBe(false);
    },
  );
});

describe("a Wikipedia language code", () => {
  it("is a primary subtag and up to two more, with no dot", () => {
    for (const code of ["en", "it", "zh-min-nan", "be-tarask"])
      expect(WIKI_LANGUAGE.test(code)).toBe(true);
    for (const code of ["e", "EN", "en.evil", "en-", "a-b-c-d", "en\n"])
      expect(WIKI_LANGUAGE.test(code)).toBe(false);
  });
});

describe("HTML to text without a DOM", () => {
  it("removes the search's highlight markup and decodes its escapes", () => {
    expect(
      htmlToText(
        'Disambiguazione – &quot;<span class="searchmatch">Manzoni</span>&quot; rimanda qui &#039;x&#039;',
      ),
    ).toBe("Disambiguazione – \"Manzoni\" rimanda qui 'x'");
  });

  it("strips tags before decoding, so an escaped tag stays text", () => {
    expect(htmlToText("&lt;b&gt;bold&lt;/b&gt;")).toBe("<b>bold</b>");
    expect(htmlToText("<b>bold</b><!-- note -->")).toBe("bold");
  });

  it("keeps a bare less-than sign as text", () => {
    expect(stripTags("a < b and c<d")).toBe("a < b and c");
    expect(stripTags("3 <= 4")).toBe("3 <= 4");
  });

  it("decodes numeric entities, and leaves impossible ones as written", () => {
    expect(decodeEntities("&#x2014;&#8212;&#X1F600;")).toBe("——\u{1F600}");
    expect(decodeEntities("&#0;&#xD800;&#x110000;")).toBe(
      "&#0;&#xD800;&#x110000;",
    );
  });

  it("decodes a known name, and leaves an unknown one or one with no semicolon", () => {
    expect(decodeEntities("&amp;&nbsp;&hellip;")).toBe("&\u00A0…");
    expect(decodeEntities("&bogus; &amp &constructor;")).toBe(
      "&bogus; &amp &constructor;",
    );
  });

  it("decodes a bidi override, which the row check then removes", () => {
    const [kept] = normalizeSearchResults([
      row({ title: htmlToText("a&#x202E;b") }),
    ]);
    expect(kept?.title).toBe("a b");
  });

  it("is the empty string for anything but a string", () => {
    expect(htmlToText(undefined)).toBe("");
    expect(htmlToText({ html: "x" })).toBe("");
  });
});
