// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  EXCERPT_MAX,
  QUERY_MAX,
  TITLE_MAX,
  URL_MAX,
  WEB_QUOTE_MAX,
  WEB_QUOTE_MIN_WORDS,
  WEB_RESULTS_MAX,
  clipAt,
  normaliseQuery,
  plainLine,
  QUERY_MIN,
  quoteBounded,
  SITE_MAX,
  shownSite,
  siteOf,
  sendableQuery,
  usableQuery,
  webPageKey,
  webResultsOf,
  webUrl,
  wikiLanguage,
} from "./webText";

// ── Web text ─────────────────────────────────────────────────────────────────
//
// What the writer sees is what leaves, and what comes back is only what a
// click opens.

const points = (text: string) => Array.from(text).length;

describe("plainLine: one line of visible text", () => {
  it("turns line breaks, tabs and runs of spaces into one space", () => {
    expect(plainLine("  a\n\nb\tc   d \r\n")).toBe("a b c d");
  });

  it("removes the characters a card cannot show", () => {
    // Bidi override and isolate, zero-width space and joiner, BOM, soft
    // hyphen: `\p{Cc}\p{Cf}`.
    expect(plainLine("a‮b⁦c​d‍e﻿f­g")).toBe("a b c d e f g");
  });

  it.each([
    ["a variation selector", "️"],
    ["a supplementary variation selector", "\u{E0100}"],
    ["the Hangul filler", "ㅤ"],
    ["the Hangul choseong filler", "ᅟ"],
    ["the combining grapheme joiner", "͏"],
  ])(
    "removes %s, which renders as nothing and is neither Cc nor Cf",
    (_, invisible) => {
      expect(plainLine(`a${invisible}b`)).toBe("a b");
      expect(plainLine(`a${invisible}${invisible}${invisible}b`)).toBe("a b");
    },
  );
});

describe("plainLine and lone surrogates", () => {
  it("strips a lone surrogate, which no screen shows and JSON writes as six", () => {
    expect(plainLine("a\ud800b")).toBe("a b");
    expect(plainLine("\udc00x")).toBe("x");
    // A whole astral character is text, and stays.
    expect(plainLine("a\u{1F600}b")).toBe("a\u{1F600}b");
  });
});

describe("usableQuery", () => {
  it("is the normal form when it keeps two code points, else null", () => {
    expect(QUERY_MIN).toBe(2);
    expect(usableQuery("  Roman\n aqueducts ")).toBe("Roman aqueducts");
    expect(usableQuery("ab")).toBe("ab");
    expect(usableQuery(" a ")).toBeNull();
    expect(usableQuery("​")).toBeNull();
    // Two code points, one of them astral: counted as points, not units.
    expect(usableQuery("\u{1F600}a")).toBe("\u{1F600}a");
  });

  it("is idempotent, so a card's query passes its own check", () => {
    const query = usableQuery(" Porta  Pia\t1870 ") ?? "";
    expect(usableQuery(query)).toBe(query);
  });
});

describe("normaliseQuery", () => {
  it("is the visible line, composed", () => {
    // NFD "é" (e + combining acute) comes out as the one precomposed point:
    // the two render alike, so the choice between them is a hidden bit.
    expect(normaliseQuery("  café  au\nlait ")).toBe("café au lait");
  });

  it("is null for nothing visible", () => {
    expect(normaliseQuery("")).toBeNull();
    expect(normaliseQuery(" \n​️ ")).toBeNull();
  });

  it("clips at QUERY_MAX code points, at a space in the final tenth", () => {
    const words = `${"a".repeat(110)} ${"b".repeat(20)}`;
    expect(normaliseQuery(words)).toBe("a".repeat(110));
  });

  it("clips hard when no space is near the cap", () => {
    const long = `${"a".repeat(50)} ${"b".repeat(100)}`;
    const clipped = normaliseQuery(long);
    expect(clipped).toBe(`${"a".repeat(50)} ${"b".repeat(69)}`);
    expect(points(clipped ?? "")).toBe(QUERY_MAX);
  });

  it("counts code points, never UTF-16 units, so no character is split", () => {
    const astral = "\u{1D400}".repeat(125);
    const clipped = normaliseQuery(astral) ?? "";
    expect(points(clipped)).toBe(QUERY_MAX);
    expect(clipped).toBe("\u{1D400}".repeat(QUERY_MAX));
  });

  const hostile = [
    "a\nb",
    " a",
    "a​b",
    "a️b",
    "x".repeat(121),
    "",
    `${"a".repeat(119)} tail`,
    `${"a".repeat(119)}\u{1D400}${"b".repeat(5)}`,
    `${"a".repeat(60)} ${"b".repeat(70)}`,
    "café",
    "ㅤᅟ͏\u{E0100}word",
    "a   b   c",
  ];

  it.each(hostile)("is idempotent (%j)", (input) => {
    const once = normaliseQuery(input);
    expect(once === null ? null : normaliseQuery(once)).toBe(once);
  });

  it.each(hostile)(
    "returns only what the search routes accept (%j)",
    (input) => {
      // `SearchQueryRequest`: required, at most QUERY_MAX characters counted
      // by `mb_strlen`, and no `\p{Cc}\p{Cf}`. A value that fails it would be
      // a 422, which reads as a vendor's refusal; this makes it a red row.
      const query = normaliseQuery(input);
      if (query === null) return;
      expect(query.length).toBeGreaterThan(0);
      expect(points(query)).toBeLessThanOrEqual(QUERY_MAX);
      expect(query).not.toMatch(/[\p{Cc}\p{Cf}]/u);
      expect(query).toBe(query.trim());
    },
  );
});

describe("clipAt", () => {
  it("cuts at a space exactly at the start of the final tenth", () => {
    // max 10: the final tenth starts at index 9, and a space there counts.
    expect(clipAt(`${"a".repeat(9)} ${"b".repeat(5)}`, 10)).toBe("a".repeat(9));
  });

  it("leaves text within the cap alone", () => {
    expect(clipAt("short text", 20)).toBe("short text");
  });

  it("appends no marker, so the clip never becomes quotable text", () => {
    const clipped = clipAt(`${"word ".repeat(30)}`.trim(), 50);
    expect(clipped).not.toMatch(/…|\.\.\.$/);
    expect(points(clipped)).toBeLessThanOrEqual(50);
  });
});

describe("wikiLanguage", () => {
  it.each([
    ["it", "it"],
    ["IT", "it"],
    ["it-IT", "it"],
    ["zh_TW", "zh"],
    ["pt-BR", "pt"],
  ])("reads %j as %j", (code, expected) => {
    expect(wikiLanguage(code)).toBe(expected);
  });

  it.each([
    "evil.example/#",
    "en.evil",
    "../",
    "",
    "a".repeat(80),
    "en\n",
    "e",
    "1t",
    undefined,
  ])("falls back to en for %j", (code) => {
    expect(wikiLanguage(code)).toBe("en");
  });
});

describe("webUrl", () => {
  it("keeps an http(s) URL, as the browser will open it", () => {
    expect(webUrl("https://en.wikipedia.org/wiki/Rome")).toBe(
      "https://en.wikipedia.org/wiki/Rome",
    );
    expect(webUrl("http://Example.ORG/a?b=c#d")).toBe(
      "http://example.org/a?b=c#d",
    );
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,hi"],
    ["a relative path", "/wiki/Rome"],
    ["userinfo", "https://user@evil.example/"],
    ["a password", "https://user:pw@evil.example/"],
    // The WHATWG parser would read `\` as `/` and so open a host the check
    // never saw.
    ["a backslash", "https://good.example\\@evil.example/"],
    ["a tab the parser would strip", "https://good.exa\tmple/"],
    ["a newline", "https://good.example/\n"],
    ["a space", "https://good.example/a b"],
    ["a bidi override", "https://good.example/‮gpj.exe"],
    ["a zero-width space", "https://good.exa​mple/"],
    ["too long", `https://good.example/${"a".repeat(URL_MAX)}`],
    ["not a URL", "not a url"],
  ])("refuses %s rather than cleaning it", (_, raw) => {
    expect(webUrl(raw)).toBeNull();
  });

  it("accepts a URL exactly at the cap", () => {
    const base = "https://good.example/";
    const url = base + "a".repeat(URL_MAX - base.length);
    expect(webUrl(url)).toBe(url);
  });
});

describe("siteOf: the host a click opens", () => {
  it("is the URL's own host, with a leading www. dropped", () => {
    expect(siteOf("https://www.example.org/a")).toBe("example.org");
    expect(siteOf("https://en.wikipedia.org/wiki/X")).toBe("en.wikipedia.org");
  });

  it("keeps an IDN host in its xn-- form, where a homograph shows", () => {
    expect(siteOf("https://аpple.example/")).toBe("xn--pple-43d.example");
  });

  it("is null for a URL that does not pass", () => {
    expect(siteOf("javascript:alert(1)")).toBeNull();
    expect(siteOf("not a url")).toBeNull();
  });

  it("strips only www.", () => {
    expect(siteOf("https://www2.example.org/")).toBe("www2.example.org");
    expect(siteOf("https://m.example.org/")).toBe("m.example.org");
  });

  // The parser keeps `"`, `;` and `(` in a host and decodes `%3B` into one,
  // and each could close the replay line's quoting or forge an entry after
  // ` from `.
  it("is null for a host no row could name", () => {
    expect(siteOf('http://a"b;c(d).com/')).toBeNull();
    expect(siteOf("http://x.org%3B/")).toBeNull();
    expect(siteOf("http://[::1]/")).toBeNull();
  });

  it("is null for a host longer than DNS allows", () => {
    const label = "a".repeat(60);
    const long = [label, label, label, label, label, "org"].join(".");
    expect(long.length).toBeGreaterThan(SITE_MAX);
    expect(siteOf(`https://${long}/`)).toBeNull();
    const fits = [label, label, label, "org"].join(".");
    expect(siteOf(`https://${fits}/`)).toBe(fits);
  });

  // The charset rule's edges. A trailing dot is an empty label, which
  // `webUrl` keeps and no row could name; and the length rule holds at
  // `SITE_MAX`, a unit either side.
  it("is null for a trailing-dot host, and holds at exactly SITE_MAX", () => {
    expect(webUrl("https://example.org./")).not.toBeNull();
    expect(siteOf("https://example.org./")).toBeNull();
    const at = ["a", "b", "c"].map((one) => one.repeat(63)).join(".");
    const exact = `${at}.${"d".repeat(SITE_MAX - at.length - 1)}`;
    expect(exact).toHaveLength(SITE_MAX);
    expect(siteOf(`https://${exact}/`)).toBe(exact);
    expect(siteOf(`https://${exact}d/`)).toBeNull();
  });
});

describe("shownSite: a long host cut at whole labels only", () => {
  it("shows a host of 24 characters or fewer whole", () => {
    expect(shownSite("en.wikipedia.org")).toBe("en.wikipedia.org");
    expect(shownSite("a".repeat(20) + ".org")).toBe("a".repeat(20) + ".org");
  });

  it("drops whole leading labels, keeping the longest tail that fits 23", () => {
    expect(shownSite("aaaaaaaaaaaaaaaaaaaa.bbbb.evil.example")).toBe(
      "…bbbb.evil.example",
    );
    expect(shownSite("one.two.three.four.five.example.org")).toBe(
      "…four.five.example.org",
    );
  });

  it("keeps a registrable name under a two-label suffix whole", () => {
    expect(shownSite("averyveryverylongevilname.co.uk")).toBe(
      "averyveryverylongevilname.co.uk",
    );
  });

  it("never keeps fewer than the last three labels, and never cuts one", () => {
    const tail = "averyveryverylongname.example.org";
    expect(shownSite(`cdn.static.${tail}`)).toBe(`…${tail}`);
  });

  it("keeps a long xn-- label whole, its marker visible", () => {
    const idn = "xn--" + "a".repeat(30) + ".example";
    expect(shownSite(idn)).toBe(idn);
    expect(shownSite(`m.${idn}`)).toBe(`m.${idn}`);
  });

  // The budget's own edge, on a host with labels to spare: 24 characters is
  // shown whole, and one more is cut at a label.
  it("leaves a host exactly at the budget unchanged", () => {
    expect("one.two.four.example.org").toHaveLength(24);
    expect(shownSite("one.two.four.example.org")).toBe(
      "one.two.four.example.org",
    );
    expect(shownSite("one.two.three.example.org")).toBe(
      "…two.three.example.org",
    );
  });
});

describe("webPageKey", () => {
  it("is one page whatever its fragment", () => {
    expect(webPageKey("https://example.org/a#one")).toBe(
      webPageKey("https://example.org/a#two"),
    );
    expect(webPageKey("https://example.org/a#")).toBe(
      webPageKey("https://example.org/a"),
    );
  });

  it("keeps two pages apart", () => {
    expect(webPageKey("https://example.org/a")).not.toBe(
      webPageKey("https://example.org/b"),
    );
  });
});

describe("webResultsOf: the SPA's own check of a route's rows", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    url: "https://en.wikipedia.org/wiki/Rome",
    title: "Rome",
    excerpt: "Rome is the capital city of Italy.",
    ...over,
  });

  it("keeps a good row as plain text", () => {
    expect(
      webResultsOf([row({ title: "Ro‮me\n", excerpt: " a​b\tc " })]),
    ).toEqual([
      {
        url: "https://en.wikipedia.org/wiki/Rome",
        title: "Ro me",
        excerpt: "a b c",
      },
    ]);
  });

  it.each([null, undefined, "x", 1, {}, { results: [] }])(
    "reads a non-array (%j) as no rows",
    (rows) => {
      expect(webResultsOf(rows)).toEqual([]);
    },
  );

  it("drops rows that are not rows", () => {
    expect(
      webResultsOf([
        null,
        1,
        "s",
        [],
        { url: {} },
        row({ title: 3 }),
        row({ excerpt: null }),
        row({ url: "javascript:alert(1)" }),
      ]),
    ).toEqual([]);
  });

  it("drops a row whose excerpt is empty once made plain, and keeps an empty title", () => {
    expect(webResultsOf([row({ excerpt: " ​\n" })])).toEqual([]);
    expect(webResultsOf([row({ title: "" })])).toHaveLength(1);
  });

  it("clips title and excerpt at the transport ceilings, by code points", () => {
    const [one] = webResultsOf([
      row({
        title: "\u{1D400}".repeat(TITLE_MAX + 5),
        excerpt: "e".repeat(EXCERPT_MAX + 5),
      }),
    ]);
    expect(points(one?.title ?? "")).toBe(TITLE_MAX);
    expect(one?.excerpt).toHaveLength(EXCERPT_MAX);
  });

  it("dedupes by page and keeps at most WEB_RESULTS_MAX, in the engine's order", () => {
    const rows = [
      row({ url: "https://example.org/1#a" }),
      row({ url: "https://example.org/1#b" }),
      ...[2, 3, 4, 5, 6, 7].map((n) =>
        row({ url: `https://example.org/${n}` }),
      ),
    ];
    expect(webResultsOf(rows).map((r) => r.url)).toEqual([
      "https://example.org/1#a",
      "https://example.org/2",
      "https://example.org/3",
      "https://example.org/4",
      "https://example.org/5",
    ]);
    expect(WEB_RESULTS_MAX).toBe(5);
  });

  describe("pinned to the edition that was asked", () => {
    it.each([
      "https://en.wikipedia.org:8443/wiki/X",
      "http://en.wikipedia.org/wiki/X",
      "https://it.wikipedia.org/wiki/X",
      "https://en.wikipedia.org.evil.example/",
      "https://en.wikipedia.org@evil.example/",
      "https://good.example\\@evil.example/",
      "https://en.wikipedia.org/wiki/\tX",
      `https://en.wikipedia.org/wiki/${"a".repeat(URL_MAX)}`,
    ])("drops %j when en was asked", (url) => {
      expect(
        webResultsOf([row({ url })], { host: "en.wikipedia.org" }),
      ).toEqual([]);
    });

    it("keeps the edition's own host, whatever its case", () => {
      expect(
        webResultsOf([row({ url: "https://EN.wikipedia.org/wiki/X" })], {
          host: "en.wikipedia.org",
        }),
      ).toEqual([row({ url: "https://en.wikipedia.org/wiki/X" })]);
    });
  });
});

// ── Invisible characters in a URL ────────────────────────────────────────────

describe("webUrl and the invisibles plainLine already strips", () => {
  // The WHATWG parser maps a default-ignorable out of a host (UTS 46 marks
  // them "ignored"), so each of these would come back as a clean
  // `https://en.wikipedia.org/…` and pass the edition pin: cleaned, where
  // `webUrl` promises to refuse. Escapes, not literals, so the row reads.
  it.each([
    ["a variation selector", "https://en.wiki\uFE0Fpedia.org/wiki/X"],
    [
      "a supplementary variation selector",
      "https://en.wiki\u{E0100}pedia.org/",
    ],
    ["the Hangul filler", "https://en.wiki\u3164pedia.org/wiki/X"],
    ["the combining grapheme joiner", "https://en.wiki\u034Fpedia.org/"],
  ])("refuses a URL holding %s", (_, raw) => {
    expect(webUrl(raw)).toBeNull();
    expect(siteOf(raw)).toBeNull();
    expect(
      webResultsOf([{ url: raw, title: "t", excerpt: "e" }], {
        host: "en.wikipedia.org",
      }),
    ).toEqual([]);
  });
});

// ── A field sends what it shows ──────────────────────────────────────────────

describe("sendableQuery", () => {
  it("is usableQuery's value for an ordinary edit", () => {
    for (const raw of ["Porta Pia", "  breach  of\nRome ", "a\u{1F600}b"])
      expect(sendableQuery(raw)).toBe(usableQuery(raw));
  });

  it("is null wherever usableQuery is", () => {
    for (const raw of ["", "   ", "a", "​"])
      expect(sendableQuery(raw)).toBeNull();
  });

  it("is null where composing would lengthen the text past the cap", () => {
    // U+0958 and U+0344 are composition exclusions: NFC writes each as two
    // code points, so a field at the cap would be clipped on the way out.
    expect(Array.from("क़".normalize("NFC"))).toHaveLength(2);
    expect(sendableQuery("क़".repeat(QUERY_MAX))).toBeNull();
    // U+0344 composes into a letter before it (a + U+0308 is ä), so it
    // lengthens only after a space: 120 typed, 121 once composed.
    expect(sendableQuery(`${"a".repeat(QUERY_MAX - 2)} ̈́`)).toBeNull();
    // Within the cap once composed, it is sent whole.
    const half = "क़".repeat(QUERY_MAX / 2);
    expect(sendableQuery(half)).toBe(half.normalize("NFC"));
  });

  it("never exceeds the cap, and never differs from its own normal form", () => {
    for (const raw of [
      "q".repeat(QUERY_MAX),
      "q".repeat(QUERY_MAX + 1),
      `${"word ".repeat(40)}`,
    ]) {
      const sent = sendableQuery(raw);
      if (sent === null) continue;
      expect(Array.from(sent).length).toBeLessThanOrEqual(QUERY_MAX);
      expect(usableQuery(sent)).toBe(sent);
    }
    expect(sendableQuery("q".repeat(QUERY_MAX + 1))).toBeNull();
  });
});

describe("quoteBounded", () => {
  it("keeps a plain line of three words or more, up to the ceiling", () => {
    expect(WEB_QUOTE_MIN_WORDS).toBe(3);
    // A date is three words, and it counts.
    expect(quoteBounded("19 settembre 1985")).toBe(true);
    expect(quoteBounded("l'anno 1887-1889 fu")).toBe(true);
    expect(quoteBounded("a".repeat(WEB_QUOTE_MAX - 4) + " b c")).toBe(true);
  });

  it("refuses fewer words, where punctuation is not a word", () => {
    expect(quoteBounded("settembre 1985")).toBe(false);
    expect(quoteBounded("settembre 1985 —")).toBe(false);
    expect(quoteBounded("")).toBe(false);
  });

  it("refuses over the ceiling, counted in code points", () => {
    expect(quoteBounded("a b " + "c".repeat(WEB_QUOTE_MAX - 3))).toBe(false);
    // Astral characters are one code point each, not two units.
    const astral = "𝒜 𝒜 " + "𝒜".repeat(WEB_QUOTE_MAX - 4);
    expect([...astral].length).toBe(WEB_QUOTE_MAX);
    expect(quoteBounded(astral)).toBe(true);
  });

  it("refuses anything that is not already one plain line", () => {
    // The kept quote is the app's slice; a text that plainLine would change
    // did not come from it.
    expect(quoteBounded("one two" + String.fromCharCode(10) + "three")).toBe(
      false,
    );
    expect(quoteBounded(" one two three")).toBe(false);
    expect(
      quoteBounded("one two" + String.fromCharCode(0x200b) + " three"),
    ).toBe(false);
  });
});
