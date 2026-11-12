// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { stripAsides, asideRegex } from "./asides";

// The aside syntax has one definition: the reader draws the asides, and the
// assistant's source port and the export strip them. Both the match
// and the strip are pinned here.

describe("the note syntax", () => {
  it("hands out a fresh matcher every time, so scans cannot share state", () => {
    const first = asideRegex();
    first.exec("<!-- x -->");
    const second = asideRegex();
    expect(second.lastIndex).toBe(0);
    expect(second.exec("<!-- x -->")?.[1]).toBe(" x ");
  });

  it("takes every note out, however it was written", () => {
    // Multi-line, several in one document, and one carrying markdown of its
    // own: one matcher, because the syntax is defined once.
    const stripped = stripAsides(
      [
        "# Antagonist",
        "",
        "<!-- Hint: who wants what, and why can't they have it? -->",
        "",
        "She wants the gate open.",
        "",
        "<!-- Suggerimento: due righe,",
        "   non di più -->",
        "",
        "He wants it shut.",
      ].join("\n"),
    );
    expect(stripped).not.toContain("Hint");
    expect(stripped).not.toContain("Suggerimento");
    expect(stripped).not.toContain("<!--");
    expect(stripped).toContain("She wants the gate open.");
    expect(stripped).toContain("He wants it shut.");
  });

  it("never joins the words on either side of a note", () => {
    // A note removed outright turns `opened<!-- x -->and` into `openedand`,
    // and a corrupted word in the model's copy of the manuscript is worse than
    // the note: the assistant quotes it back, and the quote matches nothing in
    // the file.
    expect(stripAsides("opened<!-- note -->and closed")).toBe(
      "opened and closed",
    );
  });

  it("leaves no trace of its own space", () => {
    // The repair space has two side effects to avoid. At the end of a line it
    // joins the line's trailing space into markdown's two-space hard break, a
    // line break the writer never typed. And a note on its own lines would
    // leave a paragraph-sized hole at a paragraph boundary.
    expect(stripAsides("She waited. <!-- beat -->\nHe did not.")).toBe(
      "She waited.\nHe did not.",
    );
    expect(stripAsides("One.\n\n<!-- beat -->\n\nTwo.")).toBe("One.\n\nTwo.");
  });

  it("leaves a document with no notes exactly as it was", () => {
    const prose = "She waited.\n\nHe did not.\n";
    expect(stripAsides(prose)).toBe(prose);
  });
});
