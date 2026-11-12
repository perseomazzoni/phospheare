// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  IN_TEXT_PAGE_BREAKS,
  NASTY_CLEAN,
  WORLD,
  hasForbidden,
  testDoc,
} from "./document.fixture";
import { renderText, textWriter } from "./txt";

// Plain text's conventions are old and fixed (`_italic_`, `*bold*`, a form
// feed for a page), and the submission forms that ask for .txt are read by
// people who know them. A form feed after the last chapter prints a blank
// last page.

describe("renderText", () => {
  const doc = testDoc();
  const text = renderText(doc);

  it("puts a form feed between chapters and after none of them", () => {
    expect(text.split("\f").length - 1).toBe(
      doc.chapters.length - 1 + IN_TEXT_PAGE_BREAKS,
    );
    const last = text.slice(text.lastIndexOf("\f"));
    expect(last).toContain("Chapter Two");
    expect(text.endsWith("The last words.\n")).toBe(true);
  });

  it("underlines titles: `=` for level 1, `-` for level 2, as long as the title", () => {
    expect(text).toContain("Part One\n========\n");
    expect(text).toContain("Chapter Two\n-----------\n");
    // Short titles still get a visible rule.
    expect(
      renderText({ ...doc, chapters: [{ ...doc.chapters[4], title: "A" }] }),
    ).toMatch(/^A\n---\n/);
  });

  it("spells emphasis the typewriter way and keeps a link's address", () => {
    expect(text).toContain("Plain _italic_ and *bold* *_both_*");
    expect(text).toContain("a link (https://example.com/a?b=1&c=2)");
  });

  it("prints `#` for a scene break and keeps non-ASCII text as written", () => {
    expect(text).toContain("\n\n#\n\n");
    expect(text).toContain(WORLD);
  });

  it("indents lists, quotes and code, and lists the contents by level", () => {
    // The blank line inside an item carries the item's indent; plain text
    // has no reader that minds trailing spaces, so only the shape is pinned.
    expect(text).toMatch(
      /3\. third item\n4\. fourth item\n {0,3}\n {3}- nested bullet/,
    );
    expect(text).toContain("> Quoted words");
    expect(text).toContain("    const x = a < b && c;\n      indented");
    expect(text).toContain(
      "Part One\n    Chapter <One> & “Two”\n    Chapter Two",
    );
    expect(text).toContain("Title: The <Book> & Co\nWords: 1,200");
  });

  it("encodes as UTF-8 through the writer, without the characters nothing can show", async () => {
    const written = new TextDecoder().decode(await textWriter.write(doc));
    // The test book carries `U+0001` and `U+FFFE`; a submission form shows
    // neither and some refuse the paste. The form feed is the page break.
    expect(hasForbidden(text)).toBe(true);
    expect(hasForbidden(written)).toBe(false);
    expect(written).toContain(NASTY_CLEAN);
    expect(written.split("\f")).toHaveLength(text.split("\f").length);
    expect(textWriter.format).toBe("txt");
  });
});
