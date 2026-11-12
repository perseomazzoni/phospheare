// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { countsOf } from "./counts";
import { mentionsIn, respondersTo, tagsIn } from "./mentions";
import {
  addEntry,
  EMPTY_FILE,
  keep,
  openThread,
  ownerOf,
  reanchor,
  remove,
  reopen,
  resolve,
  type Author,
  type CommentsFile,
  type Entry,
} from "./model";

const WRITER: Author = { kind: "writer" };
const SPARK: Author = { kind: "persona", id: "spark" };
const EDITOR: Author = { kind: "editor", name: "Ed" };

const entry = (author: Author, body = "A word.", id = "e1"): Entry => ({
  id,
  author,
  at: "2026-10-05T10:00:00Z",
  body,
});
const anchor = { quote: "the storm", prefix: "", suffix: " came" };

function withGhost(): CommentsFile {
  return openThread(EMPTY_FILE, {
    id: "t1",
    anchor,
    entry: entry(SPARK, "Twice?\nThe storm arrives twice."),
    state: "proposed",
    weight: "minor",
  });
}

describe("comment threads", () => {
  it("opens a thread owned by whoever wrote its first entry", () => {
    const file = openThread(EMPTY_FILE, {
      id: "t1",
      anchor,
      entry: entry(WRITER),
    });
    expect(file.threads[0].state).toBe("open");
    expect(ownerOf(file.threads[0])).toEqual(WRITER);
    // The empty file is never changed in place.
    expect(EMPTY_FILE.threads).toEqual([]);
  });

  it("makes a ghost comment open when the writer keeps or answers it, not when its persona writes again", () => {
    expect(keep(withGhost(), "t1").threads[0].state).toBe("open");
    const answered = addEntry(
      withGhost(),
      "t1",
      entry(WRITER, "On purpose.", "e2"),
    );
    expect(answered.threads[0].state).toBe("open");
    expect(answered.threads[0].entries).toHaveLength(2);
    const again = addEntry(withGhost(), "t1", entry(SPARK, "More.", "e2"));
    expect(again.threads[0].state).toBe("proposed");
  });

  it("resolves, and reopens when written in again", () => {
    const resolved = resolve(keep(withGhost(), "t1"), "t1");
    expect(resolved.threads[0].state).toBe("resolved");
    expect(reopen(resolved, "t1").threads[0].state).toBe("open");
    const spoken = addEntry(resolved, "t1", entry(WRITER, "Wait.", "e2"));
    expect(spoken.threads[0].state).toBe("open");
  });

  it("re-attaches a thread to another passage or to the chapter", () => {
    const moved = reanchor(withGhost(), "t1", null);
    expect(moved.threads[0].anchor).toBeNull();
  });

  it("remembers what a persona said when its comment is dismissed or removed, and forgets a person's", () => {
    const dismissed = remove(withGhost(), "t1", "2026-10-06T00:00:00Z");
    expect(dismissed.threads).toEqual([]);
    expect(dismissed.dismissed).toEqual([
      {
        persona: "spark",
        quote: "the storm",
        gist: "Twice?",
        at: "2026-10-06T00:00:00Z",
      },
    ]);
    const mine = openThread(EMPTY_FILE, {
      id: "t2",
      anchor,
      entry: entry(WRITER),
    });
    expect(remove(mine, "t2", "x")).toEqual(EMPTY_FILE);
  });

  it("leaves the file as it was for a thread that is not there", () => {
    const file = withGhost();
    expect(keep(file, "nope")).toBe(file);
    expect(remove(file, "nope", "x")).toBe(file);
  });
});

describe("countsOf", () => {
  it("counts by owner, persona by persona, and never a resolved thread", () => {
    let file = withGhost();
    file = openThread(file, { id: "t2", anchor: null, entry: entry(WRITER) });
    file = openThread(file, { id: "t3", anchor, entry: entry(EDITOR) });
    file = openThread(file, {
      id: "t4",
      anchor,
      entry: entry({ kind: "persona", id: "nova" }),
      state: "proposed",
    });
    file = openThread(file, { id: "t5", anchor, entry: entry(SPARK) });
    file = resolve(file, "t3");
    expect(countsOf(file)).toEqual({
      personas: { spark: 2, nova: 1 },
      others: 1,
    });
  });

  it("counts a thread the writer opened and tagged a persona in as the writer's", () => {
    let file = openThread(EMPTY_FILE, {
      id: "t1",
      anchor,
      entry: entry(WRITER, "@Spark is this too much?"),
    });
    file = addEntry(file, "t1", entry(SPARK, "A little.", "e2"));
    expect(countsOf(file)).toEqual({ personas: {}, others: 1 });
  });
});

describe("who answers", () => {
  const personas = [
    { id: "phos", name: "Phos" },
    { id: "nova", name: "Nova" },
    { id: "spark", name: "Spark" },
  ];

  it("reads tags in the order they were written, each once, whatever their case", () => {
    expect(mentionsIn("@nova and @Phos, then @Nova again", personas)).toEqual([
      "nova",
      "phos",
    ]);
    // An address, not a word that happens to contain a name.
    expect(mentionsIn("mail me at a@Phosphor.it or @Novak", personas)).toEqual(
      [],
    );
  });

  // What the card draws as a tag is what summons: every one, where it
  // stands, and nothing that only contains a name.
  it("finds every tag where it stands, and nothing inside an address or a longer word", () => {
    const body = "@nova, and @Phos — then @Nova again; a@Phos.it, @Novak";
    expect(
      tagsIn(body, personas).map((tag) => body.slice(tag.start, tag.end)),
    ).toEqual(["@nova", "@Phos", "@Nova"]);
    expect(tagsIn(body, personas).map((tag) => tag.id)).toEqual([
      "nova",
      "phos",
      "nova",
    ]);
  });

  it("lets the tagged answer, or the persona that opened the thread, and nobody else", () => {
    const ghost = withGhost().threads[0];
    expect(respondersTo(ghost, entry(WRITER, "Why?"), personas)).toEqual([
      "spark",
    ]);
    expect(
      respondersTo(ghost, entry(WRITER, "@Phos agree?"), personas),
    ).toEqual(["phos"]);
    const mine = openThread(EMPTY_FILE, {
      id: "t2",
      anchor,
      entry: entry(WRITER),
    }).threads[0];
    expect(
      respondersTo(mine, entry(WRITER, "Note to self."), personas),
    ).toEqual([]);
    // A persona's own entry never sets off another answer.
    expect(respondersTo(ghost, entry(SPARK, "@Nova?"), personas)).toEqual([]);
  });
});
