// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { CATALOGUE } from "./referenceCatalogue";
import {
  extractableRecords,
  extractionChunks,
  placeInFile,
  recordHeader,
  statusWithin,
} from "./referenceExtraction";
import { parseReference } from "./referenceRecords";

// A reference document as the fact reader is shown it.

const page = (id: string) => {
  const found = CATALOGUE.get(id);
  if (!found) throw new Error(id);
  return found;
};

const CONTINUITY = [
  "# Continuity",
  "- **Names and terms:** the harbour is the Mouth",
  "- **Dates and ages:** Marta is 34 in 2011",
  "- **Relationships and other facts:** odd chapters are one life, even chapters another",
  "- **Open questions:** does Marta stay a doctor?",
  "- **Contradictions to resolve:** her eyes are green in chapter four",
].join("\n");

describe("extractionChunks", () => {
  it("shows the reader only what a fact may be read from: never an open question or a known contradiction", () => {
    const parsed = parseReference(CONTINUITY, page("guidebook:continuity"));
    const [chunk, ...rest] = extractionChunks(parsed, 6_000);
    expect(rest).toEqual([]);
    expect(chunk.text).toContain("the harbour is the Mouth");
    expect(chunk.text).toContain("Marta is 34 in 2011");
    expect(chunk.text).not.toContain("does Marta stay a doctor?");
    expect(chunk.text).not.toContain("green in chapter four");
    expect(chunk.text).toContain("[Names and terms — ESTABLISHED]");
  });

  it("names the field, its role and whose page it is, with the catalogue's note", () => {
    // "On her page", never "about her": a header saying "about Hollis" lets
    // the reader file her father's tenure, which her relationships answer
    // states, as hers.
    const parsed = parseReference(
      "- **Names and nicknames:** Marta\n- **Looks:** grey\n",
      page("character"),
      "Marta Neri",
    );
    expect(parsed.records.map(recordHeader)).toEqual([
      "[Names and nicknames — ESTABLISHED, on Marta Neri's page] Every name the person goes by. A name here is the person's own, never a relation's.",
      "[Looks — OTHER NOTES, on Marta Neri's page]",
    ]);
    // A block is what its records are about: a place's access is the place's.
    const places = parseReference(
      "## The Harbour\n- **Visitors and access:** only by boat\n",
      page("world:locations"),
    );
    expect(places.records.map(recordHeader)[0]).toContain("about The Harbour]");
  });

  it("maps every answer line to exactly the text it stands for in the file", () => {
    const text =
      "- **Fears:** the sea\n- **Appearance:**\n  - grey eyes\r\n  - a scar\n";
    const parsed = parseReference(text, page("character"), "Marta");
    const [chunk] = extractionChunks(parsed, 6_000);
    expect(
      chunk.segments.map((one) => chunk.text.slice(one.at, one.end)),
    ).toEqual(["grey eyes", "a scar"]);
    for (const one of chunk.segments)
      expect(text.slice(one.readAt, one.readAt + one.end - one.at)).toBe(
        chunk.text.slice(one.at, one.end),
      );
  });

  it("never splits a record from its line: a long one repeats it in every chunk", () => {
    const lines = Array.from(
      { length: 6 },
      (_, at) => `  - event ${at} ${"x".repeat(40)}`,
    );
    const parsed = parseReference(
      [
        "- **Formative experiences:**",
        ...lines,
        "- **Age and date of birth:** 34",
      ].join("\n"),
      page("character"),
      "Marta",
    );
    const chunks = extractionChunks(parsed, 160);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("[")).toBe(true);
      for (const one of chunk.segments)
        expect(chunk.text.slice(0, one.at)).toContain(recordHeader(one.record));
    }
    expect(chunks.flatMap((one) => one.segments)).toHaveLength(7);
  });

  it("makes nothing of a page whose answers may not be read for facts", () => {
    const parsed = parseReference(
      "- **Fears:** the sea\n- **The unconscious need:** home\n",
      page("character"),
      "Marta",
    );
    expect(extractableRecords(parsed)).toEqual([]);
    expect(extractionChunks(parsed, 6_000)).toEqual([]);
  });
});

describe("placeInFile", () => {
  it("places identical words under two fields each in its own field, and a header or a run across two answers nowhere", () => {
    const text =
      "- **Appearance:** grey, like her father\n- **Details to remember:** grey, like her father\n";
    const parsed = parseReference(text, page("character"), "Marta");
    const [chunk] = extractionChunks(parsed, 6_000);
    const first = chunk.text.indexOf("grey, like");
    const second = chunk.text.lastIndexOf("grey, like");
    expect(placeInFile(chunk, first, first + 4)).toMatchObject({
      at: text.indexOf("grey, like"),
      record: { field: { id: "appearance" } },
    });
    expect(placeInFile(chunk, second, second + 4)).toMatchObject({
      at: text.lastIndexOf("grey, like"),
      record: { field: { id: "details" } },
    });
    const header = chunk.text.indexOf("Appearance");
    expect(placeInFile(chunk, header, header + 5)).toBeNull();
    expect(placeInFile(chunk, first, second + 4)).toBeNull();
  });
});

describe("statusWithin", () => {
  const records = parseReference(
    "- **Age and date of birth:** 34\n- **Crisis. The decisive moment:** she leaves\n",
    null,
  );
  const arc = parseReference(
    "- **Crisis. The decisive moment:** she leaves\n",
    page("arc"),
    "Marta",
  );
  const fact = parseReference(
    "- **Age and date of birth:** 34\n",
    page("character"),
    "Marta",
  );

  it("holds a plan field's claims at planned, or open when the reader said open", () => {
    const [crisis] = arc.records;
    expect(statusWithin(crisis, "stated")).toBe("planned");
    expect(statusWithin(crisis, "believed")).toBe("planned");
    expect(statusWithin(crisis, "open")).toBe("open");
  });

  it("never promotes a claim: a fact field keeps a belief or a doubt as the reader read it", () => {
    const [age] = fact.records;
    expect(statusWithin(age, "believed")).toBe("believed");
    expect(statusWithin(age, "open")).toBe("open");
    expect(statusWithin(age, "planned")).toBe("planned");
    expect(statusWithin(age, "stated")).toBe("stated");
    // A line no page places keeps its words' status; the ledger marks it.
    for (const one of records.records)
      expect(statusWithin(one, "stated")).toBe("stated");
  });
});
