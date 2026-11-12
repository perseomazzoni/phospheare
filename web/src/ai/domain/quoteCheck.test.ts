// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  QUOTE_MIN,
  UNFOUND_MAX,
  quotedPassages,
  unfoundQuotes,
} from "./quoteCheck";

// Three near-misses a hand check found among a chat's quotations, and the
// text they came from.
const BOOK = [
  "Quello era l'**Elisir**: la conquista di un bambino.",
  "Sentii una lacrima. Il legno si era macchiato, dove la mia dita sporca la aveva sfiorata.",
  "La *Chiamata all'Avventura* era arrivata. «No.» Mi tirai indietro sul letto.",
];

describe("the quotations an answer makes", () => {
  it("takes a blockquote whole, without its closing id or outer marks", () => {
    expect(
      quotedPassages(
        "Intro.\n\n> «Mi tirai indietro sul letto, appoggiando le spalle al muro. «No.»» node:EL6\n\nAfter.",
      ),
    ).toEqual([
      "Mi tirai indietro sul letto, appoggiando le spalle al muro. «No.»",
    ]);
    expect(
      quotedPassages(
        "> The first line of a long quotation\n> and its second line.\n> reference:guidebook--brief.md",
      ),
    ).toEqual(["The first line of a long quotation and its second line."]);
  });

  it("leaves out a source's name set after the quotation", () => {
    // Each of these is verbatim, so none may be flagged as not found.
    const quoted = "Mister Baffo, sentire nominare il suo nome, fece un salto.";
    expect(quotedPassages(`> ${quoted}\n> — Leo Bellini`)).toEqual([quoted]);
    expect(quotedPassages(`> «${quoted}» — Leo Bellini - 4`)).toEqual([quoted]);
    expect(quotedPassages(`> ${quoted} — Elena Valli - 4`)).toEqual([quoted]);
    expect(quotedPassages(`> ${quoted} (Leo Bellini - 3)`)).toEqual([quoted]);
  });

  it("reads two quotations in one blockquote as two", () => {
    expect(
      quotedPassages(
        "> «Erano circa le undici del mattino, disse.»\n> «Non attesi che arrivassero le dodici e quindici.» — Elena Valli - 3",
      ),
    ).toEqual([
      "Erano circa le undici del mattino, disse.",
      "Non attesi che arrivassero le dodici e quindici.",
    ]);
  });

  it("takes an inline passage, and leaves a name or a title alone", () => {
    expect(
      quotedPassages(
        "Leo says «Avevo vinto la mia battaglia, davvero» and «Mister Baffo» purrs; see “The Story Promise”.",
      ),
    ).toEqual(["Avevo vinto la mia battaglia, davvero"]);
    expect("Mister Baffo".length).toBeLessThan(QUOTE_MIN);
  });

  it("never reads a diagram as a quotation", () => {
    expect(
      quotedPassages('```text\n"a long label inside a diagram block"\n```'),
    ).toEqual([]);
  });
});

describe("the quotations whose words were not read", () => {
  it("forgives the apostrophe, the emphasis, the case and the marks", () => {
    const answer = [
      "> «Quello era l’**Elisir**: la conquista di un bambino.» node:EL15",
      "",
      "Lumi: «La mia dita sporca la aveva sfiorata» (node:EL10).",
      "",
      "> La Chiamata all'Avventura era arrivata. «No.» node:EL5",
    ].join("\n");
    expect(unfoundQuotes(answer, BOOK)).toEqual([]);
  });

  it("follows a marked elision, in order", () => {
    expect(
      unfoundQuotes(
        "> «Sentii una lacrima. […] dove la mia dita sporca la aveva sfiorata.» node:EL10",
        BOOK,
      ),
    ).toEqual([]);
    // The same pieces in the wrong order are not the book's sentence.
    expect(
      unfoundQuotes(
        "> «dove la mia dita sporca la aveva sfiorata … Sentii una lacrima.» node:EL10",
        BOOK,
      ),
    ).toHaveLength(1);
  });

  it("reports a quotation whose words are not there, once, as written", () => {
    const invented = "La mamma tornò prima di mezzogiorno, felice";
    expect(
      unfoundQuotes(`«${invented}» e poi ancora «${invented}».`, BOOK),
    ).toEqual([invented]);
  });

  it("keeps at most a bounded number", () => {
    const many = Array.from(
      { length: UNFOUND_MAX + 5 },
      (_, index) => `«A sentence the book never held, number ${index}»`,
    ).join(" ");
    expect(unfoundQuotes(many, BOOK)).toHaveLength(UNFOUND_MAX);
  });
});
