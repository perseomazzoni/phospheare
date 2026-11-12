// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { XML_DECLARATION, escapeXml, stripInvalidXml, utf8 } from "./xml";

// `xml.ts` is the one module every XML-based writer puts the writer's words
// through. One character it lets past makes an EPUB that fails validation or
// a `.docx` that will not open, so the module is pinned character by character.

describe("stripInvalidXml", () => {
  it("drops what XML 1.0 forbids: C0 controls, U+FFFE/U+FFFF and lone surrogates", () => {
    expect(stripInvalidXml("a\u0001b\u0008c\u001Fd")).toBe("abcd");
    expect(stripInvalidXml("x\uFFFEy\uFFFFz")).toBe("xyz");
    // A surrogate half without its partner is not a character; the `u` flag
    // lets the class see it as one code point to drop.
    expect(stripInvalidXml("a\uD800b\uDC00c")).toBe("abc");
  });

  it("keeps tab, newline and carriage return, which XML allows", () => {
    expect(stripInvalidXml("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("keeps the edges of the allowed ranges and every astral character", () => {
    // `U+D7FF` and `U+E000` border the surrogate block; `U+FFFD` is the last
    // allowed BMP character; an emoji is a surrogate pair, which is allowed.
    const kept = "\uD7FF\uE000\uFFFD🎉漢字è“”";
    expect(stripInvalidXml(kept)).toBe(kept);
  });
});

describe("escapeXml", () => {
  it("escapes all five markup characters", () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;",
    );
  });

  it("escapes an ampersand first, so an entity in the text stays text", () => {
    // Escaping `&` after `<` would turn `<` into `&amp;lt;`; in the other
    // direction, text that already reads `&lt;` survives as text.
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });

  it("strips forbidden characters as it escapes", () => {
    expect(escapeXml("a\u0001<b")).toBe("a&lt;b");
  });
});

describe("utf8 and the declaration", () => {
  it("encodes as UTF-8, the encoding every declaration promises", () => {
    expect([...utf8("è")]).toEqual([0xc3, 0xa8]);
    expect(XML_DECLARATION).toMatch(/^<\?xml version="1.0" encoding="UTF-8"/);
  });
});
