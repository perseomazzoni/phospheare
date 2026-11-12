// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { setInnerHtml } from "../../../security/trustedHtml";
import { patchChanged, patchDocument } from "./patchDocument";
import { htmlRenderer, type Paragraph } from "../../engine";

// The patch is the editor's hot path — one call per keystroke — so the
// guarantees that matter are (a) only changed paragraphs are touched, (b) the
// result is always exactly the model's serialization, and (c) the rare
// wholesale change falls back to a full rebuild instead of an O(n²) guess.

function makeEditor(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("patchDocument", () => {
  it("replaces only the paragraph that changed, keeping the rest untouched", () => {
    const el = makeEditor("<p>one</p><p>two</p><p>three</p>");
    const [a, b, c] = Array.from(el.children);

    patchDocument(el, "<p>one</p><p>two!</p><p>three</p>", setInnerHtml);

    expect(el.children[0]).toBe(a);
    expect(el.children[1]).not.toBe(b);
    expect(el.children[2]).toBe(c);
    expect(el.innerHTML).toBe("<p>one</p><p>two!</p><p>three</p>");
  });

  it("appends a paragraph split off the end", () => {
    const el = makeEditor("<p>ab</p>");
    const a = el.children[0];

    patchDocument(el, "<p>ab</p><p>cd</p>", setInnerHtml);

    expect(el.children[0]).toBe(a);
    expect(el.innerHTML).toBe("<p>ab</p><p>cd</p>");
  });

  it("inserts a paragraph after an untouched one (enter in the middle)", () => {
    const el = makeEditor("<p>ab</p><p>cd</p>");
    const [a, b] = Array.from(el.children);

    patchDocument(el, "<p>ab</p><p>cd</p><p><br></p>", setInnerHtml);

    expect(el.children[0]).toBe(a);
    expect(el.children[1]).toBe(b);
    expect(el.innerHTML).toBe("<p>ab</p><p>cd</p><p><br></p>");
  });

  it("removes trailing paragraphs that are gone from the model", () => {
    const el = makeEditor("<p>one</p><p>two</p><p>three</p>");
    const [a, b] = Array.from(el.children);

    patchDocument(el, "<p>one</p><p>two</p>", setInnerHtml);

    expect(el.children[0]).toBe(a);
    expect(el.children[1]).toBe(b);
    expect(el.children.length).toBe(2);
  });

  it("replaces a paragraph when its block type changes", () => {
    const el = makeEditor("<p>ab</p>");
    const a = el.children[0];

    patchDocument(el, "<h1>ab</h1>", setInnerHtml);

    expect(el.children[0]).not.toBe(a);
    expect(el.innerHTML).toBe("<h1>ab</h1>");
  });

  it("patches alignment changes on a single paragraph", () => {
    const el = makeEditor(
      '<p>one</p><p style="text-align:left">two</p><p>three</p>',
    );
    const [a, c] = [el.children[0], el.children[2]];

    patchDocument(
      el,
      '<p>one</p><p style="text-align:center">two</p><p>three</p>',
      setInnerHtml,
    );

    expect(el.children[0]).toBe(a);
    expect(el.children[2]).toBe(c);
    expect(el.innerHTML).toBe(
      '<p>one</p><p style="text-align:center">two</p><p>three</p>',
    );
  });

  it("strips DOM-only decorations instead of treating them as changes", () => {
    const el = makeEditor(
      '<p>one</p><p><mark class="hl-search">two</mark></p><p>three</p>',
    );
    const [a, b, c] = Array.from(el.children);

    patchDocument(el, "<p>one</p><p>two</p><p>three</p>", setInnerHtml);

    expect(el.children[0]).toBe(a);
    expect(el.children[1]).toBe(b);
    expect(el.children[2]).toBe(c);
    expect(el.querySelector("mark")).toBeNull();
    expect(el.innerHTML).toBe("<p>one</p><p>two</p><p>three</p>");
  });

  it("is a no-op when the model matches the DOM", () => {
    const el = makeEditor(
      '<p>one</p><h2 style="text-align:right">two</h2><p><br></p>',
    );
    const kids = Array.from(el.children);

    patchDocument(el, el.innerHTML, setInnerHtml);

    expect(Array.from(el.children)).toEqual(kids);
  });

  it("rebuilds wholesale when more than a few paragraphs differ", () => {
    const oldHtml = Array.from({ length: 30 }, (_, i) => `<p>a${i}</p>`).join(
      "",
    );
    const newHtml = Array.from({ length: 30 }, (_, i) => `<p>b${i}</p>`).join(
      "",
    );
    const el = makeEditor(oldHtml);

    patchDocument(el, newHtml, setInnerHtml);

    expect(el.innerHTML).toBe(newHtml);
  });

  it("rebuilds when the DOM is in a shape the serializer never produces", () => {
    const el = makeEditor("<div>stray</div><p>y</p>");

    patchDocument(el, "<p>z</p>", setInnerHtml);

    expect(el.innerHTML).toBe("<p>z</p>");
  });
});

// ── The span patch ───────────────────────────────────────────────────────────
//
// What changed is found by reference, because the model never mutates a
// paragraph. Pinned: only the changed span is touched, the page ends up
// exactly as the model renders, and a page that does not line up with the doc
// it was drawn from is refused so the full reconciliation can run.

const para = (text: string): Paragraph => ({
  runs: [{ text, format: { bold: false, italic: false, monospace: false } }],
  alignment: "left",
  blockType: "paragraph",
});
const render = (span: readonly unknown[]) =>
  htmlRenderer.render(span as Paragraph[]);

function drawn(doc: Paragraph[]): HTMLElement {
  return makeEditor(htmlRenderer.render(doc));
}

describe("patchChanged", () => {
  it("replaces only the paragraph whose object changed", () => {
    const [a, b, c] = [para("one"), para("two"), para("three")];
    const el = drawn([a, b, c]);
    const [pa, pb, pc] = Array.from(el.children);
    const next = [a, para("two!"), c];

    expect(patchChanged(el, [a, b, c], next, render, setInnerHtml)).toBe(true);

    expect(el.children[0]).toBe(pa);
    expect(el.children[1]).not.toBe(pb);
    expect(el.children[2]).toBe(pc);
    expect(el.innerHTML).toBe(htmlRenderer.render(next));
  });

  it("inserts a split and removes a merge in the right place", () => {
    const [a, b, c] = [para("one"), para("two"), para("three")];
    const el = drawn([a, b, c]);
    const split = [a, para("tw"), para("o"), c];
    expect(patchChanged(el, [a, b, c], split, render, setInnerHtml)).toBe(true);
    expect(el.innerHTML).toBe(htmlRenderer.render(split));

    const merged = [split[0], para("two"), c].slice(0, 2);
    expect(patchChanged(el, split, merged, render, setInnerHtml)).toBe(true);
    expect(el.innerHTML).toBe(htmlRenderer.render(merged));
  });

  it("does nothing when nothing changed", () => {
    const doc = [para("one"), para("two")];
    const el = drawn(doc);
    const before = Array.from(el.children);
    expect(patchChanged(el, doc, [...doc], render, setInnerHtml)).toBe(true);
    expect(Array.from(el.children)).toEqual(before);
  });

  it("refuses a page it cannot vouch for", () => {
    const doc = [para("one"), para("two")];
    const el = drawn(doc);
    // Nothing drawn yet.
    expect(patchChanged(el, null, doc, render, setInnerHtml)).toBe(false);
    // The page has a paragraph the drawn doc does not.
    el.appendChild(document.createElement("p"));
    expect(
      patchChanged(el, doc, [para("x"), doc[1]], render, setInnerHtml),
    ).toBe(false);
    expect(el.children).toHaveLength(3);
  });
});
