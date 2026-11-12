// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ProjectRef } from "../storage";
import { useProjectRef } from "./useProjectRef";

// The profile is real (localStorage, stubbed below) because the resolution is
// its rows, and a fake one would fake the only thing under test. The merge is
// mocked, because every row here is about when it runs. Typed rather
// than inferred: the hook passes the user id through, and a mock inferred
// from a zero-argument body refuses the call that proves it.
const syncProfile = vi.fn<
  (userId: string) => Promise<{
    librarySettled: boolean;
    membershipChanged: boolean;
  }>
>();
vi.mock("../profile/profileSync", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  syncProfile: (userId: string) => syncProfile(userId),
}));

const { addToLibrary } = await import("../profile/profileSync");
// The profile keys rows by the project uuid, and drops any other id.
const ID_1 = "0a1b2c3d-0000-4000-8000-000000000001";
const ID_2 = "0a1b2c3d-0000-4000-8000-000000000002";
const CARD = {
  id: "",
  title: "Once Dark",
  type: "Novel",
  words: 0,
  parts: 0,
  sections: 0,
  goal: null,
  perNode: [],
  structure: { version: 1, children: [] },
  updatedAt: "2026-01-01T00:00:00.000Z",
  cachedAt: "2026-01-01T00:00:00.000Z",
};

/** Put one book on the shelf, at the id it can be addressed by. */
function seed(userId: string, key: string, id: string): void {
  addToLibrary(
    userId,
    { id, provider: "local", key, name: key },
    { ...CARD, id },
  );
}

let seen: (ProjectRef | null | undefined)[];

function Probe({ id, user }: { id?: string; user?: string }) {
  seen.push(useProjectRef(id, user));
  return null;
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
  seen = [];
  // Reset, not clear: a row that installs its own implementation would
  // otherwise hand it to every row after it.
  syncProfile.mockReset();
  syncProfile.mockResolvedValue({
    librarySettled: true,
    membershipChanged: false,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useProjectRef", () => {
  it("answers from the shelf without a merge", async () => {
    seed("u1", "once-dark", ID_1);
    render(<Probe id={ID_1} user="u1" />);

    await waitFor(() =>
      expect(seen[seen.length - 1]).toMatchObject({
        providerId: "local",
        key: "once-dark",
      }),
    );
    // The ordinary case is a writer clicking a card on their own shelf, and
    // it costs nothing: the mirror is localStorage, so this is a read, not a
    // round trip.
    expect(syncProfile).not.toHaveBeenCalled();
  });

  // A link pasted into a browser that has never seen this account: a cold
  // mirror is not a missing project.
  it("pulls once when the mirror does not know the id, then answers", async () => {
    let landed: () => void = () => {};
    syncProfile.mockImplementation(
      () =>
        new Promise((resolve) => {
          landed = () => {
            seed("u1", "once-dark", ID_1);
            resolve({ librarySettled: true, membershipChanged: false });
          };
        }),
    );

    render(<Probe id={ID_1} user="u1" />);
    // Not `null` while the pull is in flight: "not answered yet" and "no such
    // project" are different answers, and collapsing them would send the
    // writer back to the shelf for a project about to arrive.
    expect(seen[seen.length - 1]).toBeUndefined();
    expect(syncProfile).toHaveBeenCalledTimes(1);

    landed();
    await waitFor(() =>
      expect(seen[seen.length - 1]).toMatchObject({ key: "once-dark" }),
    );
  });

  it("says no project once the pull has landed and still nothing carries the id", async () => {
    render(<Probe id="id-nope" user="u1" />);
    await waitFor(() => expect(seen[seen.length - 1]).toBeNull());
    expect(syncProfile).toHaveBeenCalledTimes(1);
  });

  // A failed pull is not a reason to leave a writer looking at a
  // skeleton forever. The shelf is a better place to be wrong from than a
  // project that never opens.
  it("resolves rather than hanging when the pull fails", async () => {
    syncProfile.mockRejectedValue(new Error("offline"));
    render(<Probe id={ID_1} user="u1" />);
    await waitFor(() => expect(seen[seen.length - 1]).toBeNull());
  });

  it("has nothing to look up with no id, or with nobody signed in", async () => {
    seed("u1", "once-dark", ID_1);
    render(<Probe user="u1" />);
    await waitFor(() => expect(seen[seen.length - 1]).toBeNull());

    seen = [];
    render(<Probe id={ID_1} />);
    await waitFor(() => expect(seen[seen.length - 1]).toBeNull());
    expect(syncProfile).not.toHaveBeenCalled();
  });

  it("re-resolves when the address changes", async () => {
    seed("u1", "once-dark", ID_1);
    seed("u1", "ember", ID_2);
    const view = render(<Probe id={ID_1} user="u1" />);
    await waitFor(() =>
      expect(seen[seen.length - 1]).toMatchObject({ key: "once-dark" }),
    );
    view.rerender(<Probe id={ID_2} user="u1" />);
    await waitFor(() =>
      expect(seen[seen.length - 1]).toMatchObject({ key: "ember" }),
    );
  });

  // The editor memoizes its provider on this value, and a fresh object every
  // render would read to it as the project changing under it.
  it("hands back one object, not a new one per render", async () => {
    seed("u1", "once-dark", ID_1);
    const view = render(<Probe id={ID_1} user="u1" />);
    await waitFor(() => expect(seen[seen.length - 1]).toBeTruthy());
    const first = seen[seen.length - 1];
    view.rerender(<Probe id={ID_1} user="u1" />);
    expect(seen[seen.length - 1]).toBe(first);
  });
});
