// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { pathsTouched, uncommittedFiles } from "./deviceWork";
import type { RemoteQueueRecord } from "./remoteQueueStore";
import type { Op } from "../../storage/mirrored";

// Pins the number in front of the writer. A wrong answer here is a number a
// person reads while deciding whether they can close a laptop, so the domain is
// enumerated rather than sampled. The rule is every file any pending op names,
// prose or structure, and that count is never zero while work is held.

let nextId = 1;
function rec(op: Op, key = "book", stopped?: string | null): RemoteQueueRecord {
  return {
    id: nextId++,
    userId: "u1",
    ref: { id: `book-${key}`, providerId: "drive", key },
    op,
    ...(stopped !== undefined ? { stopped: { code: stopped } } : {}),
  };
}
const put = (path: string, key?: string) => rec({ kind: "put", path }, key);

const SECTION = "/document/section--the_dark.EL5.00.md";
const PART = "/document/part--act_one.EL1.00.md";

describe("how much is held", () => {
  it("is zero for an empty queue", () => {
    expect(uncommittedFiles([])).toEqual({
      files: 0,
      stuck: false,
      lost: 0,
    });
  });

  it("counts a Section's file", () => {
    expect(uncommittedFiles([put(SECTION)]).files).toBe(1);
  });

  it("counts a PART's file too — a Part is not a folder", () => {
    // A Part carries prose: in `naming.ts` a Part or a Section is a set of
    // snapshot files, and `stats.ts` sums words across every node. Skipping
    // `part--` would undercount, the direction that misleads.
    expect(uncommittedFiles([put(PART)]).files).toBe(1);
  });

  it("counts two puts on one file once", () => {
    // A burst of saves. The queue coalesces these in the ordinary case, but
    // the projection must not depend on it.
    expect(uncommittedFiles([put(SECTION), put(SECTION)]).files).toBe(1);
  });

  it("counts the same path under two projects twice", () => {
    // Paths repeat across projects: every book has a `document/`, and writers
    // reuse titles. A path-only Set would merge two projects' work into one.
    expect(
      uncommittedFiles([put(SECTION, "book-a"), put(SECTION, "book-b")]).files,
    ).toBe(2);
  });

  it("counts structural work too — it is the writer's work either way", () => {
    // A reorder, a rename, a delete and a move have not reached Drive either,
    // and need the same action from the writer as prose. `mv` counts where
    // the file was, not the directory it is headed for.
    const work = uncommittedFiles([
      rec({ kind: "put", path: "/document-structure.yaml" }),
      rec({ kind: "rm", path: SECTION }),
      rec({ kind: "rename", path: PART, newName: "part--two.EL4.00.md" }),
      rec({
        kind: "mv",
        from: "/document/section--x.EL1.00.md",
        toDir: "/recyclebin",
      }),
    ]);
    expect(work.files).toBe(4);
  });

  it("is never zero while the queue holds anything", () => {
    // If any queue state reduced to zero, the notice would have nothing to
    // say about work it is holding.
    for (const op of [
      { kind: "put", path: "/x.md" },
      { kind: "rm", path: "/x.md" },
      { kind: "mkdir", path: "/document" },
      { kind: "rename", path: "/x.md", newName: "y.md" },
      { kind: "mv", from: "/x.md", toDir: "/recyclebin" },
    ] as const) {
      expect(uncommittedFiles([rec(op)]).files).toBeGreaterThan(0);
    }
  });
});

describe("whether it is going anywhere", () => {
  it("is not stuck while every op is live", () => {
    expect(uncommittedFiles([put(SECTION), put(PART)]).stuck).toBe(false);
  });

  it("is stuck when the queue has given up on something", () => {
    // A stopped op is the case the writer can act on: the destination refused
    // it and nothing retries until they fix the cause or a new session starts.
    // It is also the most uncommitted thing in the queue, so it is counted as
    // well as flagged; filtering it out would go silent in the state the field
    // exists for.
    const work = uncommittedFiles([
      put(SECTION),
      rec({ kind: "put", path: PART }, "book", "io"),
    ]);
    expect(work.stuck).toBe(true);
    expect(work.files).toBe(2);
  });

  it("stays stuck when the stopped op belongs to another project", () => {
    // The notice is account-wide, and one project that cannot drain is worth
    // a notice even while another is healthy.
    const work = uncommittedFiles([
      put(SECTION, "book-a"),
      rec({ kind: "put", path: SECTION }, "book-b", "too-large"),
    ]);
    expect(work.stuck).toBe(true);
  });
});

// The other question the queue's rows answer: not how many files, but which.
// The structure panel marks a row per file, and a moved or renamed file is
// drawn where it went while its op names where it was.

describe("every path a queued file has worn", () => {
  it("names both ends of a move, so the row it landed on is marked too", () => {
    expect(
      pathsTouched(
        rec({
          kind: "mv",
          from: "/document/section--a.00.md",
          toDir: "/attic",
        }),
      ),
    ).toEqual(["/document/section--a.00.md", "/attic/section--a.00.md"]);
  });

  it("names both ends of a rename, in the folder the file is already in", () => {
    expect(
      pathsTouched(
        rec({
          kind: "rename",
          path: "/document/section--a.00.md",
          newName: "section--b.00.md",
        }),
      ),
    ).toEqual(["/document/section--a.00.md", "/document/section--b.00.md"]);
  });

  it("names the one path for every op that does not move a file", () => {
    for (const op of [
      { kind: "put", path: "/document/section--a.00.md" },
      { kind: "rm", path: "/document/section--a.00.md" },
      { kind: "mkdir", path: "/document" },
    ] as const) {
      expect(pathsTouched(rec(op))).toEqual([op.path]);
    }
  });

  it("is deliberately NOT what the count uses", () => {
    // Counting both ends of a rename would report two files held for one act:
    // "2 files not yet synced" the moment a writer retitles a Section offline.
    const renamed = rec({
      kind: "rename",
      path: "/document/section--a.00.md",
      newName: "section--b.00.md",
    });
    expect(pathsTouched(renamed)).toHaveLength(2);
    expect(uncommittedFiles([renamed]).files).toBe(1);
  });
});

// A lost change is not held work: "not yet synced" promises it
// is on its way, and it is not. It is counted apart, and it does not make the
// queue read as stuck, since nothing is refusing anything.
describe("what was lost", () => {
  it("counts a lost change apart from held work, and not as stuck", () => {
    const work = uncommittedFiles([
      rec({ kind: "put", path: SECTION }, "book", "lost"),
      put(PART),
    ]);
    expect(work).toEqual({ files: 1, stuck: false, lost: 1 });
  });

  it("counts a file in both when it has a lost change AND live work", () => {
    // Both sentences are true of it, so both counts carry it.
    const work = uncommittedFiles([
      rec({ kind: "put", path: SECTION }, "book", "lost"),
      rec({ kind: "rename", path: SECTION, newName: "b.md" }),
    ]);
    expect(work.files).toBe(1);
    expect(work.lost).toBe(1);
  });

  it("never reads zero in both while the queue holds anything", () => {
    // A queue holding only a loss still has something to say.
    const work = uncommittedFiles([
      rec({ kind: "put", path: SECTION }, "book", "lost"),
    ]);
    expect(work.files + work.lost).toBeGreaterThan(0);
  });
});
