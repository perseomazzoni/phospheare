// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { useSyncPendingPaths } from "./useSyncState";
import type { RemoteQueueRecord } from "./remoteQueueStore";

// The queue is faked at its two exported seams rather than driven through
// IndexedDB. The hook owns the projection (scope to one project, name both
// ends of a move); a real store would test `refresh()` a second time.
let records: RemoteQueueRecord[] = [];
const listeners = new Set<() => void>();

vi.mock("./remoteQueue", () => ({
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  pendingRecords: () => records,
  isPending: () => false,
}));

/** Replace the snapshot the way the queue does: a new array only on change. */
function publish(next: RemoteQueueRecord[]) {
  act(() => {
    records = next;
    for (const listener of listeners) listener();
  });
}

let nextId = 1;
const rec = (op: RemoteQueueRecord["op"], key = "book"): RemoteQueueRecord => ({
  id: nextId++,
  userId: "u1",
  ref: { id: `book-${key}`, providerId: "drive", key },
  op,
});

const BOOK = { providerId: "drive", key: "book" };

let seen: ReadonlySet<string>[];

function Probe({ ref }: { ref: typeof BOOK | null }) {
  seen.push(useSyncPendingPaths(ref));
  return null;
}

const last = () => seen[seen.length - 1];

beforeEach(() => {
  records = [];
  listeners.clear();
  nextId = 1;
  seen = [];
});

afterEach(() => cleanup());

describe("useSyncPendingPaths", () => {
  it("is empty while the queue is", () => {
    render(<Probe ref={BOOK} />);
    expect(last().size).toBe(0);
  });

  it("names every file this project still owes, not merely that it owes one", () => {
    // `isPending` answers per project, so a panel using it could mark only
    // one row, while offline every act queues behind the last.
    render(<Probe ref={BOOK} />);
    publish([
      rec({ kind: "put", path: "/document/section--a.00.md" }),
      rec({ kind: "put", path: "/document/part--b.00.md" }),
    ]);
    expect([...last()].sort()).toEqual([
      "/document/part--b.00.md",
      "/document/section--a.00.md",
    ]);
  });

  it("names both ends of a restructure, so the row it landed on marks too", () => {
    // A rename or a move names where the file was; the panel draws it where
    // it is. Matching on the op's own path alone leaves the rows the writer
    // just rearranged unmarked.
    render(<Probe ref={BOOK} />);
    publish([
      rec({
        kind: "rename",
        path: "/document/section--a.00.md",
        newName: "section--b.00.md",
      }),
    ]);
    expect(last().has("/document/section--b.00.md")).toBe(true);
  });

  it("answers about this project only", () => {
    // Two backends can hand out the same key string, so the scope is the whole
    // identity and not the key. A panel that answered about another
    // book would mark rows for work that has nothing to do with it.
    render(<Probe ref={BOOK} />);
    publish([
      rec({ kind: "put", path: "/document/mine.md" }),
      rec({ kind: "put", path: "/document/theirs.md" }, "other-book"),
    ]);
    expect([...last()]).toEqual(["/document/mine.md"]);
  });

  it("answers nothing for a surface with no project behind it", () => {
    // The demo editor runs on `memoryProvider` and never queues anything. A
    // hook cannot be conditional, so the answer is the empty one rather than
    // a guard at the call site.
    render(<Probe ref={null} />);
    publish([rec({ kind: "put", path: "/document/section--a.00.md" })]);
    expect(last().size).toBe(0);
  });

  it("returns the same Set until the queue actually moves", () => {
    // `useSyncExternalStore` compares by identity, and a getter that
    // allocates loops forever. This one memoises on the queue's
    // own stable array, so a re-render for any other reason builds no new
    // `Set`, and the empty answer is one shared instance.
    const { rerender } = render(<Probe ref={BOOK} />);
    const empty = last();
    rerender(<Probe ref={BOOK} />);
    expect(last()).toBe(empty);

    publish([rec({ kind: "put", path: "/document/section--a.00.md" })]);
    const filled = last();
    expect(filled).not.toBe(empty);
    rerender(<Probe ref={BOOK} />);
    expect(last()).toBe(filled);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = render(<Probe ref={BOOK} />);
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
