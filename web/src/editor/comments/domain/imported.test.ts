// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { readComments, writeComments } from "./codec";
import { editorsFile } from "./imported";
import { NAME_MAX } from "./limits";

const ids = () => {
  let n = 0;
  return () => `c${++n}`;
};

describe("editorsFile", () => {
  it("makes threads of editors' entries, resolved where the editor resolved them", () => {
    const file = editorsFile(
      [
        {
          anchor: { quote: "storm", prefix: "The ", suffix: " came" },
          resolved: false,
          entries: [
            { name: "Maria", at: "2026-01-01T00:00:00Z", body: "Why here?" },
            { name: "Ada", at: "2026-01-02T00:00:00Z", body: "Because." },
          ],
        },
        {
          anchor: null,
          resolved: true,
          entries: [{ name: "Maria", at: "2026-01-03T00:00:00Z", body: "Ok." }],
        },
      ],
      ids(),
    );
    expect(file.dismissed).toEqual([]);
    expect(file.threads.map((t) => [t.id, t.state, t.entries.length])).toEqual([
      ["c1", "open", 2],
      ["c4", "resolved", 1],
    ]);
    expect(file.threads[0].entries[1]).toEqual({
      id: "c3",
      author: { kind: "editor", name: "Ada" },
      at: "2026-01-02T00:00:00Z",
      body: "Because.",
    });
    // What it makes, the codec reads back as it was.
    const read = readComments(writeComments(file));
    expect(read.ok && read.file).toEqual(file);
  });

  it("keeps an editor's words plain and capped, like every body", () => {
    const file = editorsFile(
      [
        {
          anchor: null,
          resolved: false,
          entries: [
            {
              name: "M".repeat(NAME_MAX + 20),
              at: "2026-01-01T00:00:00Z",
              body: "Look\u202Ehere\r\nplease",
            },
          ],
        },
      ],
      ids(),
    );
    const [entry] = file.threads[0].entries;
    expect(entry.body).toBe("Lookhere\nplease");
    expect(entry.author.kind === "editor" && entry.author.name.length).toBe(
      NAME_MAX,
    );
  });

  it("leaves out a thread with nothing in it", () => {
    expect(
      editorsFile([{ anchor: null, resolved: false, entries: [] }], ids())
        .threads,
    ).toEqual([]);
  });
});
