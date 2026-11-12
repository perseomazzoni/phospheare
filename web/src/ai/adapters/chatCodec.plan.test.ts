// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  CHAT_KINDS,
  PLAN_LIMITS,
  type ChatKind,
  type ChatRecord,
} from "../domain/types";
import { parseChat } from "./chatCodec";

// Pins how an editor's revision plan is read back from a file someone else
// may have written.

const ITEM = {
  id: "i1",
  priority: "must",
  text: "Give Mara a reason to stay.",
  state: "open",
  turnId: "a",
};

function chatWith(plan: unknown, kind: ChatKind = "editorial"): ChatRecord {
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
      plan,
    }),
  );
}

describe("the stored revision plan", () => {
  it("keeps a plan exactly as a letter writes it", () => {
    const plan = { items: [ITEM, { ...ITEM, id: "i2", state: "done" }] };
    expect(chatWith(plan).plan).toEqual(plan);
  });

  it("is an editor's alone, and drops what is not one", () => {
    for (const kind of CHAT_KINDS)
      if (kind !== "editorial")
        expect(chatWith({ items: [ITEM] }, kind).plan).toBeUndefined();
    for (const plan of [null, [], {}, { items: {} }, { items: [], x: 1 }])
      expect(chatWith(plan).plan).toBeUndefined();
  });

  it("drops a bad item, never the plan, and keeps each id once", () => {
    const kept = chatWith({
      items: [
        ITEM,
        { ...ITEM, text: "twin" },
        { ...ITEM, id: "i2", priority: "urgent" },
        { ...ITEM, id: "i3", state: "dropped" },
        { ...ITEM, id: "i4", text: "" },
        { ...ITEM, id: "i5", text: "x".repeat(PLAN_LIMITS.item + 1) },
        { ...ITEM, id: "i6", extra: 1 },
        { ...ITEM, id: "i7", priority: "could" },
      ],
    }).plan;
    expect(kept?.items.map((item) => item.id)).toEqual(["i1", "i7"]);
  });

  it("keeps a letter's verdict on an item, and drops a bad one without the item", () => {
    const check = {
      verdict: "worse",
      note: "The cut left a gap.",
      turnId: "b",
    };
    expect(
      chatWith({ items: [{ ...ITEM, check }] }).plan?.items[0].check,
    ).toEqual(check);
    for (const bad of [
      { ...check, verdict: "fine" },
      { ...check, note: 3 },
      { ...check, note: "x".repeat(PLAN_LIMITS.note + 1) },
      { ...check, extra: 1 },
      "resolved",
    ]) {
      const item = chatWith({ items: [{ ...ITEM, check: bad }] }).plan
        ?.items[0];
      expect(item?.id).toBe("i1");
      expect(item?.check).toBeUndefined();
    }
  });
});

describe("the stored pointer to another chat", () => {
  function routed(
    route: unknown,
    kind: ChatKind = "general",
    role = "assistant",
  ) {
    return parseChat(
      JSON.stringify({
        schemaVersion: 1,
        id: "chat",
        title: "Chat",
        kind,
        createdAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
        preferences: { personaId: "p", model: null, pinnedSourceIds: [] },
        turns: [
          {
            id: "t",
            role,
            text: "An answer.",
            createdAt: "2026-09-28T00:00:00.000Z",
            outcome: "complete",
            route,
          },
        ],
      }),
    ).turns[0].route;
  }

  it("keeps a route a run could have written", () => {
    expect(routed({ kind: "beta-reader", through: "s5" })).toEqual({
      kind: "beta-reader",
      through: "s5",
    });
    expect(routed({ kind: "editorial" }, "drafting")).toEqual({
      kind: "editorial",
    });
  });

  it("drops one no run could have, never the turn", () => {
    for (const [route, kind, role] of [
      [{ kind: "general" }, "general", "assistant"],
      [{ kind: "nowhere" }, "general", "assistant"],
      [{ kind: "editorial", through: "s5" }, "general", "assistant"],
      [{ kind: "beta-reader", extra: 1 }, "general", "assistant"],
      [{ kind: "beta-reader" }, "editorial", "assistant"],
      [{ kind: "beta-reader" }, "general", "user"],
      ["beta-reader", "general", "assistant"],
    ] as const)
      expect(routed(route, kind as ChatKind, role)).toBeUndefined();
  });
});
