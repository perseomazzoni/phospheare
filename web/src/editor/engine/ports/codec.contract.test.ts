// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { commonmarkCodec } from "../adapters/commonmark";
import type { Codec } from "./codec";
import type { Doc, Paragraph } from "../domain/model";

// The codec contract: the parser and the serializer are two halves of one
// state machine, and the saved file is what survives the round trip. Every
// format combination the engine can produce comes back identical, including
// the mixed ones where `code` nests inside the bold and italic markers, which
// toggling a format while another is pending can reach.
//
// The suite runs against every codec implementation, so a new adapter passes
// it before it handles the writer's files.

const codecs: { name: string; codec: Codec }[] = [
  { name: "commonmark", codec: commonmarkCodec },
];

describe.each(codecs)("$name codec contract", ({ codec }) => {
  const parse = (text: string): Doc => codec.parse(text);
  const serialize = (doc: Doc): string => codec.serialize(doc);

  function para(
    runs: Paragraph["runs"],
    blockType: Paragraph["blockType"] = "paragraph",
    alignment: Paragraph["alignment"] = "left",
  ): Paragraph {
    return { runs, blockType, alignment };
  }

  const run = (
    text: string,
    bold = false,
    italic = false,
    monospace = false,
  ) => ({
    text,
    format: { bold, italic, monospace },
  });

  const roundTrips = (doc: Doc) => expect(parse(serialize(doc))).toEqual(doc);

  describe("serialize/parse round trip", () => {
    it("plain text survives", () => {
      roundTrips([para([run("hello world")])]);
    });

    it("empty document serializes to the empty string, which parses to one empty paragraph", () => {
      expect(serialize([])).toBe("");
      expect(parse("")).toEqual([
        {
          runs: [
            {
              text: "",
              format: { bold: false, italic: false, monospace: false },
            },
          ],
          alignment: "left",
          blockType: "paragraph",
        },
      ]);
    });

    it("bold, italic and monospace survive", () => {
      roundTrips([
        para([run("bold", true)]),
        para([run("italic", false, true)]),
        para([run("code", false, false, true)]),
      ]);
    });

    it("bold + monospace survives", () => {
      roundTrips([para([run("mixed", true, false, true)])]);
    });

    it("italic + monospace survives", () => {
      roundTrips([para([run("mixed", false, true, true)])]);
    });

    it("bold + italic + monospace survives", () => {
      roundTrips([para([run("mixed", true, true, true)])]);
    });

    it("format transitions inside one paragraph survive", () => {
      roundTrips([
        para([
          run("a", true),
          run("b", false),
          run("c", false, false, true),
          run("d", true, true, true),
        ]),
      ]);
    });

    it("escaped literal markers survive", () => {
      roundTrips([para([run("a*b*`c`\\d")])]);
    });

    // The serializer escapes a code run's content as it escapes plain text,
    // so the parser unescapes it, and a monospace span holding a backslash, a
    // star or a brace comes back identical. Without the unescape, every save
    // would double the span's backslashes.
    it("monospace runs containing escaped markers survive", () => {
      roundTrips([para([run("a\\b*c{d", false, false, true)])]);
    });

    it("monospace runs holding backticks survive, the written form included", () => {
      for (const text of ["a`b", "`a", "b`", "``", "a ``` b", " x ", "\\`"]) {
        const doc = [para([run("x "), run(text, false, false, true)])];
        roundTrips(doc);
        expect(serialize(parse(serialize(doc)))).toBe(serialize(doc));
      }
      roundTrips([
        para([run("a`b", true, false, true), run("c`", false, false, true)]),
      ]);
    });

    it("monospace round-trips through the written form, not just the doc", () => {
      // The written form is a fixed point: parsing and re-serializing it
      // yields the same bytes, or `open` reads a freshly saved file as
      // unsaved work.
      const doc = [
        para([run("root:/ # rm -rf \\some\\path", false, false, true)]),
      ];
      expect(serialize(parse(serialize(doc)))).toBe(serialize(doc));
    });

    it("headings and alignment survive", () => {
      const h1 = para([run("title")], "h1", "center");
      roundTrips([h1, para([run("body")], "h2")]);
    });

    // The parser reads `# ` and `## ` at a block's start as a heading, so the
    // serializer escapes prose that merely begins that way (an imported "# 3",
    // a hashtag line), or it comes back as a heading after one save.
    it("a paragraph that opens like a heading stays a paragraph", () => {
      roundTrips([para([run("# 3")])]);
      roundTrips([para([run("## not a heading")])]);
      const centred = para(
        [run("# centred, still prose")],
        "paragraph",
        "center",
      );
      roundTrips([centred]);
    });

    it("a leading hashtag that never parses as a heading is left as written", () => {
      expect(serialize([para([run("#tag and ### three")])])).toBe(
        "#tag and ### three",
      );
      roundTrips([para([run("### three")])]);
    });

    it("adjacent runs with equal formats merge without changing meaning", () => {
      const doc = parse("plain **bold** plain");
      expect(serialize(doc)).toBe("plain **bold** plain");
      roundTrips(doc);
    });
  });

  describe("page break serialization", () => {
    const breakPara = (): Paragraph => ({
      runs: [],
      alignment: "left",
      blockType: "pagebreak",
    });

    it("a pagebreak block serializes to a bare {pagebreak} line", () => {
      expect(serialize([breakPara()])).toBe("{pagebreak}");
    });

    it("{pagebreak} parses to a pagebreak block", () => {
      expect(parse("{pagebreak}")).toEqual([breakPara()]);
    });

    it("pagebreak round-trips between surrounding paragraphs", () => {
      roundTrips([para([run("before")]), breakPara(), para([run("after")])]);
    });

    it("three dashes stay plain text", () => {
      roundTrips([para([run("---")])]);
      expect(parse("---")).toEqual([para([run("---")])]);
    });

    it("typed-looking {pagebreak} text stays literal (serializer escapes the brace)", () => {
      roundTrips([para([run("{pagebreak}")])]);
      expect(serialize([para([run("{pagebreak}")])])).toBe("\\{pagebreak}");
    });

    it("literal braces and backslashes round-trip", () => {
      roundTrips([para([run("a {b} \\c `d` *e*")])]);
    });

    it("an escaped brace before other content parses as text, not alignment", () => {
      expect(parse("\\{align:center} text")).toEqual([
        para([run("{align:center} text")]),
      ]);
    });

    it("alignment prefix still works for existing files", () => {
      const p = para([run("text")], "paragraph", "center");
      expect(parse("{align:center}text")).toEqual([p]);
      roundTrips([p]);
    });
  });
});

// ── Line endings ─────────────────────────────────────────────────────────────
//
// These rows run against the commonmark codec directly, outside the
// `describe.each`, though the rule belongs to every codec.

describe("audit findings", () => {
  it("— a CRLF document parses as one paragraph instead of two", () => {
    // A CRLF file's paragraph breaks are "\r\n\r\n", so the parser folds line
    // endings before splitting on "\n\n", or the file collapses into one
    // paragraph. `text/hash.canonicalize` folds them before
    // hashing, so the hash and the parser agree on what the same document
    // is.
    const doc = commonmarkCodec.parse("one\r\n\r\ntwo");
    expect(doc.length).toBe(2);
  });

  it("— a file's terminating newline is not part of its last paragraph", () => {
    // The same prose parses to the same text whether or not its paragraph is
    // last in the file. `serialize` never writes a final newline (it is a
    // bare `join`), but the manuscript lives in the writer's folder and most
    // other editors add one. Kept in the last paragraph, it would make a
    // compare show a zero-width hunk whose Accept no pointer can reach.
    const [, last] = commonmarkCodec.parse("one\n\ntwo\n");
    expect(last.runs.map((r) => r.text).join("")).toBe("two");

    // The same prose in the two positions is the same paragraph.
    const middle = commonmarkCodec.parse("one\n\ntwo\n\nthree")[1];
    expect(middle.runs.map((r) => r.text).join("")).toBe("two");
  });

  it("— a trailing BLANK line is still an empty last paragraph", () => {
    // A file ending "\n\n" is the serializer's canonical form for a document
    // whose last paragraph is empty, so stripping there would delete a
    // paragraph the writer can put the caret in.
    const doc = commonmarkCodec.parse("one\n\ntwo\n\n");
    expect(doc.length).toBe(3);
    expect(doc[2].runs.map((r) => r.text).join("")).toBe("");
  });
});
