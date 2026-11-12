// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  asCardContent,
  libraryIdForRef,
  libraryRefForId,
  libraryRefs,
  sameCardContent,
  sameMembership,
} from "./library";
import { parseStructure } from "../project/structure";
import type { CardContent, LibraryRow } from "./profileStore";

// Pins the rules over the library's rows: what counts as a membership
// change, what counts as the same card, the forgiving and reducing read of a
// card, and the lookups between a row's identity and its location.

// A row's identity is its project id and its location is incidental.
// The helper derives the id from the key: a test that means "the same book
// somewhere else" overrides `provider` or `key`; one that means "a different
// book" passes a different `key` and gets a different id with it.
const row = (key: string, overrides: Partial<LibraryRow> = {}): LibraryRow => ({
  id: `book-${key}`,
  provider: "local",
  key,
  name: key,
  openedAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: null,
  removedAt: null,
  card: null,
  ...overrides,
});

const card = (
  title = "Card",
  cachedAt = "2026-01-03T00:00:00.000Z",
): CardContent => ({
  id: "doc-1",
  title,
  type: "novel",
  words: 10,
  parts: 1,
  sections: 1,
  goal: null,
  perNode: [],
  structure: { version: 1, children: [] },
  updatedAt: "2026-01-03T00:00:00.000Z",
  cachedAt,
});

describe("sameMembership", () => {
  it("is the identity set plus names, nothing else", () => {
    expect(
      sameMembership([row("a")], [{ ...row("a"), lastSeenAt: "later" }]),
    ).toBe(true);
    // Card content is not part of it: content changes are the display
    // question `sameCardContent` answers, never a membership one.
    expect(
      sameMembership([row("a")], [{ ...row("a"), card: card("Other") }]),
    ).toBe(true);
    expect(sameMembership([row("a")], [row("b")])).toBe(false);
    expect(
      sameMembership([row("a", { name: "A" })], [row("a", { name: "B" })]),
    ).toBe(false);
  });
});

describe("sameCardContent", () => {
  it("is every drawn field, deep — and ignores cachedAt", () => {
    expect(sameCardContent(card(), card())).toBe(true);
    expect(sameCardContent(card(), card("Other"))).toBe(false);
    expect(
      sameCardContent(
        card("A", "2026-01-01T00:00:00.000Z"),
        card("A", "2026-02-01T00:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      sameCardContent(card(), {
        ...card(),
        perNode: [{ nodeId: "P1", words: 3, updatedAt: "" }],
      }),
    ).toBe(false);
    expect(sameCardContent(null, null)).toBe(true);
    expect(sameCardContent(card(), null)).toBe(false);
  });
});

describe("asCardContent — the forgiving, reducing read of the echoed card", () => {
  it("drops a card that cannot be trusted, keeping the row", () => {
    expect(asCardContent(null)).toBeNull();
    expect(asCardContent({ id: "x" })).toBeNull(); // no title
    expect(asCardContent({ title: "x" })).toBeNull(); // no id
    expect(asCardContent(42)).toBeNull();
  });

  it("renders hostile strings inert — they are data, never parsed further", () => {
    const hostile = asCardContent({
      id: "doc-1",
      title: "<script>alert(1)</script>",
      type: "<img src=x>",
      words: "NaN",
      parts: -5,
      sections: 1.9,
      goal: "many",
      perNode: [{ nodeId: "<b>", words: "NaN" }],
      structure: { version: "v1", children: [null, { id: "x" }] },
      updatedAt: "not-a-date",
      cachedAt: "not-a-date",
    });
    expect(hostile).not.toBeNull();
    expect(hostile?.title).toBe("<script>alert(1)</script>");
    expect(hostile?.words).toBe(0);
    expect(hostile?.parts).toBe(0);
    expect(hostile?.sections).toBe(1);
    expect(hostile?.goal).toBeNull();
    // The hostile node id survives as data, being a valid string, and its
    // count is zeroed; nothing parses it further.
    expect(hostile?.perNode).toEqual([
      { nodeId: "<b>", words: 0, updatedAt: "" },
    ]);
    expect(hostile?.structure).toEqual({ version: 1, children: [] });
  });

  // The per-node session delta is a fact about one writer's sitting, so it
  // stays in the writer's own properties file. The reducer's whitelist keeps
  // it off the `CardContent` boundary, and a field added there needs a
  // security review.
  it("strips the per-node session deltas at the seam", () => {
    const reduced = asCardContent({
      id: "doc-1",
      title: "A",
      type: "novel",
      words: 1,
      parts: 1,
      sections: 1,
      goal: null,
      perNode: [{ nodeId: "EL2", words: 100, lastDelta: 40 }],
      structure: { version: 1, children: [] },
      updatedAt: "",
      cachedAt: "",
    });
    expect(reduced?.perNode).toEqual([
      { nodeId: "EL2", words: 100, updatedAt: "" },
    ]);
  });

  it("reduces the structure — bin subtrees and anything the shelf does not draw never survive the seam", () => {
    const reduced = asCardContent({
      id: "doc-1",
      title: "A",
      type: "novel",
      words: 1,
      parts: 1,
      sections: 1,
      goal: null,
      perNode: [],
      structure: {
        version: 1,
        children: [
          {
            kind: "part",
            id: "P1",
            title: "Part",
            adopted: "part--p1.01.md",
            snapshots: [
              {
                file: "part--p1.01.md",
                title: "Part",
                created: "2026-01-01T00:00:00.000Z",
                contentHash: "sha",
              },
            ],
            summary: "reference/summary--P1.md",
            children: [],
          },
        ],
        removed: [
          {
            kind: "section",
            id: "EL9",
            title: "Binned",
            adopted: "section--binned.EL9.01.md",
            snapshots: [
              {
                file: "section--binned.EL9.01.md",
                title: "Binned",
                created: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        ],
      },
      updatedAt: "",
      cachedAt: "",
    });
    const children = reduced?.structure.children ?? [];
    expect(children).toHaveLength(1);
    const part = children[0] as unknown as Record<string, unknown>;
    expect(part.summary).toBeUndefined();
    // The snapshot list does not cross at all: not its content hashes, file
    // names or titles. The spine never reads it.
    expect(part.snapshots).toEqual([]);
    expect(
      (reduced?.structure as unknown as Record<string, unknown>).removed,
    ).toBeUndefined();
  });

  // The yaml carries no snapshots, so `parseStructure` hands every node
  // `snapshots: []`. A reducer that required a snapshot would drop every Part
  // and Section before the card reached the profile, and every spine on the
  // shelf would be empty.
  it("keeps the shape of a structure read from the yaml, which carries no snapshots", () => {
    const shape = parseStructure(
      [
        "version: 1",
        "document:",
        "  - id: EL1",
        '    part: "Arrival"',
        "    adopted: part--arrival.EL1.00.md",
        "    children:",
        "      - id: EL2",
        '        section: "The road"',
        "        adopted: section--the_road.EL2.00.md",
        "",
      ].join("\n"),
    );
    if (!shape.ok) throw new Error("fixture yaml did not parse");
    const reduced = asCardContent({
      id: "doc-1",
      title: "A",
      structure: shape.structure,
    });
    const part = reduced?.structure.children[0];
    expect(part).toMatchObject({ kind: "part", id: "EL1", title: "Arrival" });
    expect(part?.kind === "part" ? part.children : []).toEqual([
      expect.objectContaining({
        kind: "section",
        id: "EL2",
        title: "The road",
      }),
    ]);
  });
});

describe("libraryRefs", () => {
  it("maps rows to refs with the openedAt ?? lastSeenAt ?? now fallback", () => {
    const refs = libraryRefs([
      row("a"),
      row("b", { openedAt: null, lastSeenAt: "2026-03-01T00:00:00.000Z" }),
      row("c", { openedAt: null, lastSeenAt: null }),
    ]);
    expect(refs[0].openedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(refs[1].openedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(refs[2].openedAt).toBeTruthy();
    expect(refs.map((r) => r.key)).toEqual(["a", "b", "c"]);
  });
});

describe("libraryRefForId", () => {
  // All of `/app/project/<id>`'s resolution. The address is the book's own
  // `document.id`, and this mirror is the only map from it to a place.
  const withCard = (key: string, id: string, over: Partial<LibraryRow> = {}) =>
    row(key, { id, card: { ...card(), id }, ...over });

  it("finds the row whose book carries the id", () => {
    const rows = [withCard("a", "id-a"), withCard("b", "id-b")];
    expect(libraryRefForId(rows, "id-b")?.key).toBe("b");
    expect(libraryRefForId(rows, "id-b")?.providerId).toBe("local");
  });

  it("answers nothing for an id no book carries, and for no id at all", () => {
    const rows = [withCard("a", "id-a")];
    expect(libraryRefForId(rows, "id-z")).toBeNull();
    expect(libraryRefForId(rows, "")).toBeNull();
    expect(libraryRefForId([], "id-a")).toBeNull();
  });

  // The id is the row's own key, present from the moment the row is, not a
  // field of its card, which is null until some device has read the book.
  // A project that has only been a membership row is still reachable
  // by its own URL.
  it("addresses a row no device has read yet", () => {
    expect(libraryRefForId([row("a", { id: "id-a" })], "id-a")?.key).toBe("a");
  });

  // The move is invisible here: the address changed, the book did not, and
  // the URL that names the book resolves to the new place.
  it("follows a book that moved to another provider", () => {
    const rows = [withCard("drive-folder-9", "id-a", { provider: "drive" })];
    expect(libraryRefForId(rows, "id-a")?.providerId).toBe("drive");
    expect(libraryRefForId(rows, "id-a")?.key).toBe("drive-folder-9");
  });
});

describe("libraryIdForRef", () => {
  // The one place a location is allowed to answer a question about identity:
  // the shelf's own controls start from a card the writer clicked.
  it("names the book reachable at an address", () => {
    const rows = [row("a", { id: "id-a" }), row("b", { id: "id-b" })];
    expect(libraryIdForRef(rows, { providerId: "local", key: "b" })).toBe(
      "id-b",
    );
  });

  it("answers nothing for an address the shelf does not know", () => {
    const rows = [row("a", { id: "id-a" })];
    // The same key on a different backend is a different place.
    expect(libraryIdForRef(rows, { providerId: "drive", key: "a" })).toBeNull();
    expect(libraryIdForRef(rows, { providerId: "local", key: "z" })).toBeNull();
    expect(libraryIdForRef([], { providerId: "local", key: "a" })).toBeNull();
  });
});
