// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { useDeviceWork } from "./useDeviceWork";
import type { RemoteQueueRecord } from "../../project/sync/remoteQueueStore";

// The queue is faked at its two exported seams rather than driven through
// IndexedDB. The hook owns the React adapter (subscribe, snapshot, project);
// a real store would test `refresh()` a second time.
let records: RemoteQueueRecord[] = [];
const listeners = new Set<() => void>();

vi.mock("../../project/sync/remoteQueue", () => ({
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  pendingRecords: () => records,
}));

/** Replace the snapshot the way the queue does: a new array only on change. */
function publish(next: RemoteQueueRecord[]) {
  act(() => {
    records = next;
    for (const listener of listeners) listener();
  });
}

const put = (path: string, id = 1): RemoteQueueRecord => ({
  id,
  userId: "u1",
  ref: { id: "book-1", providerId: "drive", key: "book" },
  op: { kind: "put", path },
});

let seen: unknown[];
let renders: number;

function Probe() {
  renders++;
  seen.push(useDeviceWork());
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  records = [];
  listeners.clear();
  seen = [];
  renders = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDeviceWork", () => {
  it("answers null while the queue is empty", () => {
    render(<Probe />);
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("follows the queue when work arrives and when it drains", () => {
    render(<Probe />);

    publish([put("/document/section--a.00.md")]);
    expect(seen[seen.length - 1]).toEqual({
      kind: "held",
      files: 1,
      stuck: false,
    });

    publish([]);
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("re-projects when the rows change without crossing empty", () => {
    // The count follows every change, not only the queue going empty; a
    // signal on that edge alone would leave the count still while the queue
    // stays busy.
    render(<Probe />);
    publish([put("/document/section--a.00.md", 1)]);
    expect(seen[seen.length - 1]).toEqual({
      kind: "held",
      files: 1,
      stuck: false,
    });

    publish([
      put("/document/section--a.00.md", 1),
      put("/document/part--b.00.md", 2),
    ]);
    expect(seen[seen.length - 1]).toEqual({
      kind: "held",
      files: 2,
      stuck: false,
    });
  });

  it("does not re-render when the snapshot is unchanged", () => {
    // `getSnapshot` returns a stable reference; one that allocates compares
    // unequal to itself on every render and loops forever. A
    // notify that changes no array is a no-op, which proves the stability.
    render(<Probe />);
    const before = renders;

    act(() => {
      for (const listener of listeners) listener();
    });

    expect(renders).toBe(before);
  });

  it("goes quiet the instant the queue empties, with no beat of its own", () => {
    // The hook is a projection with no state of its own: an empty queue is
    // `null` on the same tick and no timer outlives it. The column is for
    // things that are wrong, and the save chip's tick says the work landed.
    //
    // An empty queue is not by itself good news: an unpair, a conflict
    // resolved by copying or a sign-out also empties it, so success inferred
    // from it would congratulate discarded work.
    render(<Probe />);
    publish([put("/document/section--a.00.md")]);
    expect(seen[seen.length - 1]).toEqual({
      kind: "held",
      files: 1,
      stuck: false,
    });

    publish([]);
    expect(seen[seen.length - 1]).toBeNull();

    const settled = seen.length;
    act(() => void vi.advanceTimersByTime(10_000));
    expect(seen).toHaveLength(settled);
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("unsubscribes on unmount", () => {
    // One subscription, to the rows.
    const { unmount } = render(<Probe />);
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
