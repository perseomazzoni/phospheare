// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  cleanBody,
  cleanSearched,
  clipNote,
  pageAddress,
  readComments,
  writeComments,
} from "./codec";
import { ENTRY_BODY_MAX, LINKS_PER_SEARCH_MAX } from "./limits";
import type { CommentsFile } from "./model";

const file: CommentsFile = {
  threads: [
    {
      id: "t1",
      state: "proposed",
      anchor: { quote: "the storm", prefix: "The ", suffix: " came" },
      weight: "major",
      entries: [
        {
          id: "e1",
          author: { kind: "persona", id: "spark" },
          at: "2026-10-05T10:00:00Z",
          body: "Twice?",
          searched: [
            {
              engine: "wikipedia",
              query: "storm surge",
              links: [
                {
                  url: "https://en.wikipedia.org/wiki/Storm_surge",
                  title: "Storm surge",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "t2",
      state: "resolved",
      anchor: null,
      entries: [
        {
          id: "e2",
          author: { kind: "editor", name: "Ed" },
          at: "2026-09-30T10:00:00Z",
          body: "Cut?",
        },
        {
          id: "e3",
          author: { kind: "writer" },
          at: "2026-10-01T10:00:00Z",
          body: "No.",
        },
      ],
    },
  ],
  dismissed: [{ persona: "nova", quote: "grey", gist: "Too grey.", at: "t" }],
};

describe("the comments file", () => {
  it("reads back exactly what it wrote", () => {
    const text = writeComments(file);
    expect(text.endsWith("}\n")).toBe(true);
    expect(readComments(text)).toEqual({ ok: true, file });
  });

  it("calls a file of the wrong shape damaged rather than guessing", () => {
    const damaged = (value: unknown) =>
      readComments(typeof value === "string" ? value : JSON.stringify(value));
    expect(damaged("{not json")).toEqual({ ok: false, reason: "damaged" });
    expect(damaged({ threads: [] })).toEqual({ ok: false, reason: "damaged" });
    const one = JSON.parse(writeComments(file));
    expect(
      damaged({ ...one, threads: [{ ...one.threads[0], state: "maybe" }] }).ok,
    ).toBe(false);
    expect(
      damaged({ ...one, threads: [{ ...one.threads[0], entries: [] }] }).ok,
    ).toBe(false);
    expect(
      damaged({ ...one, threads: [{ ...one.threads[0], weight: "huge" }] }).ok,
    ).toBe(false);
    expect(
      damaged({
        ...one,
        threads: [
          { ...one.threads[0], anchor: { quote: "", prefix: "", suffix: "" } },
        ],
      }).ok,
    ).toBe(false);
    expect(
      damaged({ ...one, threads: [one.threads[0], one.threads[0]] }).ok,
    ).toBe(false);
    const stranger = {
      ...one.threads[0].entries[0],
      author: { kind: "robot" },
    };
    expect(
      damaged({ ...one, threads: [{ ...one.threads[0], entries: [stranger] }] })
        .ok,
    ).toBe(false);
  });

  // A reply's searches are kept as links a writer may click, so an address
  // that is not a web page makes the file damaged on the way in, and is
  // dropped on the way out.
  it("keeps a reply's searches, and only web pages as their links", () => {
    expect(pageAddress("https://example.org/a b")).toBe(
      "https://example.org/a%20b",
    );
    expect(pageAddress("javascript:alert(1)")).toBeNull();
    expect(pageAddress("data:text/html,x")).toBeNull();
    expect(pageAddress("not a url")).toBeNull();
    expect(pageAddress(`https://e.org/${"x".repeat(3000)}`)).toBeNull();
    const one = JSON.parse(writeComments(file));
    const entry = one.threads[0].entries[0];
    const withLink = (url: string) => ({
      ...one,
      threads: [
        {
          ...one.threads[0],
          entries: [
            {
              ...entry,
              searched: [{ ...entry.searched[0], links: [{ url, title: "" }] }],
            },
          ],
        },
      ],
    });
    expect(readComments(JSON.stringify(withLink("javascript:x"))).ok).toBe(
      false,
    );
    expect(readComments(JSON.stringify(withLink("https://ok.org/"))).ok).toBe(
      true,
    );
    expect(
      cleanSearched([
        {
          engine: "web",
          query: " the​ storm ",
          links: [
            { url: "javascript:x", title: "Bad" },
            ...Array.from({ length: LINKS_PER_SEARCH_MAX + 2 }, (_, n) => ({
              url: `https://e.org/${n}`,
              title: `Page ${n}`,
            })),
          ],
        },
        { engine: "web", query: "   ", links: [] },
      ]),
    ).toEqual([
      {
        engine: "web",
        query: "the storm",
        links: Array.from({ length: LINKS_PER_SEARCH_MAX - 1 }, (_, n) => ({
          url: `https://e.org/${n}`,
          title: `Page ${n}`,
        })),
      },
    ]);
    expect(cleanSearched([])).toBeNull();
  });

  // A persona's note past its cap ends on a sentence, and says it was held.
  it("holds a long note to its cap at a sentence's end", () => {
    expect(clipNote(" Short. ", 100)).toBe("Short.");
    expect(clipNote("One here. Two there. Three is long", 25)).toBe(
      "One here. Two there. …",
    );
    // No sentence ends in the room's second half: cut at a space.
    expect(clipNote("A. ".concat("word ".repeat(20)), 30)).toBe(
      "A. word word word word word …",
    );
  });

  it("keeps every body plain, visible and within its cap", () => {
    expect(cleanBody("  a\u200Bb\u202Ec\r\nd  ")).toBe("ab" + "c\nd");
    expect(cleanBody("x".repeat(ENTRY_BODY_MAX + 10))).toHaveLength(
      ENTRY_BODY_MAX,
    );
    const hidden = JSON.parse(writeComments(file));
    hidden.threads[0].entries[0].body = "Fine\u2066 hidden\u2069";
    const read = readComments(JSON.stringify(hidden));
    expect(read.ok && read.file.threads[0].entries[0].body).toBe("Fine hidden");
  });
});
