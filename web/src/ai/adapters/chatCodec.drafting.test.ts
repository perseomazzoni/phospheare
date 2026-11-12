// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  CHAT_KINDS,
  DRAFTING_LIMITS,
  type ChatKind,
  type ChatRecord,
} from "../domain/types";
import { parseChat } from "./chatCodec";

// Pins how a drafting chat's need and visited Sections are read back from a
// file someone else may have written. For-later notes are ghost comments in
// the margin, so a record carrying a for-later list is refused whole and the
// room asks again.

const NEED = { kind: "what-if", nodeId: "one", at: "2026-09-28T10:00:00.000Z" };

function chatWith(drafting: unknown, kind: ChatKind = "drafting"): ChatRecord {
  return parseChat(
    JSON.stringify({
      schemaVersion: 1,
      id: "chat",
      title: "Chat",
      kind,
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
      preferences: { personaId: "p", model: null, pinnedSourceIds: [] },
      turns: [],
      drafting,
    }),
  );
}

describe("the stored drafting record", () => {
  it("keeps a record exactly as a run writes it", () => {
    const drafting = { need: NEED, visited: ["one"] };
    expect(chatWith(drafting).drafting).toEqual(drafting);
  });

  it("is the drafting room's alone", () => {
    for (const kind of CHAT_KINDS)
      if (kind !== "drafting")
        expect(chatWith({ need: NEED }, kind).drafting).toBeUndefined();
  });

  it("drops a record that is not one, whole", () => {
    for (const drafting of [null, "x", [], { need: NEED, x: 1 }])
      expect(chatWith(drafting).drafting).toBeUndefined();
  });

  it("drops a bad need, never the Sections", () => {
    for (const need of [
      { ...NEED, kind: "vibes" },
      { ...NEED, nodeId: "" },
      { ...NEED, extra: 1 },
      "what-if",
    ]) {
      const kept = chatWith({ need, visited: ["one"] }).drafting;
      expect(kept?.need).toBeUndefined();
      expect(kept?.visited).toEqual(["one"]);
    }
  });

  it("keeps the Sections visited, and drops a bad list without the need", () => {
    // The list holds node ids only.
    const kept = { need: NEED, visited: ["one", "two"] };
    expect(chatWith(kept).drafting).toEqual(kept);
    for (const visited of [
      "one",
      [3],
      [""],
      Array.from({ length: DRAFTING_LIMITS.visited + 1 }, (_, n) => `s${n}`),
    ]) {
      const read = chatWith({ need: NEED, visited }).drafting;
      expect(read?.visited).toBeUndefined();
      expect(read?.need).toEqual(NEED);
    }
  });

  // A record carrying a for-later list is refused whole, never read around.
  it("drops a record that still carries a for-later list", () => {
    const note = {
      id: "n1",
      text: "The POV slips.",
      turnId: "a",
      nodeId: "one",
      at: "2026-09-28T10:00:00.000Z",
    };
    expect(chatWith({ need: NEED, forLater: [note] }).drafting).toBeUndefined();
    expect(chatWith({ forLater: [] }).drafting).toBeUndefined();
  });
});
