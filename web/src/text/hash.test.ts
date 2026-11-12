// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { canonicalize, hashOf, sha256Hex } from "./hash";

// Known vectors first, so a wrong algorithm or encoding fails here rather than
// as an unexplained sync conflict three modules downstream.

describe("sha256Hex", () => {
  it("matches the known SHA-256 vector for an empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it('matches the known SHA-256 vector for "abc"', async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("differs on a BOM the byte-identical text otherwise lacks", async () => {
    const withoutBom = await sha256Hex("hello");
    const withBom = await sha256Hex("﻿hello");
    expect(withoutBom).not.toBe(withBom);
  });

  it("differs on line-ending style alone", async () => {
    const lf = await sha256Hex("a\nb");
    const crlf = await sha256Hex("a\r\nb");
    expect(lf).not.toBe(crlf);
  });
});

describe("canonicalize", () => {
  it("leaves plain LF untouched", () => {
    expect(canonicalize("a\nb")).toBe("a\nb");
  });

  it("maps CRLF to LF", () => {
    expect(canonicalize("a\r\nb")).toBe("a\nb");
    expect(canonicalize("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("maps lone CR to LF", () => {
    expect(canonicalize("a\rb")).toBe("a\nb");
  });

  it("strips a leading BOM", () => {
    expect(canonicalize("\uFEFFhello")).toBe("hello");
    expect(canonicalize("\uFEFF")).toBe("");
  });

  it("does not strip a BOM that is not leading", () => {
    expect(canonicalize("hello\uFEFF")).toBe("hello\uFEFF");
  });

  it("preserves trailing newline significance", () => {
    expect(canonicalize("hello\n")).not.toBe(canonicalize("hello"));
  });
});

describe("hashOf", () => {
  it("is SHA-256 of the canonical form", async () => {
    const h = await hashOf("hello");
    const expected = await sha256Hex("hello");
    expect(h).toBe(expected);
  });

  it("is the known empty hash", async () => {
    expect(await hashOf("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("does not flag CRLF vs LF as a change", async () => {
    expect(await hashOf("a\nb")).toBe(await hashOf("a\r\nb"));
    expect(await hashOf("a\r\nb")).toBe(await hashOf("a\rb"));
  });

  it("does not flag a leading BOM as a change", async () => {
    expect(await hashOf("hello")).toBe(await hashOf("\uFEFFhello"));
  });

  it("differs on real content change", async () => {
    expect(await hashOf("hello")).not.toBe(await hashOf("hello!"));
  });
});
