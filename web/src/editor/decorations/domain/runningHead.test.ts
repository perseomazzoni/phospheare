// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { DocNode, DocumentStructure } from "../../../project/types";
import { runningHeadOf } from "./runningHead";

const section = (id: string, title = id): DocNode => ({
  kind: "section",
  id,
  title,
  adopted: `${id}.md`,
  snapshots: [],
});
const part = (id: string, title: string, children: DocNode[]): DocNode => ({
  kind: "part",
  id,
  title,
  adopted: `${id}.md`,
  snapshots: [],
  children,
});

const book: DocumentStructure = {
  version: 1,
  children: [
    part("p1", "Ki — Void", [section("s1"), section("s2")]),
    part("p2", "Two", [part("p3", "Inner", [section("s3")])]),
    section("s4"),
  ],
};

describe("a page's running head", () => {
  it("names the book and the Part, and numbers the Section in the book", () => {
    expect(runningHeadOf(book, "s2", "Once Dark")).toEqual({
      book: "Once Dark",
      part: "Ki — Void",
      folio: 2,
    });
  });

  it("names the innermost Part of a nested one", () => {
    expect(runningHeadOf(book, "s3", "Once Dark")).toMatchObject({
      part: "Inner",
      folio: 3,
    });
  });

  it("names the book alone for a Section at the root, and numbers no Part", () => {
    expect(runningHeadOf(book, "s4", "Once Dark")).toEqual({
      book: "Once Dark",
      part: null,
      folio: 4,
    });
    expect(runningHeadOf(book, "p1", "Once Dark").folio).toBeNull();
  });
});
