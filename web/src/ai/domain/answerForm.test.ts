// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { mendTables } from "./answerForm";
import { unfoundQuotes } from "./quoteCheck";

// A broken table as a model wrote it in a chat, trimmed.
const BROKEN = [
  "| Passaggio | Indizio | Valutazione |",
  "|---|---|---|",
  "| Vigilia | > «Era il 2 settembre 2024.» node:EL4 | Coerente. |",
  "| Uscita | > «La luce del sole del mezzogiorno ci investì tutti insieme.» node:EL12 |",
  "> «I cancelli di ferro verde si spalancarono alle dodici e quindici precise» node:EL13 | **Chiarezza:** l'ordine non è allineato. |",
  "| Ritorno | «Il sole del tardo pomeriggio filtrava tra i rami» node:EL15 | Coerente. |",
].join("\n");

describe("mendTables", () => {
  it("drops a cell's blockquote marker and joins a row broken across lines", () => {
    const mended = mendTables(BROKEN).split("\n");
    expect(mended).toHaveLength(5);
    expect(mended[2]).toBe(
      "| Vigilia | «Era il 2 settembre 2024.» node:EL4 | Coerente. |",
    );
    expect(mended[3]).toBe(
      "| Uscita | «La luce del sole del mezzogiorno ci investì tutti insieme.» node:EL12 «I cancelli di ferro verde si spalancarono alle dodici e quindici precise» node:EL13 | **Chiarezza:** l'ordine non è allineato. |",
    );
    expect(mended[4]).toBe(mended[4]?.trimStart());
  });

  it("joins a row run over plain and quoted lines until it has its cells", () => {
    const broken = [
      "| Where | Says | Verdict |",
      "|---|---|---|",
      "| One | «The coat was red.» node:A",
      "> «The coat was blue.» node:B",
      "and nothing explains it. | A slip. |",
      "| Two | «Fine.» node:C | Holds. |",
    ].join("\n");
    expect(mendTables(broken).split("\n")).toEqual([
      "| Where | Says | Verdict |",
      "|---|---|---|",
      "| One | «The coat was red.» node:A «The coat was blue.» node:B and nothing explains it. | A slip. |",
      "| Two | «Fine.» node:C | Holds. |",
    ]);
  });

  it("drops a blank line between two rows of one table, and keeps the one that ends it", () => {
    const broken = [
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "| 3 | 4 |",
      "",
      "After the table.",
    ].join("\n");
    expect(mendTables(broken).split("\n")).toEqual([
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "| 3 | 4 |",
      "",
      "After the table.",
    ]);
    // A complete row followed by prose after a blank is not a broken row.
    const whole = "| A | B |\n|---|---|\n| 1 | 2 |\n\nProse | with a bar.";
    expect(mendTables(whole)).toBe(whole);
  });

  it("leaves a blockquote, a code block and plain prose alone", () => {
    const prose = [
      "> «A line quoted on its own.» node:S1",
      "",
      "```",
      "| a | > b |",
      "```",
      "A sentence with a | in it.",
    ].join("\n");
    expect(mendTables(prose)).toBe(prose);
  });

  it("lets the quotation check read a mended row's quotations one by one", () => {
    const book = [
      "Era il 2 settembre 2024.",
      "La luce del sole del mezzogiorno ci investì tutti insieme.",
      "I cancelli di ferro verde si spalancarono alle dodici e quindici precise con un cigolio.",
      "Il sole del tardo pomeriggio filtrava tra i rami del melo.",
    ];
    expect(unfoundQuotes(BROKEN, book)).toEqual([]);
  });
});
