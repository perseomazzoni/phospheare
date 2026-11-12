// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { draftFooterParts, pagedPlan } from "./paged";
import { testDoc } from "./document.fixture";

// Which page is page 1, and what furniture it carries, is decided here once
// for DOCX, ODT, RTF and PDF. A disagreement between those four would show as
// a manuscript numbered from its title page in one format and not another.

describe("pagedPlan", () => {
  it("splits the unnumbered pages before the text from the text", () => {
    const plan = pagedPlan(testDoc({ layout: "book" }));
    expect(plan.front.map((chapter) => chapter.kind)).toEqual(["tech", "toc"]);
    expect(plan.body.map((chapter) => chapter.kind)).toEqual([
      "part",
      "section",
      "section",
    ]);
  });

  it("puts a novel manuscript's title page in front, so page 1 is the text", () => {
    const plan = pagedPlan(testDoc({ layout: "manuscriptModern" }));
    expect(plan.front.map((chapter) => chapter.kind)).toEqual([
      "tech",
      "title",
      "toc",
    ]);
    // The title page is a page of its own; the text's first page has no
    // opening on it, so it carries the running head like every other.
    expect(plan.bareFirstPage).toBe(false);
  });

  it("leaves a story's first text page bare: the contact block stands there instead", () => {
    expect(
      pagedPlan(testDoc({ layout: "manuscriptClassic", story: true }))
        .bareFirstPage,
    ).toBe(true);
  });

  it("has a running head only under a manuscript layout", () => {
    expect(pagedPlan(testDoc({ layout: "book" })).runningHead).toBeNull();
    expect(pagedPlan(testDoc({ layout: "review" })).runningHead).toBeNull();
    expect(pagedPlan(testDoc({ layout: "manuscriptModern" })).runningHead).toBe(
      "Writer / The Book / ",
    );
  });

  it("keeps a manuscript's page number when the writer left the running header empty", () => {
    // Empty, not null: the header still exists and still prints the number.
    const doc = {
      ...testDoc({ layout: "manuscriptModern" }),
      runningHeader: "",
    };
    expect(pagedPlan(doc).runningHead).toBe("");
  });

  it("is all front matter when nothing is numbered (a book exported as its tech page)", () => {
    const doc = testDoc();
    const plan = pagedPlan({ ...doc, chapters: doc.chapters.slice(0, 1) });
    expect(plan.front).toHaveLength(1);
    expect(plan.body).toEqual([]);
    expect(plan.bareFirstPage).toBe(false);
  });
});

describe("draftFooterParts", () => {
  it("splits the review footer around its page and page-count slots", () => {
    expect(draftFooterParts(testDoc({ layout: "review" }))).toEqual([
      "Draft · 1 October 2026 · page ",
      " of ",
      "",
    ]);
  });

  it("keeps text that follows the count, for a language that puts words after it", () => {
    const doc = testDoc({ layout: "review" });
    const parts = draftFooterParts({
      ...doc,
      furniture: { ...doc.furniture, pageOf: "p. {page}/{pages} tot." },
    });
    expect(parts).toEqual(["Draft · 1 October 2026 · p. ", "/", " tot."]);
  });
});
