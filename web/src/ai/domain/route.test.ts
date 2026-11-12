// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { splitRoute } from "./route";

// The pointer to another chat, made a button: checked before it
// is offered, and never shown as text.

const SECTIONS = new Set(["s5", "s6"]);

describe("an answer's pointer to another chat", () => {
  it("takes the block out, and keeps a reader's Section the book holds", () => {
    expect(
      splitRoute(
        "A stranger would know.\n\n<room>beta-reader through node:s5</room>",
        "general",
        SECTIONS,
      ),
    ).toEqual({
      answer: "A stranger would know.",
      route: { kind: "beta-reader", through: "s5" },
    });
    // The bare id, and a trailing full stop, read the same.
    expect(
      splitRoute("x <room>Alpha-Reader through s6.</room>", "general", SECTIONS)
        .route,
    ).toEqual({ kind: "alpha-reader", through: "s6" });
  });

  it("offers the chat without a Section it cannot set", () => {
    // A Section the book does not hold.
    expect(
      splitRoute(
        "x <room>beta-reader through node:s9</room>",
        "general",
        SECTIONS,
      ).route,
    ).toEqual({ kind: "beta-reader" });
    // A Section on a chat with no horizon.
    expect(
      splitRoute(
        "x <room>editorial through node:s5</room>",
        "drafting",
        SECTIONS,
      ).route,
    ).toEqual({ kind: "editorial" });
  });

  it("offers nothing for a kind that is not a chat, or the chat it is in", () => {
    for (const block of [
      "<room>the editor</room>",
      "<room>general</room>",
      "<room></room>",
    ])
      expect(splitRoute(`An answer. ${block}`, "general", SECTIONS)).toEqual({
        answer: "An answer.",
      });
    expect(splitRoute("No pointer.", "general", SECTIONS)).toEqual({
      answer: "No pointer.",
    });
  });
});
