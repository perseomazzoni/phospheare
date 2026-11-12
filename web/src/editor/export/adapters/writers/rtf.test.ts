// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { LAYOUT_IDS, PAGE_SIZES } from "../../domain/layout";
import { renderRtf, rtfText, rtfWriter } from "./rtf";
import { IN_TEXT_PAGE_BREAKS, testDoc } from "./document.fixture";

// RTF has no parser to lean on in a test and no schema: a reader that meets
// an unbalanced brace or a raw non-ASCII byte guesses, and each guesses
// differently. The suite checks the grammar directly (7-bit output, balanced
// groups once escapes are honoured) and counts the control words that make
// pages.

/** Group depth after the whole text, failing on any `}` that closes nothing. */
function braceBalance(rtf: string): number {
  let depth = 0;
  for (let i = 0; i < rtf.length; i += 1) {
    const char = rtf[i];
    if (char === "\\") i += 1;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth < 0) throw new Error(`unbalanced } at ${i}`);
    }
  }
  return depth;
}

/** A control word, not one it is a prefix of (`\page` is not `\pagebb`). */
const countWord = (rtf: string, word: string) =>
  rtf.match(new RegExp(`\\\\${word}(?![a-z])`, "g"))?.length ?? 0;

describe("rtfText", () => {
  it("escapes the three characters that are RTF syntax", () => {
    expect(rtfText("{a}\\b")).toBe("\\{a\\}\\\\b");
  });

  it("writes non-ASCII as signed 16-bit \\uN? escapes, astral characters as two", () => {
    expect(rtfText("è")).toBe("\\u232?");
    expect(rtfText("“")).toBe("\\u8220?");
    expect(rtfText("漢")).toBe("\\u28450?");
    // U+1F389 is the pair D83C DF89; both halves are above 32767.
    expect(rtfText("🎉")).toBe("\\u-10180?\\u-8311?");
  });

  it("writes tabs and line breaks as control words and drops forbidden characters", () => {
    expect(rtfText("a\tb\nc")).toBe("a\\tab b\\line c");
    expect(rtfText("a\u0001\uFFFEb")).toBe("ab");
  });
});

describe("renderRtf", () => {
  it.each(LAYOUT_IDS)("is a balanced, 7-bit RTF 1 document (%s)", (layout) => {
    const rtf = renderRtf(testDoc({ layout }));
    expect(rtf.startsWith("{\\rtf1")).toBe(true);
    expect(braceBalance(rtf)).toBe(0);
    // Every byte ASCII, and no control character but the line ends the
    // writer puts between control groups.
    expect(rtf).toMatch(/^[\n\x20-\x7E]*$/);
  });

  it.each(LAYOUT_IDS)(
    "breaks the page once per chapter boundary, plus the writer's own (%s)",
    (layout) => {
      const rtf = renderRtf(testDoc({ layout }));
      const chapters = testDoc({ layout }).chapters.length;
      // The text's own section begins on a new page (`\sbkpage`): that
      // boundary is a `\sect`, not a `\page`, and counts once.
      expect(countWord(rtf, "sect")).toBe(1);
      expect(countWord(rtf, "page") + countWord(rtf, "sect")).toBe(
        chapters - 1 + IN_TEXT_PAGE_BREAKS,
      );
      // Nothing after the last chapter's last paragraph.
      expect(rtf.trimEnd()).toMatch(/The last words\.\\par\n\}$/);
    },
  );

  it("carries the book's title and author in its info group", () => {
    const rtf = renderRtf(testDoc());
    expect(rtf).toContain(
      "{\\info{\\title The <Book> & \\u8220?Co\\u8221?}{\\author Ann Writer}{\\subject Fantasy, Mystery}}",
    );
  });

  it("sets the paper in twips and mirrors a trim book", () => {
    const rtf = renderRtf(testDoc({ layout: "book", page: "digest" }));
    expect(rtf).toContain(
      `\\paperw${Math.round(PAGE_SIZES.digest.width * 20)}\\paperh${Math.round(PAGE_SIZES.digest.height * 20)}`,
    );
    expect(rtf).toContain("\\margmirror");
    expect(renderRtf(testDoc({ layout: "review" }))).not.toContain(
      "\\margmirror",
    );
  });

  it.each(LAYOUT_IDS)(
    "puts the page furniture its layout asks for (%s)",
    (layout) => {
      const rtf = renderRtf(testDoc({ layout }));
      const manuscript = layout.startsWith("manuscript");
      expect(countWord(rtf, "header")).toBe(manuscript ? 1 : 0);
      expect(countWord(rtf, "linemod")).toBe(layout === "review" ? 1 : 0);
      expect(countWord(rtf, "footer")).toBe(manuscript ? 0 : 1);
      // The header group's paragraph formatting is the writer module's own;
      // the row pins the running head followed by a live `PAGE` field.
      if (manuscript)
        expect(rtf).toMatch(
          /\{\\header\\pard[^{}]* Writer \/ The Book \/ \{\\field\{\\\*\\fldinst PAGE\}\{\\fldrslt 1\}\}\\par\}/,
        );
      if (layout === "review") expect(rtf).toContain("{\\*\\fldinst NUMPAGES}");
    },
  );

  // The furniture's paragraphs opt out of line numbering (`\noline`). Not
  // every RTF reader honours it, a known limit of the format.
  it("keeps the header and the footer out of the line numbering", () => {
    const review = renderRtf(testDoc({ layout: "review" }));
    expect(review).toContain("{\\footer\\pard\\plain\\noline");
    const manuscript = renderRtf(testDoc({ layout: "manuscriptModern" }));
    expect(manuscript).toContain("{\\header\\pard\\plain\\noline");
  });

  it("leaves a story's first text page without the running head", () => {
    const rtf = renderRtf(testDoc({ layout: "manuscriptModern", story: true }));
    expect(rtf).toContain("{\\headerf\\pard\\plain\\par}");
    expect(countWord(rtf, "titlepg")).toBe(1);
  });

  it("writes formatting as groups and links as HYPERLINK fields", () => {
    const rtf = renderRtf(testDoc());
    expect(rtf).toContain("{\\i italic}");
    expect(rtf).toContain("{\\b bold}");
    expect(rtf).toContain("{\\b {\\i both}}");
    expect(rtf).toContain("{\\strike struck}");
    expect(rtf).toContain(
      '{\\field{\\*\\fldinst HYPERLINK "https://example.com/a?b=1&c=2"}{\\fldrslt{\\ul\\cf2 a link}}}',
    );
    expect(rtf).toContain("\\{brace\\} back\\\\slash");
  });

  it("encodes through the writer", async () => {
    const doc = testDoc();
    expect(new TextDecoder().decode(await rtfWriter.write(doc))).toBe(
      renderRtf(doc),
    );
    expect(rtfWriter.format).toBe("rtf");
  });
});
