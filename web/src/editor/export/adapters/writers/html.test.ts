// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlWriter, renderHtml } from "./html";
import { PRODUCT } from "../../../../product";
import {
  IN_TEXT_PAGE_BREAKS,
  NASTY_CLEAN,
  WORLD,
  hasForbidden,
  parseXml,
  testDoc,
} from "./document.fixture";

// The HTML export is one self-contained page that opens offline and runs
// nothing. The suite parses it as a browser would and checks what a browser
// would do with it: no script element whatever the book says, no address it
// would fetch, and links only to the schemes the parsers let through.

describe("renderHtml", () => {
  const doc = testDoc();
  const html = renderHtml(doc);
  const page = new DOMParser().parseFromString(html, "text/html");

  it("is one document in the book's language, titled by the book", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(page.documentElement.getAttribute("lang")).toBe("en");
    expect(page.title).toBe("The <Book> & “Co”");
    expect(
      page.querySelector('meta[name="author"]')?.getAttribute("content"),
    ).toBe("Ann Writer");
  });

  it("names the product that made it by its public name", () => {
    expect(
      page.querySelector('meta[name="generator"]')?.getAttribute("content"),
    ).toBe(PRODUCT.name);
  });

  it("is also well-formed XML, the XHTML spelling the EPUB shares", () => {
    expect(() => parseXml(html, "index.html")).not.toThrow();
  });

  it("writes the book's text as text: escaped, never markup, never a script", () => {
    expect(page.getElementsByTagName("script")).toHaveLength(0);
    expect(html).not.toMatch(/<script/i);
    expect(page.body.textContent).toContain(NASTY_CLEAN);
    expect(page.body.textContent).toContain(WORLD);
    expect(hasForbidden(page.body.textContent)).toBe(false);
  });

  it("fetches nothing: no stylesheet link, no src, the styles inline", () => {
    expect(page.querySelectorAll("link, img, iframe, [src]")).toHaveLength(0);
    expect(page.querySelectorAll("style")).toHaveLength(1);
  });

  // The page opens from a disk, for people the writer sends it to. Escaping
  // keeps it inert; the policy is the second barrier, should a block kind
  // ever let markup through.
  it("declares a policy that lets it fetch and run nothing but its own styles", () => {
    expect(
      page
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content"),
    ).toBe("default-src 'none'; style-src 'unsafe-inline'");
  });

  it("links only to http, https, mailto or its own anchors, and every anchor exists", () => {
    const hrefs = [...page.querySelectorAll("a[href]")].map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^(https?:|mailto:|#)/);
    for (const href of hrefs.filter((h) => h.startsWith("#")))
      expect(page.getElementById(href.slice(1))).not.toBeNull();
  });

  it("is one section per chapter, each ending on a printed page break but the last", () => {
    const sections = page.querySelectorAll("section.chapter");
    expect(sections).toHaveLength(doc.chapters.length);
    expect([...sections].map((section) => section.id)).toEqual(
      doc.chapters.map((chapter) => chapter.id),
    );
    // The break is the stylesheet's, so the last chapter's exemption is a
    // rule there too, and the sections are the body's only children so that
    // `:last-child` means the last chapter.
    const css = page.querySelector("style")?.textContent ?? "";
    expect(css).toMatch(/\.chapter \{ break-after: page;/);
    expect(css).toMatch(/\.chapter:last-child \{ break-after: auto;/);
    expect(page.body.lastElementChild).toBe(sections[sections.length - 1]);
    expect(page.querySelectorAll(".page-break")).toHaveLength(
      IN_TEXT_PAGE_BREAKS,
    );
  });

  it("encodes as UTF-8 through the writer", async () => {
    expect(new TextDecoder().decode(await htmlWriter.write(doc))).toBe(html);
    expect(htmlWriter.format).toBe("html");
  });
});
