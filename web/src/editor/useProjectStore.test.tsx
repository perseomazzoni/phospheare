// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useProjectStore } from "./useProjectStore";

const remoteFor = vi.fn();
const dispose = vi.fn();
// Typed rather than inferred: the hook passes a target through, and a mock
// inferred from a zero-argument body would refuse the call that proves it.
const openCacheStore = vi.fn<(target: unknown) => { dispose: () => void }>(
  () => ({ dispose }),
);

vi.mock("../project/sync/remoteFor", () => ({
  remoteFor: (...args: unknown[]) => remoteFor(...args),
}));
vi.mock("../storage/cache/opfsCacheStore", () => ({
  openCacheStore: (target: unknown) => openCacheStore(target),
}));

let seen: (unknown | undefined)[];

/**
 * The latest value the hook handed the probe. Not `.at`: the tsconfig's lib
 * predates it.
 */
function last(): unknown {
  return seen[seen.length - 1];
}

// Not `key`: that is React's own reserved prop and never reaches a component.
function Probe({
  id,
  k,
  book = "book-1",
}: {
  id?: string;
  k?: string;
  book?: string;
}) {
  // `book` is the project's own id, which names the working copy's directory.
  // It defaults, because almost every row here is about the
  // destination lookup rather than the naming.
  const store = useProjectStore(id, k, book);
  seen.push(store);
  return null;
}

beforeEach(() => {
  seen = [];
  remoteFor.mockReset();
  dispose.mockReset();
  openCacheStore.mockClear();
});

afterEach(cleanup);

describe("useProjectStore", () => {
  it("holds at undefined until the destination is known", async () => {
    // `undefined` is "not answered yet"; treating it as "no remote" would
    // open a paired project undecorated for one render, and a session that
    // decorates late is one whose earliest writes never reach the queue.
    let settle: (value: unknown) => void = () => {};
    remoteFor.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    render(<Probe id="local" k="book" />);
    expect(seen).toEqual([undefined]);
    expect(openCacheStore).not.toHaveBeenCalled();

    settle({ providerId: "drive", key: "folder-1" });
    await waitFor(() => expect(last()).toBeDefined());
    // Named by the book, not by where its bytes sit. The route
    // already knows the id from the URL, so nothing is looked up here.
    expect(openCacheStore).toHaveBeenCalledWith({
      id: "book-1",
      remote: { providerId: "drive", key: "folder-1" },
    });
  });

  it("answers null — and opens nothing — for a project with no remote", async () => {
    // A plain Local project. No working copy and no queue is what keeps its
    // "saved" a fact about a file the writer can open in another editor.
    remoteFor.mockResolvedValue(null);

    render(<Probe id="local" k="book" />);

    await waitFor(() => expect(last()).toBeNull());
    expect(openCacheStore).not.toHaveBeenCalled();
  });

  it("disposes the store when the mount ends", async () => {
    // It holds an `onUserChange` subscription so a user switch can poison it,
    // and a subscription with no teardown is a leak with a closure attached.
    remoteFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });

    const view = render(<Probe id="local" k="book" />);
    await waitFor(() => expect(last()).toBeDefined());

    view.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("opens nothing when the mount ends before the lookup answers", async () => {
    // The `live` flag closes a race: a store opened after unmount is one
    // nothing will ever dispose.
    let settle: (value: unknown) => void = () => {};
    remoteFor.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    const view = render(<Probe id="local" k="book" />);
    view.unmount();
    settle({ providerId: "drive", key: "folder-1" });
    await Promise.resolve();

    expect(openCacheStore).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("looks nothing up until it has both halves of the ref", () => {
    render(<Probe />);
    expect(remoteFor).not.toHaveBeenCalled();
    expect(seen).toEqual([undefined]);
  });
});
