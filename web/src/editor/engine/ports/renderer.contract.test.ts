// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { htmlRenderer } from "../adapters/html";
import type { Doc, Paragraph } from "../domain/model";

// The renderer contract: every paragraph appears, in order, and each
// distinction the model makes renders as its own exact output. Run text is
// text, never markup. The html adapter is the one implementation.

function para(
  runs: Paragraph["runs"],
  over: Partial<Paragraph> = {},
): Paragraph {
  return { runs, blockType: "paragraph", alignment: "left", ...over };
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

describe("the html renderer contract", () => {
  const render = (doc: Doc): string => htmlRenderer.render(doc);

  it("all paragraphs of a doc appear in the output, in order", () => {
    const out = render([
      para([run("one")]),
      para([run("two")]),
      para([run("three")]),
    ]);
    expect(out.indexOf("one")).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("two")).toBeGreaterThan(out.indexOf("one"));
    expect(out.indexOf("three")).toBeGreaterThan(out.indexOf("two"));
  });
});

describe("htmlRenderer output", () => {
  it("wraps a plain paragraph", () => {
    expect(htmlRenderer.render([para([run("hi")])])).toBe("<p>hi</p>");
  });

  it("wraps run formats, monospace innermost", () => {
    expect(htmlRenderer.render([para([run("b", true, false, false)])])).toBe(
      "<p><strong>b</strong></p>",
    );
    expect(htmlRenderer.render([para([run("i", false, true, false)])])).toBe(
      "<p><em>i</em></p>",
    );
    expect(htmlRenderer.render([para([run("c", false, false, true)])])).toBe(
      "<p><code>c</code></p>",
    );
    expect(htmlRenderer.render([para([run("m", true, true, true)])])).toBe(
      "<p><strong><em><code>m</code></em></strong></p>",
    );
  });

  it("an empty paragraph renders as a line break", () => {
    expect(htmlRenderer.render([para([])])).toBe("<p><br></p>");
    expect(htmlRenderer.render([para([run("")])])).toBe("<p><br></p>");
  });

  it("a page break renders as a horizontal rule", () => {
    expect(htmlRenderer.render([para([], { blockType: "pagebreak" })])).toBe(
      "<hr>",
    );
  });

  it("headings render with their tags", () => {
    expect(htmlRenderer.render([para([run("t")], { blockType: "h1" })])).toBe(
      "<h1>t</h1>",
    );
    expect(htmlRenderer.render([para([run("t")], { blockType: "h2" })])).toBe(
      "<h2>t</h2>",
    );
  });

  it("non-left alignment adds an inline style", () => {
    expect(
      htmlRenderer.render([para([run("t")], { alignment: "center" })]),
    ).toBe('<p style="text-align:center">t</p>');
  });

  it("escapes run text and attribute values", () => {
    expect(htmlRenderer.render([para([run("<b>&")])])).toBe(
      "<p>&lt;b&gt;&amp;</p>",
    );
    expect(
      htmlRenderer.render([para([run("t")], { alignment: "right" })]),
    ).toBe('<p style="text-align:right">t</p>');
  });

  it("concatenates paragraphs without separators", () => {
    expect(htmlRenderer.render([para([run("a")]), para([run("b")])])).toBe(
      "<p>a</p><p>b</p>",
    );
  });
});
