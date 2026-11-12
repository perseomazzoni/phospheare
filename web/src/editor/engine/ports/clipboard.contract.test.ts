// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { browserClipboardCodec } from "../adapters/browserHtml";
import type { ClipboardCodec } from "./clipboard";
import type { Doc, Paragraph, Range, Run } from "../domain/model";
import { isValidDoc } from "../domain/invariants";

// The clipboard contract: the two outbound flavors and the sanitizing inbound
// parser are two halves of one boundary. What survives a foreign trip is what
// the model can hold: text, the three marks, block type and alignment.
// Everything else is dropped, never smuggled through. The suite runs against
// every codec implementation; the html adapter is the production one.

const codecs: { name: string; codec: ClipboardCodec }[] = [
  { name: "browserHtml", codec: browserClipboardCodec },
];

describe.each(codecs)("$name clipboard codec contract", ({ codec }) => {
  const run = (
    text: string,
    bold = false,
    italic = false,
    monospace = false,
  ): Run => ({ text, format: { bold, italic, monospace } });

  const para = (
    runs: Run[],
    blockType: Paragraph["blockType"] = "paragraph",
    alignment: Paragraph["alignment"] = "left",
  ): Paragraph => ({ runs, blockType, alignment });

  const fullRange = (doc: Doc): Range => {
    const last = doc.length - 1;
    const len = doc[last].runs.reduce((s, r) => s + r.text.length, 0);
    return {
      start: { para: 0, offset: 0 },
      end: { para: last, offset: len },
    };
  };

  describe("rich round trip", () => {
    it("preserves text and block structure", () => {
      const doc: Doc = [para([run("hello")]), para([run("world")])];
      expect(codec.parseHtml(codec.buildHtml(doc, fullRange(doc)))).toEqual(
        doc,
      );
    });

    it("preserves every format combination", () => {
      const doc: Doc = [
        para([
          run("plain"),
          run("b", true),
          run("i", false, true),
          run("m", false, false, true),
        ]),
        para([run("all", true, true, true)]),
      ];
      expect(codec.parseHtml(codec.buildHtml(doc, fullRange(doc)))).toEqual(
        doc,
      );
    });

    it("preserves headings and alignment", () => {
      const doc: Doc = [
        para([run("title")], "h1", "center"),
        para([run("sub")], "h2", "right"),
        para([run("body")], "paragraph", "justify"),
      ];
      expect(codec.parseHtml(codec.buildHtml(doc, fullRange(doc)))).toEqual(
        doc,
      );
    });

    it("round-trips a partial selection", () => {
      const doc: Doc = [para([run("hello world")])];
      const range: Range = {
        start: { para: 0, offset: 6 },
        end: { para: 0, offset: 11 },
      };
      const html = codec.buildHtml(doc, range);
      expect(html).toContain("world");
      expect(codec.parseHtml(html)).toEqual([para([run("world")])]);
    });
  });

  describe("plain round trip", () => {
    it("preserves text, one paragraph per line", () => {
      const doc: Doc = [para([run("one")]), para([run("two")])];
      const plain = codec.buildPlain(doc, fullRange(doc));
      expect(plain).toBe("one\ntwo");
      expect(codec.parsePlain(plain)).toEqual(doc);
    });
  });

  describe("hostile input is dropped, not smuggled", () => {
    const safeText = (html: string, expected: string) =>
      expect(
        codec
          .parseHtml(html)
          .map((p) => p.runs.map((r) => r.text).join(""))
          .join("\n"),
      ).toBe(expected);

    it("drops script content", () => {
      safeText("<script>alert(1)</script>hello", "hello");
    });

    it("drops style content", () => {
      safeText("<style>p{color:red}</style>x", "x");
    });

    it("drops svg and its content", () => {
      safeText('<svg onload="x"><circle/></svg>after', "after");
    });

    it("drops iframe content", () => {
      safeText("<iframe src=x></iframe>ok", "ok");
    });

    it("keeps link text but drops the href", () => {
      safeText('<a href="javascript:alert(1)">link</a>', "link");
    });

    it("drops an image and its alt text", () => {
      safeText('<img src=x onerror="alert(1)" alt="hi">tail', "tail");
    });

    it("drops event-handler attributes", () => {
      safeText('<p onclick="alert(1)">text</p>', "text");
    });

    it("drops style attributes that are not text-align", () => {
      safeText('<span style="color:red;background:url(x)">text</span>', "text");
    });

    it("never interprets text as markup", () => {
      safeText("a < b and c > d", "a < b and c > d");
      safeText("<3 hearts", "<3 hearts");
    });

    it("never throws on malformed input", () => {
      for (const junk of [
        "",
        "<",
        ">",
        "&",
        "<p",
        "a<b",
        "<<>>",
        "&unknown;",
      ]) {
        expect(() => codec.parseHtml(junk)).not.toThrow();
        expect(isValidDoc(codec.parseHtml(junk))).toBe(true);
      }
    });
  });

  describe("foreign word-processor HTML", () => {
    const runText = (html: string) =>
      codec.parseHtml(html).map((p) => ({
        blockType: p.blockType,
        alignment: p.alignment,
        runs: p.runs,
      }));

    it("maps Word mso-outline-level headings", () => {
      const out = runText(
        `<p class="MsoNormal" style="mso-outline-level:1">Heading</p>`,
      );
      expect(out[0].blockType).toBe("h1");
      expect(out[0].runs[0].text).toBe("Heading");
    });

    it("maps inline font-weight hints to bold", () => {
      const out = runText('<span style="font-weight:bold">x</span>');
      expect(out[0].runs[0].format.bold).toBe(true);
    });

    it("maps inline font-style hints to italic", () => {
      const out = runText('<span style="font-style:italic">x</span>');
      expect(out[0].runs[0].format.italic).toBe(true);
    });

    it("maps monospace font families", () => {
      const out = runText('<span style="font-family:Consolas">x</span>');
      expect(out[0].runs[0].format.monospace).toBe(true);
    });

    it("parses an online word processor's <br>-separated bold lines", () => {
      const out = runText('<meta charset="utf-8"><b>Hello</b><br><b>World</b>');
      expect(out).toEqual([
        {
          blockType: "paragraph",
          alignment: "left",
          runs: [run("Hello", true)],
        },
        {
          blockType: "paragraph",
          alignment: "left",
          runs: [run("World", true)],
        },
      ]);
    });

    const texts = (html: string) =>
      codec.parseHtml(html).map((p) => p.runs.map((r) => r.text).join(""));

    it("reads a Word document whose head nests a style", () => {
      const word =
        "<html>\r\n<head><style><!-- p {} --></style></head>\r\n" +
        "<body lang=EN-US>\r\n<!--StartFragment-->\r\n\r\n" +
        "<p class=MsoNormal>Lorem ipsum dolor sit amet. Sed\r\ndo eiusmod." +
        "<o:p></o:p></p>\r\n\r\n" +
        "<p class=MsoNormal>Second paragraph.<o:p></o:p></p>\r\n\r\n" +
        "<!--EndFragment-->\r\n</body>\r\n</html>";
      expect(texts(word)).toEqual([
        "Lorem ipsum dolor sit amet. Sed do eiusmod.",
        "Second paragraph.",
      ]);
    });

    it("ends a skip at the closing tag of the element that opened it", () => {
      expect(
        texts(
          '<html><head><meta charset="utf-8"><title>t</title>' +
            "<style>p{}</style></head><body><p>Hello</p></body></html>",
        ),
      ).toEqual(["Hello"]);
      expect(texts("<svg><style>x</style></svg><p>after</p>")).toEqual([
        "after",
      ]);
    });

    it("reads a source line break as a space, not a paragraph", () => {
      expect(texts("<p>one two\nthree</p>\n<p>four</p>\n")).toEqual([
        "one two three",
        "four",
      ]);
      expect(texts("<b>a</b>\n  <i>b</i>")).toEqual(["a b"]);
    });

    it("ends the monospace of a pre block at its closing tag", () => {
      const out = codec.parseHtml("<pre>code</pre><p>prose</p>");
      expect(out[0].runs[0].format.monospace).toBe(true);
      expect(out[1].runs[0]).toEqual(run("prose"));
    });

    it("skips nothing after a void or self-closing skip tag", () => {
      expect(texts('<embed src="x"><p>after embed</p>')).toEqual([
        "after embed",
      ]);
      expect(texts("<p>a</p><svg/><p>after svg</p>")).toEqual([
        "a",
        "after svg",
      ]);
    });

    it("keeps line breaks inside pre", () => {
      expect(texts("<pre>one\ntwo</pre>")).toEqual(["one", "two"]);
    });

    it("reads text-align from foreign styles", () => {
      const out = runText('<p style="text-align:center">c</p>');
      expect(out[0].alignment).toBe("center");
      expect(out[0].blockType).toBe("paragraph");
    });
  });

  describe("allowlist boundaries", () => {
    it("only text-align survives as an attribute", () => {
      const out = codec.parseHtml(
        '<p style="text-align:right;color:red;font-size:40px" data-x="1">x</p>',
      );
      expect(out[0].alignment).toBe("right");
      expect(out[0].runs[0].text).toBe("x");
      expect(out[0].runs[0].format).toEqual({
        bold: false,
        italic: false,
        monospace: false,
      });
    });

    it("decodes the entities its own renderer emits", () => {
      const doc: Doc = [para([run("a<b>&c\"d'e")])];
      expect(codec.parseHtml(codec.buildHtml(doc, fullRange(doc)))).toEqual(
        doc,
      );
    });

    it("a selected page break becomes a blank line", () => {
      const doc: Doc = [
        para([run("a")]),
        { runs: [], alignment: "left", blockType: "pagebreak" },
        para([run("b")]),
      ];
      const html = codec.buildHtml(doc, fullRange(doc));
      expect(html).not.toContain("<hr>");
      expect(codec.parseHtml(html)).toEqual([
        para([run("a")]),
        para([run("")]),
        para([run("b")]),
      ]);
    });
  });
});
