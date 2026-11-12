// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { LENSES } from "./craft";
import {
  OBSESSIONS,
  domainName,
  obsessionById,
  parseObsessions,
} from "./obsessions";
import { DETECTOR_IDS } from "./signals/detect";

const LENS = new Set(["arc"]);
const DETECT = new Set(["hedges"]);

const doc = (...lines: string[]) => lines.join("\n");
const one = doc(
  "preamble the reader skips",
  "## B — Structure",
  "### B.causality",
  "notices: and-then chains",
  "asks: Why does this follow?",
  "severity: contract",
  "lens: arc",
  "",
  "## F — Prose",
  "### F.hedge",
  "notices: qualifiers",
  "asks: Is it almost?",
  "signals: almost, rather",
  "exceptions: dialogue",
  "severity: craft",
  "detector: hedges",
);

describe("the obsession catalogue", () => {
  it("reads domains and entries, with their optional fields", () => {
    const catalogue = parseObsessions(one, LENS, DETECT);
    expect(catalogue.domains).toEqual([
      { letter: "B", name: "Structure" },
      { letter: "F", name: "Prose" },
    ]);
    expect(catalogue.obsessions).toEqual([
      {
        id: "B.causality",
        domain: "B",
        notices: "and-then chains",
        asks: "Why does this follow?",
        severity: "contract",
        lens: "arc",
      },
      {
        id: "F.hedge",
        domain: "F",
        notices: "qualifiers",
        asks: "Is it almost?",
        signals: "almost, rather",
        exceptions: "dialogue",
        severity: "craft",
        detector: "hedges",
      },
    ]);
    expect(obsessionById(catalogue, "F.hedge").detector).toBe("hedges");
    expect(() => obsessionById(catalogue, "Z.none")).toThrow(/no Z.none/);
    expect(domainName(catalogue, "B")).toBe("Structure");
    expect(() => domainName(catalogue, "Q")).toThrow(/no domain Q/);
  });

  it("refuses every malformed shape, naming it", () => {
    const at = (text: string) => () => parseObsessions(text, LENS, DETECT);
    expect(at("## B — Structure")).toThrow(/none declared/);
    expect(at(doc("## B — S", "## B — T"))).toThrow(/declared twice/);
    expect(at(doc("## B — S", "### causality"))).toThrow(/not <letter>/);
    expect(at(doc("### B.one", "notices: x"))).toThrow(/outside its domain/);
    expect(at(doc("## B — S", "### F.one"))).toThrow(/outside its domain/);
    const base = ["## B — S", "### B.one", "notices: n", "asks: a"];
    expect(at(doc(...base, "severity: craft", "### B.one"))).toThrow(
      /declared twice/,
    );
    expect(at(doc(...base, "severity craft"))).toThrow(/bad line/);
    expect(at(doc(...base, "tone: warm"))).toThrow(/unknown key "tone"/);
    expect(at(doc(...base, "asks: again"))).toThrow(/asks declared twice/);
    expect(at(doc(...base))).toThrow(/missing severity/);
    expect(at(doc(...base, "severity: fatal"))).toThrow(/unknown severity/);
    expect(at(doc(...base, "severity: craft", "lens: plot"))).toThrow(
      /no lens "plot"/,
    );
    expect(at(doc(...base, "severity: craft", "detector: rhyme"))).toThrow(
      /no detector "rhyme"/,
    );
    expect(
      at(doc("## B — S", "### B.one", "asks: a", "severity: craft")),
    ).toThrow(/missing notices/);
  });

  it("ships a catalogue whose every lens and detector exists", () => {
    // The shipped file is parsed at module load against the real folders, so
    // importing it at all is the check; these say what it holds.
    expect(OBSESSIONS.obsessions.length).toBeGreaterThan(100);
    for (const entry of OBSESSIONS.obsessions) {
      if (entry.lens) expect(LENSES.has(entry.lens)).toBe(true);
      if (entry.detector) expect(DETECTOR_IDS.has(entry.detector)).toBe(true);
    }
    // Every detector finds candidates for some obsession: a detector nobody
    // holds would run for nobody.
    const held = new Set(OBSESSIONS.obsessions.map((entry) => entry.detector));
    for (const id of DETECTOR_IDS) expect(held.has(id)).toBe(true);
  });
});
