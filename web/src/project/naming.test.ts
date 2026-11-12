// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  ASSISTANT_DIR,
  DOCUMENT_DIR,
  ID_PREFIX,
  REFERENCE_DIR,
  APP_CACHE_DIR,
  folderNameFor,
  kindOf,
  nextId,
  parseSnapshotName,
  referenceFileName,
  snapshotFileName,
  toSlug,
  validateProjectName,
  titleProblem,
  validateReferenceName,
} from "./naming";

describe("file names and kinds", () => {
  it("reads the kind off the prefix", () => {
    expect(kindOf("part--act_one.00.md")).toBe("part");
    expect(kindOf("section--opening.00.md")).toBe("section");
    expect(kindOf("opening.md")).toBeNull();
    expect(kindOf("part--act-one.txt")).toBeNull();
    expect(kindOf("document-properties.json")).toBeNull();
  });

  it("leaves the snapshot counter to the shape parser", () => {
    expect(kindOf("part--act_one.md")).toBe("part");
  });
});

// The assistant's configuration and the writer's reference material sit beside
// `document/` as a freeform space. Validation never mistakes anything in them
// for a Part or a Section; otherwise a persona file would read as prose the
// yaml forgot to list, and the document would refuse to open.
describe("the freeform folders stay outside the prose spine", () => {
  it("keeps them clear of the document folder", () => {
    for (const dir of [ASSISTANT_DIR, REFERENCE_DIR, APP_CACHE_DIR]) {
      expect(dir.startsWith(`${DOCUMENT_DIR}/`)).toBe(false);
      expect(dir).not.toBe(DOCUMENT_DIR);
    }
  });

  it("never reads a file in them as a document node", () => {
    const names = [
      "lena.md",
      "rules.md",
      "bible.md",
      "part--not-really.00.md",
      "section--also-not.00.md",
    ];
    for (const name of names) {
      expect(kindOf(`${ASSISTANT_DIR}/personas/${name}`)).toBeNull();
      expect(kindOf(`${REFERENCE_DIR}/characters/${name}`)).toBeNull();
    }
  });
});

// ── The slug ─────────────────────────────────────────────────────────────────
//
// The one transliteration core every file name in the document derives from.
// Letters and digits from any script survive (the app ships in Italian);
// apostrophes join; everything else, spaces, punctuation and every path
// separator, becomes the separator. No dots survive, so the snapshot `.xy`
// counter's position is deterministic.
describe("toSlug", () => {
  it("transliterates a display name to a stem", () => {
    expect(toSlug("My Section")).toBe("my_section");
    expect(toSlug("  My   Section  ")).toBe("my_section");
  });

  it("turns punctuation into separators rather than rejecting it", () => {
    expect(toSlug("Salt: A Novel")).toBe("salt_a_novel");
    expect(toSlug("What the Quarry Kept?")).toBe("what_the_quarry_kept");
    expect(toSlug("Vol. 1 — Ash")).toBe("vol_1_ash");
  });

  it("joins on an apostrophe rather than splitting", () => {
    expect(toSlug("L'Isola")).toBe("lisola");
    expect(toSlug("L’Isola Più Lontana")).toBe("lisola_più_lontana");
  });

  it("keeps letters from any script", () => {
    expect(toSlug("Perché No")).toBe("perché_no");
    expect(toSlug("Война и мир")).toBe("война_и_мир");
  });

  it("is empty when there is nothing usable in the title", () => {
    expect(toSlug("???")).toBe("");
    expect(toSlug("   ")).toBe("");
  });

  // A 120-character title is 360 bytes in a three-byte script, and ext4
  // refuses a file name over 255 bytes.
  it("keeps a node's file name and its journal within 255 bytes", () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    for (const title of ["山".repeat(120), "é".repeat(120), "😀".repeat(60)]) {
      const name = snapshotFileName("section", toSlug(title), "EL99999", 100);
      expect(bytes(`${name}.json`)).toBeLessThanOrEqual(255);
      expect(bytes(folderNameFor(title))).toBeLessThanOrEqual(255);
    }
  });

  it("cuts a long slug on a whole character, with no separator left over", () => {
    const slug = toSlug(`${"ab ".repeat(66)}山山山`);
    expect(slug.endsWith("_")).toBe(false);
    expect(slug).toBe(toSlug(slug));
  });
});

describe("folderNameFor", () => {
  it("makes a folder name out of a title", () => {
    expect(folderNameFor("Once Dark")).toBe("once-dark");
    expect(folderNameFor("  Hollow   Water  ")).toBe("hollow-water");
  });

  // The same transliteration joined with `-`: one core algorithm, two
  // separators, which must never drift.
  it("uses the same core as toSlug, with a different separator", () => {
    expect(folderNameFor("My Section")).toBe("my-section");
    expect(folderNameFor("L'Isola")).toBe("lisola");
  });
});

// ── Snapshot file names ──────────────────────────────────────────────────────
//
// `prefix--slug.id.xy.md`: the slug is the transliterated display name, a
// label; the id is the node's own and anchors the file to it; and the
// counter, zero-padded to at least two digits, makes the node's snapshots
// unique. The shape test is the reader-side guard: a name that fails
// `parseSnapshotName` is never written to.
describe("snapshot file names", () => {
  it("builds a name from a kind, slug, node id and counter", () => {
    expect(snapshotFileName("section", "my_section", "EL2", 0)).toBe(
      "section--my_section.EL2.00.md",
    );
    expect(snapshotFileName("part", "act_one", "EL1", 11)).toBe(
      "part--act_one.EL1.11.md",
    );
    // Counters past 99 keep their width: they are integers, not a fixed field.
    expect(snapshotFileName("section", "my_section", "EL2", 100)).toBe(
      "section--my_section.EL2.100.md",
    );
  });

  it("parses a name back into its kind, slug, node id and counter", () => {
    expect(parseSnapshotName("section--my_section.EL2.01.md")).toEqual({
      kind: "section",
      slug: "my_section",
      id: "EL2",
      xy: 1,
    });
    expect(parseSnapshotName("part--act_one.EL1.100.md")?.xy).toBe(100);
    // The empty slug a "???" title produces is still a name; the id carries
    // it.
    expect(parseSnapshotName("part--.EL3.00.md")).toEqual({
      kind: "part",
      slug: "",
      id: "EL3",
      xy: 0,
    });
  });

  it("refuses shapes that are not a snapshot's", () => {
    expect(parseSnapshotName("section--my_section.EL2.md")).toBeNull();
    expect(parseSnapshotName("section--my.section.EL2.01.md")).toBeNull();
    expect(parseSnapshotName("section--my_section.EL2.1.md")).toBeNull();
    expect(parseSnapshotName("section--my_section.EL2.01.txt")).toBeNull();
    expect(parseSnapshotName("notes.txt")).toBeNull();
    expect(parseSnapshotName("../escape.EL1.00.md")).toBeNull();
    expect(
      parseSnapshotName("section--my_section.EL2.01.md.EL2.02.md"),
    ).toBeNull();
  });

  // A name without the node id is not a snapshot's. Nothing reads
  // that shape, so a project named that way does not open.
  it("refuses the old name shape that carried no node id", () => {
    expect(parseSnapshotName("section--my_section.01.md")).toBeNull();
    expect(parseSnapshotName("part--act_one.100.md")).toBeNull();
  });

  it("refuses an id that is not the strict EL shape", () => {
    expect(parseSnapshotName("section--a.el2.00.md")).toBeNull();
    expect(parseSnapshotName("section--a.EL.00.md")).toBeNull();
    expect(parseSnapshotName("section--a.X2.00.md")).toBeNull();
  });

  it("refuses a path escape even though the validator could not have produced one", () => {
    expect(parseSnapshotName("../escape.00.md")).toBeNull();
    expect(parseSnapshotName("..\\escape.00.md")).toBeNull();
  });
});

// ── Node ids ─────────────────────────────────────────────────────────────────
//
// `EL<n>` is the stable, human-readable identity: created as max+1, immutable
// for the node's life, visible only in the yaml. Gaps after deletion are fine;
// an id is never reused, because a removed node's id stays occupied.
describe("node ids", () => {
  it("makes the next id from a sequence", () => {
    expect(nextId([])).toBe(`${ID_PREFIX}1`);
    expect(nextId(["EL1", "EL3"])).toBe(`${ID_PREFIX}4`);
    expect(nextId(["EL399"])).toBe(`${ID_PREFIX}400`);
  });

  it("ignores anything that is not an id", () => {
    expect(nextId(["act-one", "", "el2"])).toBe(`${ID_PREFIX}1`);
  });
});

describe("titleProblem", () => {
  const check = (name: string) => titleProblem(name)?.code ?? null;

  it("accepts an ordinary name", () => {
    expect(check("the storm")).toBeNull();
    expect(check("winter's end")).toBeNull();
    expect(check("chapter 12")).toBeNull();
  });

  it("reports an empty field without a message worth showing", () => {
    expect(check("")).toBe("empty");
    expect(check("   ")).toBe("empty");
  });

  // Titles are free: the file name carries the node's id and its
  // slug strips what a platform objects to, so each of these is the writer's
  // call.
  it("accepts the punctuation a file name could not hold", () => {
    for (const fine of [
      "Chapter 1: The Storm",
      "Why?",
      'The "Last" Night',
      "Before/After",
      "a\\b",
      "a*b",
      "<Prologue>",
      "Either | Or",
    ]) {
      expect(check(fine)).toBeNull();
    }
  });

  it("accepts a name that starts like a file prefix", () => {
    expect(check("section--opening")).toBeNull();
    expect(check("part--act-one")).toBeNull();
  });

  it("accepts a trailing dot and a name Windows reserves", () => {
    expect(check("And then.")).toBeNull();
    expect(check("con")).toBeNull();
    expect(check("NUL")).toBeNull();
  });

  it("rejects control characters, which are invisible while typing", () => {
    expect(check(`a${String.fromCharCode(9)}b`)).toBe("controlChars");
    expect(check(`a${String.fromCharCode(0)}b`)).toBe("controlChars");
    expect(check(`a${String.fromCharCode(10)}b`)).toBe("controlChars");
  });

  it("accepts a trailing space, because the title is trimmed", () => {
    expect(check("chapter one ")).toBeNull();
  });

  it("rejects a name longer than the limit", () => {
    expect(check("x".repeat(121))).toBe("tooLong");
    expect(check("x".repeat(120))).toBeNull();
  });
});

describe("validateReferenceName", () => {
  const taken = new Set(["guidebook--the-ferry.md", "character--maren.md"]);
  const check = (name: string, prefix = "guidebook--") =>
    validateReferenceName(name, prefix, taken)?.code ?? null;

  it("builds a full file name from a group prefix", () => {
    expect(referenceFileName("guidebook--", "The Ferry")).toBe(
      "guidebook--The Ferry.md",
    );
    expect(referenceFileName("character--", "  maren  ")).toBe(
      "character--maren.md",
    );
  });

  it("accepts an ordinary name", () => {
    expect(check("the winter house")).toBeNull();
    expect(check("ferry timetables", "notes--")).toBeNull();
  });

  it("rejects the characters Windows forbids", () => {
    expect(check("a/b")).toBe("illegalChars");
    expect(check("a:b")).toBe("illegalChars");
  });

  it("rejects a name that repeats any Phospheare prefix", () => {
    expect(check("guidebook--x")).toBe("noPrefix");
    expect(check("character--maren", "character--")).toBe("noPrefix");
  });

  it("rejects a duplicate file name, however it was typed", () => {
    expect(check("the-ferry")).toBe("duplicate");
    expect(check("THE-FERRY")).toBe("duplicate");
  });

  it("allows the same title in different groups — different files", () => {
    expect(check("maren", "character--")).toBe("duplicate");
    expect(check("maren", "notes--")).toBeNull();
  });

  it("rejects a name Windows reserves", () => {
    expect(check("con")).toBe("reserved");
    expect(check("nul.draft")).toBe("reserved");
  });

  // The title is the file name, and ext4 caps a name at 255 bytes.
  it("rejects a name whose file would pass 255 bytes", () => {
    expect(check("山".repeat(80), "character--")).toBeNull();
    expect(check("山".repeat(100), "character--")).toBe("tooLongForFile");
  });
});

describe("validateProjectName", () => {
  const taken = new Set(["once-dark"]);
  const check = (raw: string) => validateProjectName(raw, taken)?.code ?? null;

  it("accepts an ordinary title", () => {
    expect(check("Hollow Water")).toBeNull();
  });

  it("says nothing about an empty field", () => {
    expect(check("")).toBe("empty");
    expect(check("   ")).toBe("empty");
  });

  // The characters a file name rejects do not survive `folderNameFor`, so
  // refusing them here would refuse a usable title.
  it("allows characters a node name would refuse", () => {
    expect(check("Salt: A Novel")).toBeNull();
    expect(check("Who? What?")).toBeNull();
  });

  it("refuses a title that yields no folder name at all", () => {
    expect(check("???")).toBe("noFolderName");
  });

  it("refuses a folder name Windows reserves", () => {
    expect(check("CON")).toBe("reserved");
    expect(check("Aux")).toBe("reserved");
    expect(check("Console")).toBeNull();
  });

  // `toSlug` keeps a superscript digit, and Windows reserves `COM¹` as it
  // does `COM1`; the export's file name check refuses the same list.
  it("refuses a device name spelled with a superscript digit", () => {
    expect(check("COM¹")).toBe("reserved");
    expect(check("lpt³")).toBe("reserved");
    expect(check("COM⁴")).toBeNull();
  });

  it("refuses a folder that already exists, however it was typed", () => {
    expect(check("Once Dark")).toBe("folderTaken");
    expect(check("once dark")).toBe("folderTaken");
    expect(check("Once Dark!")).toBe("folderTaken");
  });

  it("refuses a title longer than the limit", () => {
    expect(check("x".repeat(121))).toBe("tooLong");
  });
});
