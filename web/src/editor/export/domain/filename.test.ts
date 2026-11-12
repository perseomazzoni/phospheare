// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MAX_NAME_LENGTH,
  defaultExportName,
  exportTimestamp,
  numberedName,
  sanitizeFileName,
} from "./filename";

const WORDS = { references: "References", notes: "Notes" };
// Local time, because the writer reads the name in their own day.
const AT = new Date(2026, 9, 1, 9, 5, 7, 42);

describe("the proposed export name", () => {
  // To the second: a taken name becomes `name (2)`, so the clock does not
  // have to make it unique, and the writer reads it.
  it("stamps the local time to the second, with no colon a disk refuses", () => {
    expect(exportTimestamp(AT)).toBe("2026-10-01 09-05-07");
  });

  it("is the title alone for the manuscript", () => {
    expect(
      defaultExportName(
        "Once Dark",
        { manuscript: true, references: false, notes: false },
        WORDS,
        AT,
      ),
    ).toBe("Once Dark 2026-10-01 09-05-07");
  });

  it("adds a word for each further area, references before notes", () => {
    expect(
      defaultExportName(
        "Once Dark",
        { manuscript: true, references: true, notes: false },
        WORDS,
        AT,
      ),
    ).toBe("Once Dark References 2026-10-01 09-05-07");
    expect(
      defaultExportName(
        "Once Dark",
        { manuscript: true, references: true, notes: true },
        WORDS,
        AT,
      ),
    ).toBe("Once Dark References Notes 2026-10-01 09-05-07");
    // The same rule for any other combination: the words say what is
    // inside.
    expect(
      defaultExportName(
        "Once Dark",
        { manuscript: false, references: false, notes: true },
        WORDS,
        AT,
      ),
    ).toBe("Once Dark Notes 2026-10-01 09-05-07");
  });

  it("is sanitised like anything the writer types", () => {
    expect(
      defaultExportName(
        "What/If: Part 2?",
        { manuscript: true, references: false, notes: false },
        WORDS,
        AT,
      ),
    ).toBe("What If Part 2 2026-10-01 09-05-07");
  });
});

describe("a typed file name", () => {
  it("loses every character a common filesystem refuses", () => {
    expect(sanitizeFileName('a\\b/c:d*e?f"g<h>i|j')).toBe(
      "a b c d e f g h i j",
    );
    expect(sanitizeFileName("tab\there\u0000nul")).toBe("tab here nul");
  });

  it("cannot climb out of the export folder or hide itself", () => {
    expect(sanitizeFileName("../../secret")).toBe("secret");
    expect(sanitizeFileName("..")).toBe("");
    expect(sanitizeFileName(".hidden")).toBe("hidden");
  });

  it("drops the trailing dots and spaces Windows would strip behind our back", () => {
    expect(sanitizeFileName("draft. . ")).toBe("draft");
  });

  it("never names a device Windows reserves", () => {
    expect(sanitizeFileName("CON")).toBe("_CON");
    expect(sanitizeFileName("lpt1")).toBe("_lpt1");
    expect(sanitizeFileName("console")).toBe("console");
  });

  // Windows reads the part before the first dot, so `nul.tar` is the device
  // as much as `nul` is, whatever extension the format adds after.
  it("never names a device Windows reserves, whatever follows the first dot", () => {
    expect(sanitizeFileName("nul.tar")).toBe("_nul.tar");
    expect(sanitizeFileName("CON.backup")).toBe("_CON.backup");
    expect(sanitizeFileName("com\u00b9")).toBe("_com\u00b9");
    expect(sanitizeFileName("null.tar")).toBe("null.tar");
  });

  // A right-to-left override in a title makes `…fdp.exe` display as
  // `…exe.pdf` in a downloads list: legal on every disk, and a spoof.
  it("drops the C1 controls and the bidirectional overrides", () => {
    expect(sanitizeFileName("Salt\u202eRoads")).toBe("Salt Roads");
    expect(sanitizeFileName("a\u2066b\u2069c")).toBe("a b c");
    expect(sanitizeFileName("x\u0085y")).toBe("x y");
  });

  it("is empty when nothing usable is left, which disables Export", () => {
    expect(sanitizeFileName("  ///  ")).toBe("");
  });

  it("is bounded by code points and never splits a surrogate pair", () => {
    const long = "📖".repeat(MAX_NAME_LENGTH + 20);
    const name = sanitizeFileName(long);
    expect(Array.from(name)).toHaveLength(MAX_NAME_LENGTH);
    // No lone surrogate: the cut falls between two characters, never inside
    // one.
    expect(name).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
  });

  it("is composed (NFC), so the same title is one name on every disk", () => {
    expect(sanitizeFileName("Cafe\u0301")).toBe("Caf\u00e9");
  });
});

describe("a taken name", () => {
  it("is tried as itself first, then numbered from two", () => {
    expect(numberedName("Once Dark", 1)).toBe("Once Dark");
    expect(numberedName("Once Dark", 2)).toBe("Once Dark (2)");
  });
});
