// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { CHAT_KINDS } from "./types";
import { ROOMS, isUnwritten, joinReads, sameRef } from "./rooms";

describe("the rooms", () => {
  it("gives every kind a room, and extras only to the readers", () => {
    for (const kind of CHAT_KINDS) expect(ROOMS[kind]).toBeDefined();
    expect(ROOMS.general.readerExtras).toEqual([]);
    expect(ROOMS.editorial.readerExtras).toEqual([]);
    expect(ROOMS.drafting.readerExtras).toEqual([]);
    // Alpha knows the intent; beta sees only the back cover.
    expect(
      ROOMS["alpha-reader"].readerExtras.map((one) => one.sectionId),
    ).toEqual(["at-a-glance", "promise", "theme", "logline"]);
    expect(ROOMS["beta-reader"].readerExtras).toEqual([
      { group: "guidebook", sectionId: "blurb" },
    ]);
    // A reader reads nothing it may not see.
    for (const kind of ["alpha-reader", "beta-reader"] as const)
      for (const read of ROOMS[kind].reads)
        expect(ROOMS[kind].readerExtras.some((one) => sameRef(one, read))).toBe(
          true,
        );
  });

  it("joins read lists in order, each reference once", () => {
    const brief = { group: "guidebook", sectionId: "editing-brief" } as const;
    const characters = { group: "characters" } as const;
    expect(joinReads([brief], [characters, brief], [characters])).toEqual([
      brief,
      characters,
    ]);
  });

  it("shows what every list asked of a reference, never less", () => {
    // First-wins would let a command's `characters(rule)` narrow the room's
    // own `characters` to the voice.
    expect(
      joinReads(
        [{ group: "characters", roles: ["rule"] }],
        [{ group: "characters" }],
      ),
    ).toEqual([{ group: "characters" }]);
    expect(
      joinReads(
        [{ group: "characters", roles: ["rule"] }],
        [{ group: "characters", roles: ["fact", "rule"] }],
      ),
    ).toEqual([{ group: "characters", roles: ["rule", "fact"] }]);
  });

  it("tells a written document from an untouched template", () => {
    expect(isUnwritten("")).toBe(true);
    expect(isUnwritten("# Story at a glance\n\n- **Genre:**\n  - ")).toBe(true);
    // A fill-in formula is the template's, not the writer's.
    expect(
      isUnwritten(
        "# Logline\n\n- **[PROTAGONIST]**, a [BRIEF DESCRIPTION], wants [DESIRE]",
      ),
    ).toBe(true);
    expect(isUnwritten("- **Genre:**\n  - Gothic mystery")).toBe(false);
    // One bracketed aside in the writer's own line is still theirs.
    expect(isUnwritten("She lies [on purpose] about the letter.")).toBe(false);
    expect(isUnwritten("x")).toBe(false);
  });
});
