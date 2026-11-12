// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { CardContent, LibraryRow } from "../../../../profile/profileStore";
import { STRUCTURE_VERSION } from "../../../../project/types";
import type { ProjectRef } from "../../../../storage/types";
import {
  adoptableId,
  initialCards,
  insertLoadingCard,
  mergeMirror,
  paintCards,
  readsNow,
  relocateCard,
  removeCard,
  rowHoldsBook,
  updateCard,
  type Place,
  type ProjectCard,
  type Reach,
} from "./cards";

const content = (id: string, title: string): CardContent => ({
  id,
  title,
  type: "Novel",
  words: 1,
  parts: 1,
  sections: 1,
  goal: null,
  perNode: [],
  structure: { version: STRUCTURE_VERSION, children: [] },
  updatedAt: "2026-11-01T00:00:00.000Z",
  cachedAt: "2026-11-01T00:00:00.000Z",
});

const row = (id: string, provider: string, key: string): LibraryRow => ({
  id,
  provider,
  key,
  name: key,
  openedAt: "2026-11-01T00:00:00.000Z",
  lastSeenAt: null,
  removedAt: null,
  card: content(id, key.toUpperCase()),
});

const ref = (providerId: string, key: string): ProjectRef => ({
  providerId,
  key,
  name: key,
  openedAt: "2026-11-01T00:00:00.000Z",
});

const place = (r: ProjectRef): Place =>
  r.providerId === "drive"
    ? "remote"
    : r.providerId === "local"
      ? "local"
      : "other";

const everything: Reach = {
  remoteConnected: true,
  remoteResolved: true,
  rootReady: true,
  rootResolved: true,
};

const rows = [row("a", "local", "a"), row("d", "drive", "d")];

describe("paintCards", () => {
  it("paints every row loading when every connection is up", () => {
    const cards = paintCards([], rows, place, everything);
    expect(cards.map((c) => [c.id, c.state, c.content?.title])).toEqual([
      ["a", "loading", "A"],
      ["d", "loading", "D"],
    ]);
  });

  it("paints a card blocked once its connection's verdict is in and out", () => {
    const cards = paintCards([], rows, place, {
      ...everything,
      remoteConnected: false,
      rootReady: false,
    });
    expect(cards.map((c) => c.state)).toEqual(["blocked", "blocked"]);
  });

  it("holds a card at loading while its connection's verdict is unanswered", () => {
    const cards = paintCards([], rows, place, {
      remoteConnected: false,
      remoteResolved: false,
      rootReady: false,
      rootResolved: false,
    });
    expect(cards.map((c) => c.state)).toEqual(["loading", "loading"]);
  });

  it("keeps a ready card as it is rather than flashing back to loading", () => {
    const ready: ProjectCard = {
      id: "a",
      ref: ref("local", "a"),
      state: "ready",
      content: content("a", "Read this session"),
      fresh: true,
      problem: null,
    };
    const [card] = paintCards([ready], rows, place, everything);
    expect(card.state).toBe("ready");
    expect(card.content?.title).toBe("Read this session");
  });

  it("does not keep a ready card whose connection went out", () => {
    const ready: ProjectCard = {
      id: "d",
      ref: ref("drive", "d"),
      state: "ready",
      content: content("d", "Read"),
      fresh: true,
      problem: null,
    };
    const cards = paintCards([ready], rows, place, {
      ...everything,
      remoteConnected: false,
    });
    expect(cards[1].state).toBe("blocked");
  });
});

describe("readsNow", () => {
  it("skips a remote card with no connection and a local card with no root", () => {
    const none = { ...everything, remoteConnected: false, rootReady: false };
    expect(readsNow("remote", none)).toBe(false);
    expect(readsNow("local", none)).toBe(false);
    expect(readsNow("other", none)).toBe(true);
    expect(readsNow("remote", everything)).toBe(true);
  });
});

describe("the list changes", () => {
  const cards = initialCards(rows);

  it("initialCards draws each row loading with its remembered content", () => {
    expect(cards.map((c) => [c.id, c.state, c.fresh])).toEqual([
      ["a", "loading", false],
      ["d", "loading", false],
    ]);
  });

  it("insertLoadingCard adds a card once", () => {
    const added = insertLoadingCard(cards, ref("local", "b"));
    expect(added).toHaveLength(3);
    expect(added[2]).toMatchObject({ id: null, state: "loading" });
    expect(insertLoadingCard(added, ref("local", "b"))).toBe(added);
  });

  it("updateCard and removeCard touch only the card at that address", () => {
    const updated = updateCard(cards, ref("drive", "d"), { state: "gone" });
    expect(updated.map((c) => c.state)).toEqual(["loading", "gone"]);
    expect(removeCard(cards, ref("local", "a")).map((c) => c.id)).toEqual([
      "d",
    ]);
  });

  it("relocateCard moves the card and takes the read's result", () => {
    const moved = relocateCard(cards, ref("drive", "d"), ref("local", "d2"), {
      content: content("d", "Moved"),
      state: "ready",
      problem: null,
    });
    expect(moved[1]).toMatchObject({
      id: "d",
      ref: ref("local", "d2"),
      state: "ready",
      fresh: true,
    });
  });

  it("mergeMirror returns the same array when nothing changed", () => {
    expect(mergeMirror(cards, rows)).toBe(cards);
  });

  it("mergeMirror takes new mirror content, unread, and keeps the rest", () => {
    const newer = [
      row("a", "local", "a"),
      { ...rows[1], card: content("d", "New") },
    ];
    const merged = mergeMirror(cards, newer);
    expect(merged[0]).toBe(cards[0]);
    expect(merged[1]).toMatchObject({ fresh: false });
    expect(merged[1].content?.title).toBe("New");
  });
});

describe("which book a folder holds", () => {
  const ready = (id: string) => ({
    content: content(id, "T"),
    state: "ready" as const,
    problem: null,
  });

  it("rowHoldsBook is true only for the row's own book at that address", () => {
    expect(rowHoldsBook(rows, ref("local", "a"), "a")).toBe(true);
    expect(rowHoldsBook(rows, ref("local", "a"), "d")).toBe(false);
    expect(rowHoldsBook(rows, ref("local", "zz"), "a")).toBe(false);
  });

  it("adoptableId refuses a folder with no identity", () => {
    expect(
      adoptableId(rows, ref("local", "b"), {
        content: null,
        state: "blocked",
        problem: null,
      }),
    ).toBeNull();
  });

  it("adoptableId refuses a second folder holding a shelved book", () => {
    expect(adoptableId(rows, ref("local", "copy"), ready("d"))).toBeNull();
  });

  it("adoptableId accepts a new book, or the shelved book at its own address", () => {
    expect(adoptableId(rows, ref("local", "b"), ready("b"))).toBe("b");
    expect(adoptableId(rows, ref("drive", "d"), ready("d"))).toBe("d");
  });
});
