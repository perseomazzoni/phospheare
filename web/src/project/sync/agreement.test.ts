// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { holdsTheBook, projectAgrees } from "./agreement";

// The question the open asks a folder, asked of a remote's scan before a pull.

const AT = "2026-01-01T00:00:00.000Z";
const FIRST = "section--one.EL1.00.md";
const SECOND = "section--one.EL1.01.md";
const STRUCTURE = `version: 1
document:
  - id: EL1
    section: One
    adopted: ${FIRST}
`;
const catalogue = (live: string[], binned: string[] = []) =>
  JSON.stringify({
    snapshots: {
      EL1: live.map((file, i) => ({ file, title: `Draft ${i}`, created: AT })),
    },
    binned:
      binned.length > 0
        ? { EL1: binned.map((file) => ({ file, title: "Two", created: AT })) }
        : {},
  });

describe("holdsTheBook", () => {
  it("covers the records, document/ and recyclebin/, and nothing else", () => {
    expect(
      [
        "/document-structure.yaml",
        "/snapshots-catalogue.json",
        `/document/${FIRST}`,
        `/recyclebin/${SECOND}`,
        "/document-properties.json",
        "/comments/EL1.json",
        "/reference/notes.md",
      ].map(holdsTheBook),
    ).toEqual([true, true, true, true, false, false, false]);
  });
});

describe("projectAgrees", () => {
  it("agrees when the records and the files say the same thing", () => {
    expect(
      projectAgrees(STRUCTURE, catalogue([FIRST, SECOND], []), [
        `/document/${FIRST}`,
        `/document/${SECOND}`,
      ]),
    ).toBe(true);
  });

  it("disagrees over a file whose record has not arrived", () => {
    expect(
      projectAgrees(STRUCTURE, catalogue([FIRST]), [
        `/document/${FIRST}`,
        `/document/${SECOND}`,
      ]),
    ).toBe(false);
  });

  it("disagrees over a record whose file has not arrived", () => {
    expect(
      projectAgrees(STRUCTURE, catalogue([FIRST, SECOND]), [
        `/document/${FIRST}`,
      ]),
    ).toBe(false);
  });

  it("disagrees over a binned record whose file is not in the bin", () => {
    expect(
      projectAgrees(STRUCTURE, catalogue([FIRST], [SECOND]), [
        `/document/${FIRST}`,
      ]),
    ).toBe(false);
    expect(
      projectAgrees(STRUCTURE, catalogue([FIRST], [SECOND]), [
        `/document/${FIRST}`,
        `/recyclebin/${SECOND}`,
      ]),
    ).toBe(true);
  });

  it("disagrees when the structure or the catalogue is missing or broken", () => {
    const files = [`/document/${FIRST}`];
    expect(projectAgrees(null, catalogue([FIRST]), files)).toBe(false);
    expect(projectAgrees(STRUCTURE, null, files)).toBe(false);
    expect(projectAgrees("document: [", catalogue([FIRST]), files)).toBe(false);
    expect(projectAgrees(STRUCTURE, "{", files)).toBe(false);
  });

  it("ignores files outside the book", () => {
    expect(
      projectAgrees(STRUCTURE, catalogue([FIRST]), [
        `/document/${FIRST}`,
        "/document/notes.txt",
        "/reference/notes.md",
      ]),
    ).toBe(true);
  });
});
