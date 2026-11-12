// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { sniff } from "./sniff";
import { ACCEPT, extensionOf, formatForName, stemOf } from "./formats";
import { naturalSort } from "./naturalSort";
import { assertHomogeneous, preorder, type DraftNode } from "./draft";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0, 0);

describe("sniff", () => {
  it("takes a package at its extension when it is a zip", () => {
    expect(sniff("book.docx", ZIP)).toEqual({ kind: "format", format: "docx" });
    expect(sniff("book.epub", ZIP)).toEqual({ kind: "format", format: "epub" });
  });

  it("asks the probe about a zip with any other name", () => {
    expect(sniff("book.zip", ZIP)).toEqual({ kind: "zip" });
    expect(sniff("book.txt", ZIP)).toEqual({ kind: "zip" });
  });

  it("refuses what it cannot read, saying what the file is", () => {
    const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    expect(sniff("book.docx", ole)).toEqual({ kind: "refused", reason: "doc" });
    expect(sniff("book.pdf", text("%PDF-1.7"))).toMatchObject({
      reason: "pdf",
    });
    expect(sniff("book.pages", ZIP)).toMatchObject({ reason: "pages" });
    expect(sniff("book.gdoc", text('{"url":"x"}'))).toMatchObject({
      reason: "gdoc",
    });
    expect(sniff("book.txt", bytes())).toMatchObject({ reason: "empty" });
    expect(sniff("book.docx", text("hello"))).toMatchObject({
      reason: "damaged",
    });
    expect(sniff("book.txt", bytes(1, 2, 0, 4))).toMatchObject({
      reason: "binary",
    });
  });

  it("knows RTF by its signature whatever its name", () => {
    expect(sniff("book.txt", text("{\\rtf1\\ansi"))).toEqual({
      kind: "format",
      format: "rtf",
    });
  });

  it("reads text by its name, and an unnamed web page by its first bytes", () => {
    expect(sniff("a.md", text("# Hi"))).toEqual({
      kind: "format",
      format: "md",
    });
    expect(sniff("page", text("<!DOCTYPE html><p>x"))).toEqual({
      kind: "format",
      format: "html",
    });
    expect(sniff("notes", text("plain words"))).toMatchObject({
      reason: "unknown",
    });
  });

  it("vouches for UTF-16 text despite its NULs", () => {
    expect(sniff("a.txt", bytes(0xff, 0xfe, 0x41, 0x00))).toEqual({
      kind: "format",
      format: "txt",
    });
  });
});

describe("formats", () => {
  it("reads names", () => {
    expect(extensionOf("dir.v2/Book.DOCX")).toBe("docx");
    expect(extensionOf(".hidden")).toBe("");
    expect(formatForName("x.markdown")).toBe("md");
    expect(formatForName("x.pdf")).toBeNull();
    expect(stemOf("c:\\a\\Chapter 1.md")).toBe("Chapter 1");
    expect(ACCEPT).toContain(".epub");
  });
});

describe("naturalSort", () => {
  it("puts chapter ten after chapter two", () => {
    expect(
      naturalSort(["Chapter 10.md", "chapter 2.md", "Chapter 1.md"], (n) => n),
    ).toEqual(["Chapter 1.md", "chapter 2.md", "Chapter 10.md"]);
  });
});

describe("the draft's Golden Rule", () => {
  const section = (title: string): DraftNode => ({
    kind: "section",
    title,
    paragraphs: [],
    children: [],
  });
  const part = (title: string, children: DraftNode[]): DraftNode => ({
    kind: "part",
    title,
    paragraphs: [],
    children,
  });

  it("passes homogeneous lists at every depth", () => {
    expect(() =>
      assertHomogeneous([part("A", [section("1")]), part("B", [])]),
    ).not.toThrow();
  });

  it("refuses a list that mixes kinds, at the root or below", () => {
    expect(() => assertHomogeneous([part("A", []), section("1")])).toThrow();
    expect(() =>
      assertHomogeneous([part("A", [part("B", []), section("1")])]),
    ).toThrow();
  });

  it("walks parents before children", () => {
    const tree = [part("A", [section("1"), section("2")]), part("B", [])];
    expect(preorder(tree).map((n) => n.title)).toEqual(["A", "1", "2", "B"]);
  });
});
