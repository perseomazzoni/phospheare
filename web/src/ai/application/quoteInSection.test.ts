// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { ANCHOR_QUOTE_MAX, type SourceText } from "../domain/types";
import { acceptQuote, anchorOf, quoteFields } from "./quoteInSection";

// Pins the quote helpers every quoting step shares. `quoteInSection`
// is exercised through `/where` and `/map`; these pin the pieces a Section map
// reuses for its beat starts, so a start is taken on the same terms as a
// `/where` match.

const live = (text: string, revision = "r2"): SourceText => ({
  text,
  revision,
  origin: "project-file",
});

describe("anchorOf", () => {
  it("takes one paragraph of quote and drops context the model left empty", () => {
    expect(
      anchorOf("node:S1", { quote: "the gate", prefix: "", suffix: "at" }),
    ).toEqual({ sourceId: "node:S1", quote: "the gate", suffix: "at" });
  });

  it("refuses what the editor could not show as one passage", () => {
    expect(anchorOf("node:S1", { quote: 7 })).toBeNull();
    expect(anchorOf("node:S1", { quote: "  " })).toBeNull();
    expect(anchorOf("node:S1", { quote: "one\n\ntwo" })).toBeNull();
    expect(
      anchorOf("node:S1", { quote: "x".repeat(ANCHOR_QUOTE_MAX + 1) }),
    ).toBeNull();
  });
});

describe("acceptQuote", () => {
  const anchor = { sourceId: "node:S1", quote: "the gate" };

  it("keeps a quote read in the passage shown and still unique now, stamped", () => {
    expect(acceptQuote(anchor, "by the gate", live("so by the gate"))).toEqual({
      ...anchor,
      revision: "r2",
    });
  });

  it("refuses a quote the model was not shown, whatever the Section holds", () => {
    expect(acceptQuote(anchor, "by the wall", live("by the gate"))).toBeNull();
  });

  it("refuses a quote the writer has since repeated or removed", () => {
    expect(
      acceptQuote(anchor, "by the gate", live("the gate, the gate")),
    ).toBeNull();
    expect(acceptQuote(anchor, "by the gate", live("by the wall"))).toBeNull();
  });

  it("keeps only the context a repeat needs, nearest the quote", () => {
    const kept = acceptQuote(
      { ...anchor, prefix: "at dawn, " },
      "at dawn, the gate",
      live("the gate at noon, at dawn, the gate"),
    );
    expect(kept).toEqual({ ...anchor, prefix: "at dawn, ", revision: "r2" });
  });
});

describe("quoteFields", () => {
  it("describes the quote in the caller's words and the context in one set", () => {
    const fields = quoteFields("Copied exactly.");
    expect(fields.quote).toEqual({
      type: "string",
      description: "Copied exactly.",
    });
    expect(Object.keys(fields)).toEqual(["quote", "prefix", "suffix"]);
  });
});
