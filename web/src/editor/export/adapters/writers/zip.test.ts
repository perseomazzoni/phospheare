// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { firstLocalEntry, unzipText } from "./document.fixture";
import { zipPackage } from "./zip";

// Pins the packaging rule EPUB and ODF share, read from the raw bytes rather
// than through an unzipper: a reader sniffs `mimetype` at a fixed offset, so
// the rule is where it sits and how it is stored, not what a tolerant library
// can recover from the central directory.

describe("zipPackage", () => {
  it("writes `mimetype` as the first entry, stored, with the exact text", () => {
    const bytes = zipPackage(
      [{ path: "a.xml", data: "<a/>" }],
      "application/epub+zip",
    );
    const first = firstLocalEntry(bytes);
    expect(first.name).toBe("mimetype");
    expect(first.method).toBe(0);
    // Stored means the bytes are the text with nothing around it, not even a
    // trailing newline, which validators reject.
    expect(first.data).toBe("application/epub+zip");
  });

  it("deflates every other entry and keeps them in the order given", () => {
    const big = "x".repeat(2000);
    const bytes = zipPackage(
      [
        { path: "z.txt", data: big },
        { path: "a.txt", data: new TextEncoder().encode("bytes") },
      ],
      "application/vnd.oasis.opendocument.text",
    );
    expect(Object.keys(unzipSync(bytes))).toEqual([
      "mimetype",
      "z.txt",
      "a.txt",
    ]);
    expect(unzipText(bytes)["z.txt"]).toBe(big);
    expect(unzipText(bytes)["a.txt"]).toBe("bytes");
    // The second local header's name sits 30 bytes in, so the header starts
    // 30 bytes before the first occurrence of that name in the archive.
    const at = new TextDecoder("latin1").decode(bytes).indexOf("z.txt") - 30;
    expect(firstLocalEntry(bytes.subarray(at))).toMatchObject({
      name: "z.txt",
      method: 8,
    });
  });

  it("writes no `mimetype` entry when none is asked for (DOCX has none)", () => {
    const bytes = zipPackage([{ path: "word/document.xml", data: "<w/>" }]);
    expect(Object.keys(unzipSync(bytes))).toEqual(["word/document.xml"]);
  });

  it("is byte-for-byte deterministic: the same book exported twice is the same file", () => {
    const entries = [{ path: "a.txt", data: "same" }];
    expect(zipPackage(entries, "text/plain")).toEqual(
      zipPackage(entries, "text/plain"),
    );
  });
});
