// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  emptyCatalogue,
  hashesFor,
  readCatalogue,
  serializeCatalogue,
  withBinnedSnapshot,
  withHashes,
  withRecords,
  withoutBinnedSnapshot,
} from "./snapshotCatalogue";
import type { DocumentStructure, Snapshot } from "./types";

// The file that says which files are snapshots: refused when it is missing or
// broken, read leniently row by row, and holding no hash.

const AT = "2026-01-01T00:00:00.000Z";
const record = (file: string, title = "One"): Snapshot => ({
  file,
  title,
  created: AT,
});

const structure = (snapshots: Snapshot[]): DocumentStructure =>
  ({
    children: [
      {
        kind: "section",
        id: "EL1",
        title: "One",
        adopted: snapshots[0]?.file ?? "",
        snapshots,
      },
    ],
  }) as unknown as DocumentStructure;

describe("reading the catalogue", () => {
  it("refuses a missing file, never reading it as one with no snapshots", () => {
    expect(readCatalogue(null)).toEqual({
      ok: false,
      error: { code: "missingCatalogue" },
    });
  });

  it("refuses a file that is not JSON, or whose blocks are not maps", () => {
    for (const raw of ["{", "[]", "3", '{"snapshots": []}', '{"binned": 1}'])
      expect(readCatalogue(raw)).toEqual({
        ok: false,
        error: { code: "catalogueParse" },
      });
  });

  it("drops a malformed row and keeps the rest, with no hash", () => {
    const read = readCatalogue(
      JSON.stringify({
        snapshots: {
          EL1: [
            { ...record("section--a.EL1.00.md"), contentHash: "a".repeat(64) },
            { file: "section--a.EL1.01.md", title: "No date" },
            { title: "no file", created: AT },
            "nope",
          ],
          EL2: "not a list",
        },
        binned: {},
      }),
    );
    expect(read).toEqual({
      ok: true,
      catalogue: {
        snapshots: { EL1: [record("section--a.EL1.00.md")] },
        binned: {},
      },
    });
  });

  it("round-trips what it writes", () => {
    const catalogue = withBinnedSnapshot(
      withRecords(
        emptyCatalogue(),
        structure([record("section--a.EL1.00.md")]),
      ),
      "EL1",
      record("section--a.EL1.01.md", "Two"),
    );
    expect(readCatalogue(serializeCatalogue(catalogue))).toEqual({
      ok: true,
      catalogue,
    });
  });
});

describe("the records", () => {
  it("takes the live records from the structure without their hashes, the bin kept", () => {
    const binned = withBinnedSnapshot(
      emptyCatalogue(),
      "EL1",
      record("section--a.EL1.01.md"),
    );
    const next = withRecords(
      binned,
      structure([
        { ...record("section--a.EL1.00.md"), contentHash: "a".repeat(64) },
      ]),
    );
    expect(next).toEqual({
      snapshots: { EL1: [record("section--a.EL1.00.md")] },
      binned: binned.binned,
    });
  });

  it("bins one row per file, however often it is put back", () => {
    const one = record("section--a.EL1.01.md");
    const twice = withBinnedSnapshot(
      withBinnedSnapshot(emptyCatalogue(), "EL1", one),
      "EL1",
      { ...one, title: "Renamed" },
    );
    expect(twice.binned).toEqual({ EL1: [{ ...one, title: "Renamed" }] });
  });

  it("keeps a binned record with its node, and drops the entry once empty", () => {
    const one = record("section--a.EL1.01.md");
    const other = record("section--a.EL1.02.md", "Two");
    const binned = withBinnedSnapshot(
      withBinnedSnapshot(emptyCatalogue(), "EL1", one),
      "EL1",
      other,
    );
    expect(withoutBinnedSnapshot(binned, "EL1", one.file).binned).toEqual({
      EL1: [other],
    });
    expect(
      withoutBinnedSnapshot(
        withoutBinnedSnapshot(binned, "EL1", one.file),
        "EL1",
        other.file,
      ).binned,
    ).toEqual({});
  });
});

describe("the hashes", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);

  it("joins each file's stored hash to its record, and leaves the others", () => {
    expect(
      withHashes(
        {
          EL1: [record("section--a.EL1.00.md"), record("section--a.EL1.01.md")],
        },
        { "section--a.EL1.00.md": A },
      ),
    ).toEqual({
      EL1: [
        { ...record("section--a.EL1.00.md"), contentHash: A },
        record("section--a.EL1.01.md"),
      ],
    });
  });

  it("keeps a newer stored hash, fills a new file's, and drops a file that is gone", () => {
    const shape = structure([
      { ...record("section--a.EL1.00.md"), contentHash: A },
      { ...record("section--a.EL1.01.md"), contentHash: A },
    ]);
    expect(
      hashesFor(
        { "section--a.EL1.00.md": B, "section--gone.EL9.00.md": B },
        shape,
      ),
    ).toEqual({ "section--a.EL1.00.md": B, "section--a.EL1.01.md": A });
  });
});
